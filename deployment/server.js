require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Provider detection ────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const GOOGLE_KEY  = process.env.GOOGLE_API_KEY || '';
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:latest';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';

// Auto-select provider: prefer Ollama if running, else Claude, else Google
// Can be forced with AI_PROVIDER=claude|google|ollama
const FORCED_PROVIDER = process.env.AI_PROVIDER || 'auto';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  // Try Ollama first (unless forced to a cloud provider)
  if (FORCED_PROVIDER === 'auto' || FORCED_PROVIDER === 'ollama') {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const data = await r.json();
        const models = (data.models || []).map(m => m.name);
        const hasModel = models.some(m => m.startsWith('gemma') || m.startsWith('llama'));
        return res.json({
          status: 'ok',
          provider: 'ollama',
          model: OLLAMA_MODEL,
          models,
          hasModel,
          label: `Ollama · ${OLLAMA_MODEL}`
        });
      }
    } catch { /* Ollama not running */ }
  }

  // Claude is the primary cloud provider
  if ((FORCED_PROVIDER === 'auto' || FORCED_PROVIDER === 'claude') && ANTHROPIC_KEY) {
    return res.json({
      status: 'ok',
      provider: 'claude',
      model: CLAUDE_MODEL,
      label: `Claude · ${CLAUDE_MODEL}`
    });
  }

  // Google API as secondary fallback
  if ((FORCED_PROVIDER === 'auto' || FORCED_PROVIDER === 'google') && GOOGLE_KEY) {
    return res.json({
      status: 'ok',
      provider: 'google',
      model: GOOGLE_MODEL,
      label: `Google AI · ${GOOGLE_MODEL}`
    });
  }

  // Nothing available
  res.status(503).json({
    status: 'error',
    message: 'No AI available. Start Ollama locally or set ANTHROPIC_API_KEY / GOOGLE_API_KEY in .env'
  });
});

// ── Generate with streaming ───────────────────────────────────
app.post('/api/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Document header (institution/trainer details) is deterministic — send it
  // immediately so it always appears, regardless of which AI provider is used.
  res.write(`data: ${JSON.stringify({ text: buildHeader(req.body) })}\n\n`);

  const prompt = buildPrompt(req.body);
  const footer = buildFooter(req.body);

  // Decide provider: Ollama (local) → Claude (primary cloud) → Google (fallback)
  let provider = FORCED_PROVIDER;
  if (provider === 'auto') {
    let ollamaUp = false;
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
      ollamaUp = r.ok;
    } catch { ollamaUp = false; }

    provider = ollamaUp ? 'ollama' : (ANTHROPIC_KEY ? 'claude' : 'google');
  }

  if (provider === 'ollama') {
    await streamOllama(prompt, res, footer);
  } else if (provider === 'claude' && ANTHROPIC_KEY) {
    await streamClaude(prompt, res, footer);
  } else if (provider === 'google' && GOOGLE_KEY) {
    await streamGoogle(prompt, res, footer);
  } else {
    res.write(`data: ${JSON.stringify({ error: 'No AI provider available. Start Ollama or set ANTHROPIC_API_KEY / GOOGLE_API_KEY.' })}\n\n`);
    res.end();
  }
});

// ── Ollama streaming ──────────────────────────────────────────
async function streamOllama(prompt, res, footer) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: true })
    });

    if (!r.ok) {
      const err = await r.text();
      res.write(`data: ${JSON.stringify({ error: `Ollama: ${err}` })}\n\n`);
      res.end();
      return;
    }

    const reader  = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          if (d.response) res.write(`data: ${JSON.stringify({ text: d.response })}\n\n`);
          if (d.done) {
            res.write(`data: ${JSON.stringify({ text: footer })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
}

// ── Claude streaming (primary cloud provider) ─────────────────
async function streamClaude(prompt, res, footer) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    await stream.finalMessage();
    res.write(`data: ${JSON.stringify({ text: footer })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
}

// ── Google AI streaming ───────────────────────────────────────
async function streamGoogle(prompt, res, footer) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(GOOGLE_KEY);
    const model = genAI.getGenerativeModel({ model: GOOGLE_MODEL });
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ text: footer })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
}

