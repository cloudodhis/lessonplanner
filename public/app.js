/* ── Plan type definitions ──────────────────────────────────── */
const PLAN_TYPES = {
  lesson: {
    badge: 'Lesson Plan',
    title: 'Create a Lesson Plan',
    subtitle: 'A complete single-session teaching plan with timed structure.'
  },
  unit: {
    badge: 'Unit Plan',
    title: 'Create a Unit Plan',
    subtitle: 'A multi-lesson unit overview with progressive skill-building.'
  },
  assessment: {
    badge: 'Assessment Plan',
    title: 'Create an Assessment Plan',
    subtitle: 'Formative and summative evaluation tools with marking guides.'
  }
};

/* ── DOM refs ───────────────────────────────────────────────── */
const pageHome      = document.getElementById('page-home');
const pageWorkspace = document.getElementById('page-workspace');
const statusBadge   = document.getElementById('status-badge');
const statusText    = statusBadge.querySelector('.status-text');
const backBtn       = document.getElementById('back-btn');
const planBadge     = document.getElementById('plan-badge');
const planTitle     = document.getElementById('plan-title');
const planSubtitle  = document.getElementById('plan-subtitle');
const form          = document.getElementById('lesson-form');
const generateBtn   = document.getElementById('generate-btn');
const btnIcon       = generateBtn.querySelector('.btn-icon');
const btnText       = generateBtn.querySelector('.btn-text');
const outEmpty      = document.getElementById('out-empty');
const outResult     = document.getElementById('out-result');
const outError      = document.getElementById('out-error');
const outTitle      = document.getElementById('out-title');
const lessonOutput  = document.getElementById('lesson-output');
const errorMsg      = document.getElementById('error-message');
const copyBtn       = document.getElementById('copy-btn');
const printBtn      = document.getElementById('print-btn');
const retryBtn      = document.getElementById('retry-btn');

/* ── State ──────────────────────────────────────────────────── */
let rawMarkdown = '';
let streaming   = false;
let activePlan  = 'lesson';

/* ═══════════════════════════════════════════════════════════════
   MULTI-SELECT COMPONENT
   ════════════════════════════════════════════════════════════ */
const msWrapper    = document.getElementById('ms-wrapper');
const msControl    = document.getElementById('ms-control');
const msTags       = document.getElementById('ms-tags');
const msPlaceholder= document.getElementById('ms-placeholder');
const msPanel      = document.getElementById('ms-panel');
const msSearch     = document.getElementById('ms-search');
const msList       = document.getElementById('ms-list');
const msHidden     = document.getElementById('objectives');

let msOpen = false;

function openMs() {
  msOpen = true;
  msControl.classList.add('open');
  msPanel.classList.remove('hidden');
  msSearch.focus();
}

function closeMs() {
  msOpen = false;
  msControl.classList.remove('open');
  msPanel.classList.add('hidden');
  msSearch.value = '';
  filterMs('');
}

msControl.addEventListener('click', () => msOpen ? closeMs() : openMs());

msControl.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); msOpen ? closeMs() : openMs(); }
  if (e.key === 'Escape') closeMs();
});

// Close when clicking outside
document.addEventListener('click', e => {
  if (msOpen && !msWrapper.contains(e.target)) closeMs();
});

// Search filter
msSearch.addEventListener('input', e => filterMs(e.target.value.trim().toLowerCase()));

