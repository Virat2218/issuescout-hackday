const form = document.querySelector('#search-form');
const input = document.querySelector('#skills');
const technologyInput = document.querySelector('#technologies');
const button = document.querySelector('#find-button');
const results = document.querySelector('#results');
const notice = document.querySelector('#notice');
const count = document.querySelector('#result-count');
const modelStatus = document.querySelector('#model-status');
const liveDot = document.querySelector('.live-dot');
const PICK_STORAGE_KEY = 'issuescout:chosen-issues:v1';
let chosenIssues = loadChosenIssues();
let currentIssues = [];

function loadChosenIssues() {
  try {
    const stored = JSON.parse(localStorage.getItem(PICK_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function saveChosenIssues() {
  try {
    localStorage.setItem(PICK_STORAGE_KEY, JSON.stringify(chosenIssues));
  } catch {
    showNotice('Your browser could not save this pick. Check its storage settings.', 'error');
  }
}

function normalizePreference(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getPickMatchScore(issue) {
  const weights = new Map();
  Object.values(chosenIssues).forEach((pick) => {
    [...(pick.labels || []), ...(pick.matchedSkills || [])].forEach((value) => {
      const token = normalizePreference(value);
      if (token) weights.set(token, (weights.get(token) || 0) + 1);
    });
  });
  const issueTokens = new Set([...(issue.labels || []), ...(issue.matchedSkills || [])].map(normalizePreference).filter(Boolean));
  return [...issueTokens].reduce((score, token) => score + (weights.get(token) || 0), 0);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function showNotice(message = '', kind = '') {
  notice.textContent = message;
  notice.className = 'notice ' + kind;
  notice.hidden = !message;
}

function formatIssueFreshness(updatedAt) {
  const timestamp = Date.parse(updatedAt || '');
  if (!Number.isFinite(timestamp)) return { label: 'Update time unavailable', stale: false };

  const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  const label = ageDays === 0 ? 'Updated today' : 'Updated ' + ageDays + ' day' + (ageDays === 1 ? '' : 's') + ' ago';
  return { label, stale: ageDays > 90 };
}

function renderIssues(issues) {
  currentIssues = issues;
  issues = issues.map((issue, index) => ({ ...issue, pickMatchScore: getPickMatchScore(issue), originalIndex: index }))
    .sort((a, b) => b.pickMatchScore - a.pickMatchScore || a.originalIndex - b.originalIndex);
  if (!issues.length) {
    results.innerHTML = '<div class="empty-state"><div class="empty-icon">⌕</div><strong>No matching starter issues came back.</strong><span>Try broader skills or remove a technology filter.</span></div>';
    count.textContent = '0 FOUND';
    return;
  }
  count.textContent = issues.length + ' FOUND';
  results.innerHTML = issues.map((issue) => {
    const tags = [
      ...(issue.matchedSkills || []).map((skill) => '<span class="tag match-tag">' + escapeHtml(skill) + '</span>'),
      ...(issue.labels || []).slice(0, 3).map((label) => '<span class="tag">' + escapeHtml(label) + '</span>'),
    ].join('');
    const score = Number.isFinite(Number(issue.score)) ? Math.round(issue.score) + '% FIT' : 'MATCH';
    const freshness = formatIssueFreshness(issue.updatedAt);
    const issueId = escapeHtml(issue.id || '');
    const picked = Boolean(chosenIssues[issue.id]);
    const pickButtonLabel = picked ? 'Added to my picks' : 'I’d work on this';
    const similarBadge = issue.pickMatchScore > 0 ? '<span class="pick-similar">Similar to your picks</span>' : '';
    const freshnessClass = freshness.stale ? 'issue-freshness stale' : 'issue-freshness';
    const freshnessNote = freshness.stale
      ? 'May be stale. Recheck on GitHub before starting.'
      : 'Open and unassigned when GitHub returned it. Recheck before starting.';

    return [
      '<article class="issue-card">',
      '<div class="issue-top"><span class="repo">' + escapeHtml(issue.repository) + '</span><span class="score">' + score + '</span>' + similarBadge + '</div>',
      '<h3 class="issue-title"><a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.title) + '</a></h3>',
      '<p class="issue-reason">' + escapeHtml(issue.reason) + '</p>',
      '<div class="tags">' + tags + '</div>',
      '<div class="issue-bottom"><span class="first-step"><b>First step</b> · ' + escapeHtml(issue.firstStep) + '</span><div class="issue-actions"><button class="pick-button' + (picked ? ' picked' : '') + '" type="button" data-issue-id="' + issueId + '" aria-pressed="' + picked + '">' + pickButtonLabel + '</button><a class="open-link" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">View issue ↗</a></div></div>',
      '<p class="' + freshnessClass + '"><span>' + escapeHtml(freshness.label) + '</span> · ' + freshnessNote + '</p>',
      '</article>',
    ].join('');
  }).join('');
}

results.addEventListener('click', (event) => {
  const pickButton = event.target.closest('.pick-button');
  if (!pickButton) return;
  const issue = currentIssues.find((item) => String(item.id) === pickButton.dataset.issueId);
  if (!issue || !issue.id) return;

  if (chosenIssues[issue.id]) {
    delete chosenIssues[issue.id];
  } else {
    chosenIssues[issue.id] = {
      labels: (issue.labels || []).slice(0, 12),
      matchedSkills: (issue.matchedSkills || []).slice(0, 12),
    };
    chosenIssues = Object.fromEntries(Object.entries(chosenIssues).slice(-50));
  }
  saveChosenIssues();
  renderIssues(currentIssues);
});

async function checkStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    if (status.localModelReady) {
      modelStatus.textContent = 'LOCAL AI READY · ' + status.model;
      liveDot.classList.add('ready');
    } else {
      modelStatus.textContent = 'AI MODEL NEEDED · ' + status.model;
    }
  } catch {
    modelStatus.textContent = 'LOCAL SERVER NOT READY';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const skills = input.value.trim();
  if (!skills) return;
  button.disabled = true;
  button.querySelector('span:first-child').textContent = 'Finding matches…';
  showNotice('Searching GitHub and asking the local model to rank open issues.');
  results.innerHTML = '<div class="empty-state"><div class="empty-icon">✳</div><strong>Finding a good starting point…</strong><span>This can take up to a minute while the local model loads.</span></div>';
  count.textContent = '…';
  try {
    const response = await fetch('/api/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills, technologies: technologyInput.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The search did not complete.');
    renderIssues(data.issues || []);
    if (data.rankingMode === 'local-ai') {
      showNotice('Ranked locally with ' + data.model + '. Issue data came from GitHub.' + (technologyInput.value.trim() ? ' Technology focus: ' + technologyInput.value.trim() + '.' : ''));
    } else if (data.rankingMode === 'keyword-fallback') {
      showNotice('Showing a basic skill match. To enable AI ranking, start Ollama and load ' + data.model + '. ' + (data.aiMessage || '') + (technologyInput.value.trim() ? ' Technology focus: ' + technologyInput.value.trim() + '.' : ''));
    } else {
      showNotice('No results were returned. Try again in a moment or broaden your skills.');
    }
  } catch (error) {
    results.innerHTML = '<div class="empty-state"><div class="empty-icon">!</div><strong>Could not load GitHub issues.</strong><span>Check your internet connection, then try again.</span></div>';
    count.textContent = 'ERROR';
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
    button.querySelector('span:first-child').textContent = 'Find issues';
  }
});

checkStatus();