// ── Document header (deterministic, not AI-generated) ─────────
function buildHeader(data) {
  if (data.planType === 'cbc' || data.planType === 'scheme') return buildCbcHeader(data);
  return buildTvetHeader(data);
}

// ── CBC / KICD header (Kenyan Competency-Based Curriculum) ────
function buildCbcHeader(data) {
  const { subject, gradeLevel, term, year, institution, trainerName, trainerReg,
          studentCount, lessonDate, lessonTime, planType } = data;
  const v = x => (x && String(x).trim()) ? String(x).trim() : '—';

  const teacherLine = `**${v(trainerName)}**${trainerReg && String(trainerReg).trim() ? `  \nAssessment / TSC No. ${v(trainerReg)}` : ''}`;

  if (planType === 'scheme') {
    return `${teacherLine}

# Scheme of Work

| School | Learning Area | Grade | Term | Year |
|---|---|---|---|---|
| ${v(institution)} | ${v(subject)} | ${v(gradeLevel)} | ${v(term)} | ${v(year)} |

---

`;
  }

  return `${teacherLine}

# Lesson Plan

| Name of School | Grade | Term | Year | Learning Area | Date | Time | Roll |
|---|---|---|---|---|---|---|---|
| ${v(institution)} | ${v(gradeLevel)} | ${v(term)} | ${v(year)} | ${v(subject)} | ${v(lessonDate)} | ${v(lessonTime)} | ${v(studentCount)} |

---

`;
}

// ── TVET / CDACC header ───────────────────────────────────────
function buildTvetHeader(data) {
  const {
    subject, gradeLevel, duration, institution, department, unitCode, knqfLevel,
    term, year, trainerName, trainerReg, venue, theoryHours, practicalHours, attachmentHours
  } = data;

  const dur = parseInt(duration) || 60;
  const v = x => (x && String(x).trim()) ? String(x).trim() : '—';

  return `**Ref Code:** KSTVET/TP/LP/FO

| Field | Details | Field | Details |
|---|---|---|---|
| Institution | ${v(institution)} | Department | ${v(department)} |
| Unit Code | ${v(unitCode)} | Unit Title | ${v(subject)} |
| KNQF Level | ${v(knqfLevel)} | Grade / Level | ${v(gradeLevel)} |
| Term | ${v(term)} | Year | ${v(year)} |
| Trainer | ${v(trainerName)} | Trainer Reg. No. | ${v(trainerReg)} |
| Venue | ${v(venue)} | Session Duration | ${dur} minutes |
| Theory (hrs) | ${v(theoryHours)} | Practical (hrs) | ${v(practicalHours)} |
| Attachment (hrs) | ${v(attachmentHours)} | | |

---

`;
}

// ── Verification / sign-off footer (deterministic, not AI-generated) ──
function buildFooter(data) {
  const name = (data.trainerName || '').trim();

  if (data.planType === 'cbc' || data.planType === 'scheme') {
    const role = data.planType === 'scheme' ? 'Prepared By' : 'Teacher';
    return `

---

## ${role}'s Sign-off

| Name | Signature | Date |
|---|---|---|
| ${name || ' '} |  |  |
`;
  }

  return `

---

## Trainer's Verification

| Trainer Name | Signature | Date |
|---|---|---|
| ${name || ' '} |  |  |
`;
}

// ── Prompt builder ────────────────────────────────────────────
function buildPrompt(data) {
  if (data.planType === 'cbc')    return buildCbcLessonPrompt(data);
  if (data.planType === 'scheme') return buildSchemePrompt(data);
  return buildTvetPrompt(data);
}