function filterMs(q) {
  const items  = msList.querySelectorAll('.ms-item');
  const heads  = msList.querySelectorAll('.ms-group-head');
  let any      = false;

  // Show/hide items
  items.forEach(item => {
    const text = item.querySelector('span').textContent.toLowerCase();
    const show = !q || text.includes(q);
    item.classList.toggle('hidden-item', !show);
    if (show) any = true;
  });

  // Hide group headers when all their items are hidden
  heads.forEach(head => {
    let next = head.nextElementSibling;
    let allHidden = true;
    while (next && !next.classList.contains('ms-group-head')) {
      if (!next.classList.contains('hidden-item')) { allHidden = false; break; }
      next = next.nextElementSibling;
    }
    head.classList.toggle('hidden-item', allHidden);
  });

  // No results message
  let noRes = msList.querySelector('.ms-no-results');
  if (!any && q) {
    if (!noRes) {
      noRes = document.createElement('div');
      noRes.className = 'ms-no-results';
      msList.appendChild(noRes);
    }
    noRes.textContent = `No objectives match "${q}"`;
    noRes.style.display = '';
  } else if (noRes) {
    noRes.style.display = 'none';
  }
}

// Checkbox changes → update tags + hidden input
msList.addEventListener('change', e => {
  if (e.target.type !== 'checkbox') return;
  const item = e.target.closest('.ms-item');
  item.classList.toggle('checked', e.target.checked);
  renderTags();
});

// Prevent closing panel when clicking inside it
msPanel.addEventListener('click', e => e.stopPropagation());

function renderTags() {
  const checked = [...msList.querySelectorAll('input[type="checkbox"]:checked')];
  const values  = checked.map(cb => cb.value);

  // Update hidden input
  msHidden.value = values.join('; ');

  // Clear control area
  msTags.innerHTML = '';

  if (values.length === 0) {
    const ph = document.createElement('span');
    ph.className = 'ms-placeholder';
    ph.id = 'ms-placeholder';
    ph.textContent = 'Select objectives…';
    msTags.appendChild(ph);
  } else {
    values.forEach((v, i) => {
      const tag = document.createElement('span');
      tag.className = 'ms-tag';
      tag.innerHTML = `<span>${v}</span><span class="ms-tag-remove" data-index="${i}" title="Remove">×</span>`;
      msTags.appendChild(tag);
    });
  }

  // Clear invalid highlight if at least one selected
  if (values.length > 0) msControl.classList.remove('invalid');
}

// Remove tag via × button
msTags.addEventListener('click', e => {
  const removeBtn = e.target.closest('.ms-tag-remove');
  if (!removeBtn) return;
  const tagSpan = removeBtn.closest('.ms-tag').querySelector('span').textContent;
  const cb = [...msList.querySelectorAll('input[type="checkbox"]')]
    .find(c => c.value === tagSpan);
  if (cb) {
    cb.checked = false;
    cb.closest('.ms-item').classList.remove('checked');
    renderTags();
  }
  e.stopPropagation();
});

function getObjectives() {
  return msHidden.value;
}

function resetMs() {
  msList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    cb.closest('.ms-item').classList.remove('checked');
  });
  renderTags();
}

/* ═══════════════════════════════════════════════════════════════
   HEALTH CHECK
   ════════════════════════════════════════════════════════════ */
async function checkHealth() {
  try {
    const res  = await fetch('/api/health');
    const data = await res.json();
    if (data.status === 'ok') {
      const providerIcon = data.provider === 'ollama' ? '🦙'
        : data.provider === 'claude' ? '✨'
        : '🤖';
      setStatus('online', `${providerIcon} ${data.label}`);
    } else {
      setStatus('offline', 'No AI available');
    }
  } catch {
    setStatus('offline', 'Server offline');
  }
}

