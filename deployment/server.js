require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Provider detection ────────────────────────────────────────
const GOOGLE_KEY  = process.env.GOOGLE_API_KEY || '';
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:latest';
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemma-3-27b-it';

// Auto-select provider: prefer Ollama if running, else Google API
// Can be forced with AI_PROVIDER=google|ollama
const FORCED_PROVIDER = process.env.AI_PROVIDER || 'auto';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  // Try Ollama first (unless forced to google)
  if (FORCED_PROVIDER !== 'google') {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const data = await r.json();
        const models = (data.models || []).map(m => m.name);
        const hasModel = models.some(m => m.startsWith('gemma'));
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

  // Fall back to Google API
  if (GOOGLE_KEY) {
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
    message: 'No AI available. Start Ollama locally or set GOOGLE_API_KEY in .env'
  });
});

// ── Generate with streaming ───────────────────────────────────
app.post('/api/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const prompt = buildPrompt(req.body);

  // Decide provider
  let useOllama = FORCED_PROVIDER !== 'google';
  if (useOllama) {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
      useOllama = r.ok;
    } catch { useOllama = false; }
  }

  if (useOllama) {
    await streamOllama(prompt, res);
  } else if (GOOGLE_KEY) {
    await streamGoogle(prompt, res);
  } else {
    res.write(`data: ${JSON.stringify({ error: 'No AI provider available. Start Ollama or set GOOGLE_API_KEY.' })}\n\n`);
    res.end();
  }
});

// ── Ollama streaming ──────────────────────────────────────────
async function streamOllama(prompt, res) {
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
          if (d.done)     res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
}

// ── Google AI streaming ───────────────────────────────────────
async function streamGoogle(prompt, res) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(GOOGLE_KEY);
    const model = genAI.getGenerativeModel({ model: GOOGLE_MODEL });
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
}

// ── Prompt builder ────────────────────────────────────────────
function buildPrompt(data) {
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

  return `You are an expert teacher and curriculum designer. Create a detailed, ready-to-use ${typeLabel} using Markdown formatting.

**Subject:** ${subject}
**Grade / Level:** ${gradeLevel}
**Duration:** ${dur} minutes
**Students:** ${studentCount || 'Not specified'}
**Teaching Style:** ${teachingStyle || 'Mixed / Blended'}
**Learning Objectives:** ${objectives}
**Prior Knowledge:** ${priorKnowledge || 'Not specified'}
**Notes:** ${notes || 'None'}

---

${planType === 'assessment' ? `
## 📋 Assessment Overview
Brief description of what this assessment covers and its purpose.

## 🎯 Assessment Objectives
What students are expected to demonstrate, linked to the learning objectives above.

## 📐 Assessment Methods
- **Formative** (ongoing checks): ...
- **Summative** (final evaluation): ...

## 📝 Assessment Tasks
Describe each task/question type with clear instructions.

## 📊 Marking Rubric
| Criterion | Excellent (4) | Proficient (3) | Developing (2) | Beginning (1) |
|-----------|--------------|----------------|----------------|---------------|
| ...       | ...          | ...            | ...            | ...           |

## 🌈 Accommodations
How to modify the assessment for diverse learners.

## 💡 Feedback Strategies
How to deliver meaningful feedback to students after assessment.
` : planType === 'unit' ? `
## 📚 Unit Overview
A 2–3 sentence summary of the unit, its purpose, and how it fits into the broader curriculum.

## 🎯 Unit Learning Objectives
5–7 overarching objectives for the entire unit.

## 📦 Required Resources
Materials, tools, and references needed across the unit.

## 🗓️ Weekly Session Plan
| Week | Topic | Key Activities | Assessment |
|------|-------|----------------|------------|
| 1    | ...   | ...            | ...        |
| 2    | ...   | ...            | ...        |
| 3    | ...   | ...            | ...        |
| 4    | ...   | ...            | ...        |

## 📈 Skill Progression
How skills and knowledge build week by week.

## 📊 Assessment Plan
Formative checks and summative tasks across the unit.

## 🌈 Differentiation Strategies
How to support advanced, struggling, and ELL learners across the unit.

## 💡 Teacher Notes
Pacing tips, common pitfalls, and reflection prompts.
` : `
## 📚 Lesson Overview
A concise 2–3 sentence summary of the lesson.

## 🎯 Learning Objectives
3–5 measurable objectives using Bloom's Taxonomy verbs.

## 📦 Required Materials & Resources
Bulleted list of everything needed.

## ⏱️ Lesson Structure

### 🔥 Warm-Up / Hook (${warmup} min)
An engaging opener to activate prior knowledge.

### 📖 Direct Instruction (${instruction} min)
Key concepts, explanations, examples, and analogies.

### 🤝 Guided Practice (${guided} min)
Teacher and students work through examples together.

### ✏️ Independent Practice (${independent} min)
Student task to apply learning independently.

### 🏁 Assessment & Wrap-Up (${wrapup} min)
Exit ticket or formative check plus closing reflection.

## 🌈 Differentiation Strategies
- **Advanced learners:** ...
- **Struggling learners:** ...
- **ELL / ESL students:** ...

## 📊 Assessment Methods
Formative and summative approaches.

## 🏠 Homework / Extension Activities
1–3 optional follow-up tasks.

## 💡 Teacher Notes & Tips
Misconceptions to watch for, pacing advice, reflection prompts.
`}

Make this immediately usable in a real classroom. Be detailed, specific, and practical.`;
}

app.listen(PORT, () => {
  console.log(`\n🎓 Lesson Planner running at http://localhost:${PORT}`);
  console.log(`   Ollama:  ${OLLAMA_URL} · model: ${OLLAMA_MODEL}`);
  console.log(`   Google:  ${GOOGLE_KEY ? '✅ API key set' : '❌ No key (set GOOGLE_API_KEY in .env)'}`);
  console.log(`   Provider: ${FORCED_PROVIDER === 'auto' ? 'auto (Ollama → Google fallback)' : FORCED_PROVIDER}\n`);
});