// ── CBC / KICD lesson-plan prompt (Kenyan primary/junior school) ──
function buildCbcLessonPrompt(data) {
  const { subject, gradeLevel, duration, studentCount, objectives,
          priorKnowledge, notes, strand, subStrand } = data;

  const dur         = parseInt(duration) || 35;
  const intro       = 5;
  const conclusion  = 5;
  const development  = Math.max(dur - intro - conclusion, 5);

  return `You are an expert Kenyan teacher and a KICD-trained curriculum designer working with the Competency-Based Curriculum (CBC). Create a detailed, ready-to-use CBC/KICD lesson plan in Markdown, following the official KICD lesson-plan format.

**Learning Area:** ${subject}
**Grade:** ${gradeLevel}
**Lesson Duration:** ${dur} minutes
**Number of Learners (Roll):** ${studentCount || 'Not specified'}
**Strand:** ${strand || '(infer an appropriate strand for this learning area and grade)'}
**Sub-strand:** ${subStrand || '(infer an appropriate sub-strand)'}
**Learning Objectives / Focus:** ${objectives}
**Prior Knowledge:** ${priorKnowledge || 'Not specified'}
**Notes:** ${notes || 'None'}

---

FORMATTING RULES (follow strictly):
- Do NOT use emojis or decorative icons anywhere.
- Use bold field labels followed by the content, exactly like the official KICD format (e.g. "**STRAND:** ...").
- Keep the language clear, professional and classroom-ready.
- Do NOT include a header table with school/grade/date details, and do NOT include a teacher signature section — those are generated separately and added automatically.
- Leave the REFLECTION section BLANK for the teacher to complete after the lesson — write only the heading and a short italic instruction, never a pre-filled evaluation.

Produce the lesson plan with EXACTLY these sections, in this order:

**STRAND:** ${strand || '...'}

**SUB-STRAND:** ${subStrand || '...'}

**SPECIFIC LEARNING OUTCOMES:**
By the end of the lesson, the learner should be able to:
a) ... (knowledge)
b) ... (skill)
c) ... (attitude / value)
Make them specific, measurable and observable.

**KEY INQUIRY QUESTION(S):** one or two questions that drive the lesson.

**CORE COMPETENCIES:** list the CBC core competencies developed (e.g. Communication and Collaboration, Critical Thinking and Problem Solving, Creativity and Imagination, Citizenship, Digital Literacy, Learning to Learn, Self-efficacy) and state briefly how each is developed in this lesson.

**VALUES:** list the relevant CBC values nurtured (e.g. Responsibility, Respect, Unity, Integrity, Patriotism, Love, Peace) and how.

**PERTINENT AND CONTEMPORARY ISSUES (PCIs):** the PCIs addressed (e.g. health, food security, environmental awareness, life skills, safety).

**LEARNING RESOURCES:** realia, digital devices, charts and a Kenyan course book with a specific page reference.

**ORGANISATION OF LEARNING:** the learning environment and grouping (e.g. indoor, group-work seating).

**INTRODUCTION (${intro} min):** how the lesson is introduced, including the key inquiry question.

**LESSON DEVELOPMENT (${development} min):** break into clear steps (Step 1, Step 2, Step 3 …) describing learner-centred activities; emphasise what the LEARNERS do.

**CONCLUSION (${conclusion} min):** how the lesson is summarised and reinforced.

**EXTENDED ACTIVITIES:** follow-up or research tasks for learners.

**ASSESSMENT:** the assessment method(s) used to check the learning outcomes (e.g. observation, oral questions, written exercise, checklist or rubric).

**REFLECTION:**
_(To be completed by the teacher after the lesson.)_

Make it immediately usable in a real Kenyan CBC classroom. Be specific and practical.`;
}