function setStatus(state, text) {
  statusBadge.className = `status-badge ${state}`;
  statusText.textContent = text;
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════════════════════ */
document.querySelectorAll('.card, .btn-card').forEach(el => {
  el.addEventListener('click', e => {
    if (el.classList.contains('btn-card')) e.stopPropagation();
    const card = el.closest('.card') || el.parentElement.closest('.card');
    openWorkspace(card?.dataset.type || 'lesson');
  });
});

function openWorkspace(type) {
  activePlan = type || 'lesson';
  const meta = PLAN_TYPES[activePlan];
  planBadge.textContent    = meta.badge;
  planTitle.textContent    = meta.title;
  planSubtitle.textContent = meta.subtitle;
  pageHome.classList.add('hidden');
  pageWorkspace.classList.remove('hidden');
  showOutput('empty');
  rawMarkdown = '';
  lessonOutput.innerHTML = '';
}

backBtn.addEventListener('click', () => {
  if (streaming) return;
  pageWorkspace.classList.add('hidden');
  pageHome.classList.remove('hidden');
});

/* ═══════════════════════════════════════════════════════════════
   OUTPUT PANEL STATE
   ════════════════════════════════════════════════════════════ */
function showOutput(state) {
  outEmpty.classList.add('hidden');
  outResult.classList.add('hidden');
  outError.classList.add('hidden');
  if (state === 'empty')  outEmpty.classList.remove('hidden');
  if (state === 'result') outResult.classList.remove('hidden');
  if (state === 'error')  outError.classList.remove('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   FORM SUBMIT
   ════════════════════════════════════════════════════════════ */
form.addEventListener('submit', async e => {
  e.preventDefault();
  if (streaming) return;

  const objectives = getObjectives();

  // Validate required fields manually
  const subject    = form.subject.value;
  const gradeLevel = form.gradeLevel.value;
  let valid = true;

  if (!subject)    { document.getElementById('subject').style.borderColor = '#ef4444'; valid = false; }
  if (!gradeLevel) { document.getElementById('gradeLevel').style.borderColor = '#ef4444'; valid = false; }
  if (!objectives) { msControl.classList.add('invalid'); valid = false; }

  if (!valid) return;

  await generate({
    planType:       activePlan,
    subject,
    gradeLevel,
    duration:       form.duration.value,
    studentCount:   form.studentCount.value.trim(),
    teachingStyle:  form.teachingStyle.value,
    objectives,
    priorKnowledge: form.priorKnowledge.value.trim(),
    notes:          form.notes.value.trim()
  });
});

// Clear red borders on change
['subject', 'gradeLevel'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', e => {
    e.target.style.borderColor = '';
  });
});

/* ═══════════════════════════════════════════════════════════════
   GENERATE
   ════════════════════════════════════════════════════════════ */
async function generate(data) {
  streaming   = true;
  rawMarkdown = '';
  setGenerating(true);
  showOutput('result');
  outTitle.textContent   = `${data.subject} — ${data.gradeLevel}`;
  lessonOutput.innerHTML = '<span class="cursor"></span>';
  document.querySelector('.output-panel').scrollTop = 0;

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(line.slice(6));
          if (p.error) { showError(p.error); return; }
          if (p.text)  { rawMarkdown += p.text; renderMD(rawMarkdown, true); }
          if (p.done)  { renderMD(rawMarkdown, false); }
        } catch { /* skip */ }
      }
    }
    renderMD(rawMarkdown, false);

  } catch (err) {
    showError(err.message);
  } finally {
    streaming = false;
    setGenerating(false);
  }
}

function renderMD(md, cursor) {
  lessonOutput.innerHTML = marked.parse(md) + (cursor ? '<span class="cursor"></span>' : '');
  if (cursor) {
    const panel = document.querySelector('.output-panel');
    panel.scrollTop = panel.scrollHeight;
  }
}

function setGenerating(on) {
  generateBtn.disabled = on;
  generateBtn.classList.toggle('loading', on);
  btnIcon.textContent = on ? '⏳' : '✨';
  btnText.textContent = on ? 'Generating…' : 'Generate Plan';
}

function showError(msg) {
  streaming = false;
  setGenerating(false);
  errorMsg.textContent = msg;
  showOutput('error');
}

/* ── Toolbar ────────────────────────────────────────────────── */
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(rawMarkdown);
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
  } catch { copyBtn.textContent = 'Failed'; }
});

printBtn.addEventListener('click', () => window.print());

retryBtn.addEventListener('click', () => { checkHealth(); showOutput('empty'); });

/* ── Init ───────────────────────────────────────────────────── */
marked.setOptions({ breaks: true, gfm: true });
checkHealth();