// ── CBC / KICD scheme-of-work prompt ──────────────────────────
function buildSchemePrompt(data) {
  const { subject, gradeLevel, term, objectives, priorKnowledge, notes, strand, subStrand } = data;

  return `You are an expert Kenyan teacher and a KICD-trained curriculum designer working with the Competency-Based Curriculum (CBC). Create a detailed CBC/KICD Scheme of Work in Markdown, following the official KICD scheme-of-work format.

**Learning Area:** ${subject}
**Grade:** ${gradeLevel}
**Term:** ${term || 'Term 1'}
**Strand(s) / Focus:** ${strand || '(cover the strands appropriate for this learning area, grade and term)'}
**Sub-strand(s):** ${subStrand || '(infer appropriate sub-strands)'}
**Key Objectives / Focus:** ${objectives}
**Prior Knowledge:** ${priorKnowledge || 'Not specified'}
**Notes:** ${notes || 'None'}

---

FORMATTING RULES (follow strictly):
- Do NOT use emojis or decorative icons anywhere.
- Present the scheme as ONE Markdown table using the official KICD columns shown below.
- Cover a full school term: produce rows for about 9 to 13 teaching weeks, with the appropriate number of lessons per week for this learning area and grade.
- Number weeks sequentially (Week 1, 2, 3 …) and number the lessons within each week.
- Make the learning outcomes specific and measurable, and align resources to Kenyan course books with page references where possible.
- Leave the Reflection column BLANK for the teacher to complete after delivery.
- Do NOT include a header table with school/grade details and do NOT include a signature section — those are added automatically.

## Scheme of Work

Produce the table with EXACTLY these columns:

| Week | Lesson | Strand | Sub-strand | Specific Learning Outcomes | Key Inquiry Question(s) | Learning Experiences | Learning Resources | Assessment Methods | Reflection |
|------|--------|--------|------------|----------------------------|--------------------------|----------------------|--------------------|--------------------|------------|
| 1 | 1 | ... | ... | ... | ... | ... | ... | ... | |

Continue the table to cover the whole term. Be specific, practical and aligned to the Kenyan CBC design.`;
}

// ── TVET / CDACC prompt ───────────────────────────────────────
function buildTvetPrompt(data) {
  const { planType, subject, gradeLevel, duration, studentCount,
          objectives, priorKnowledge, teachingStyle, notes } = data;

  const dur   = parseInt(duration) || 60;
  const warmup      = Math.round(dur * 0.10);
  const instruction = Math.round(dur * 0.25);
  const guided      = Math.round(dur * 0.25);
  const independent = Math.round(dur * 0.25);
  const wrapup      = dur - warmup - instruction - guided - independent;

  const typeLabel = planType === 'unit' ? 'Unit Plan'
    : planType === 'assessment' ? 'Assessment Plan'
    : 'Lesson Plan';

  const overviewLabel = planType === 'unit' ? 'Unit Overview'
    : planType === 'assessment' ? 'Assessment Overview'
    : 'Lesson Overview';

  const sessionPlanGuidance = planType === 'unit'
    ? `Add one row per week of the unit (Week 1, Week 2, ... as many weeks as needed to cover the objectives). Each row covers that week's topic, the outcome/performance criteria addressed, trainer and trainee activities, resources & references, and the assessment method. Leave the Reflection cell empty for the trainer to complete after delivery.`
    : planType === 'assessment'
    ? `Add one row per assessment task or activity. Each row covers the task, the outcome/performance criteria it assesses, what the trainer and trainee do during the assessment, resources & references, and the assessment method with marks available. Leave the Reflection cell empty for the trainer to complete after delivery.`
    : `Add one row per phase of the lesson (Warm-Up/Hook, Direct Instruction, Guided Practice, Independent Practice, Assessment & Wrap-Up). Use "Wk 1 / Sess 1" in the Wk/Sess column for every row. The Title column names the phase and its duration in minutes (Warm-Up/Hook ${warmup} min, Direct Instruction ${instruction} min, Guided Practice ${guided} min, Independent Practice ${independent} min, Assessment & Wrap-Up ${wrapup} min). Outcome & PC links to the relevant learning objective. Trainer Activity and Trainee Activity describe what each does in that phase. Resources & References lists materials used. Assessment describes the formative check for that phase. Leave the Reflection cell empty for the trainer to complete after delivery.`;

  return `You are an expert teacher and curriculum designer. Create a detailed, ready-to-use ${typeLabel} using Markdown formatting, following a TVET/CDACC-style lesson plan format.

**Subject / Unit Title:** ${subject}
**Grade / Level:** ${gradeLevel}
**Duration:** ${dur} minutes
**Students:** ${studentCount || 'Not specified'}
**Teaching Style:** ${teachingStyle || 'Mixed / Blended'}
**Learning Objectives:** ${objectives}
**Prior Knowledge:** ${priorKnowledge || 'Not specified'}
**Notes:** ${notes || 'None'}

---

FORMATTING RULES (follow strictly):
- Do NOT use emojis or decorative icons anywhere in the document — not in headings, not in body text.
- Use plain, professional section headings (e.g. "## Lesson Overview", not "## 📚 Lesson Overview").
- Wherever the content is a list of structured items (objectives, materials, schedules, tasks, criteria), present it as a Markdown table with clear column headers, like a formal register or planning document — not a bulleted list with emojis.
- Keep prose sections concise and businesslike.
- Do NOT include a document header table with institution/trainer details, and do NOT include a trainer signature section — those are generated separately and added automatically.

## ${overviewLabel}
A concise 2–3 sentence summary of the ${planType === 'unit' ? 'unit' : planType === 'assessment' ? 'assessment' : 'lesson'} and its purpose.

## Learning Objectives
| # | Objective | Bloom's Level / Performance Criteria |
|---|-----------|----------------------------------------|
| 1 | ... | ... |
| 2 | ... | ... |

## Required Materials & Resources
| # | Item | Notes |
|---|------|-------|
| 1 | ... | ... |

## Session Plan
${sessionPlanGuidance}

| Wk/Sess | Title | Outcome & PC | Trainer Activity | Trainee Activity | Resources & References | Assessment | Reflection |
|---------|-------|---------------|--------------------|---------------------|---------------------------|------------|------------|
| ... | ... | ... | ... | ... | ... | ... | |

${planType === 'assessment' ? `
## Marking Rubric
| Criterion | Excellent (4) | Proficient (3) | Developing (2) | Beginning (1) |
|-----------|--------------|----------------|----------------|---------------|
| ...       | ...          | ...            | ...            | ...           |
` : ''}
## Differentiation Strategies
| Learner Group | Strategy |
|----------------|----------|
| Advanced learners | ... |
| Struggling learners | ... |
| ELL / ESL students | ... |

${planType === 'assessment' ? `
## Feedback Strategies
How to deliver meaningful feedback to students after assessment.
` : `
## Homework / Extension Activities
1–3 optional follow-up tasks.
`}
## Teacher Notes
${planType === 'unit' ? 'Pacing tips, common pitfalls, and reflection prompts.' : 'Misconceptions to watch for, pacing advice, reflection prompts.'}

Make this immediately usable in a real classroom. Be detailed, specific, and practical.`;
}

app.listen(PORT, () => {
  console.log(`\n🎓 Lesson Planner running at http://localhost:${PORT}`);
  console.log(`   Ollama:  ${OLLAMA_URL} · model: ${OLLAMA_MODEL}`);
  console.log(`   Claude:  ${ANTHROPIC_KEY ? `✅ API key set · model: ${CLAUDE_MODEL}` : '❌ No key (set ANTHROPIC_API_KEY in .env)'}`);
  console.log(`   Google:  ${GOOGLE_KEY ? `✅ API key set · model: ${GOOGLE_MODEL}` : '❌ No key (set GOOGLE_API_KEY in .env)'}`);
  console.log(`   Provider: ${FORCED_PROVIDER === 'auto' ? 'auto (Ollama → Claude → Google fallback)' : FORCED_PROVIDER}\n`);
});
