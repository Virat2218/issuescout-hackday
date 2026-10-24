const form = document.querySelector('#search-form');
const input = document.querySelector('#skills');
const button = document.querySelector('#find-button');
const results = document.querySelector('#results');
const notice = document.querySelector('#notice');
const count = document.querySelector('#result-count');
const modelStatus = document.querySelector('#model-status');
const liveDot = document.querySelector('.live-dot');

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
  if (!issues.length) {
    results.innerHTML = '<div class="empty-state"><div class="empty-icon">⌕</div><strong>No matching starter issues came back.</strong><span>Try a broader skill list and search again.</span></div>';
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
    const freshnessClass = freshness.stale ? 'issue-freshness stale' : 'issue-freshness';
    const freshnessNote = freshness.stale
      ? 'May be stale. Recheck on GitHub before starting.'
      : 'Open and unassigned when GitHub returned it. Recheck before starting.';

    return [
      '<article class="issue-card">',
      '<div class="issue-top"><span class="repo">' + escapeHtml(issue.repository) + '</span><span class="score">' + score + '</span></div>',
      '<h3 class="issue-title"><a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.title) + '</a></h3>',
      '<p class="issue-reason">' + escapeHtml(issue.reason) + '</p>',
      '<div class="tags">' + tags + '</div>',
      '<div class="issue-bottom"><span class="first-step"><b>First step</b> · ' + escapeHtml(issue.firstStep) + '</span><a class="open-link" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">View issue ↗</a></div>',
      '<p class="' + freshnessClass + '"><span>' + escapeHtml(freshness.label) + '</span> · ' + freshnessNote + '</p>',
      '</article>',
    ].join('');
  }).join('');
}

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
      body: JSON.stringify({ skills }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The search did not complete.');
    renderIssues(data.issues || []);
    if (data.rankingMode === 'local-ai') {
      showNotice('Ranked locally with ' + data.model + '. Issue data came from GitHub.');
    } else if (data.rankingMode === 'keyword-fallback') {
      showNotice('Showing a basic skill match. To enable AI ranking, start Ollama and load ' + data.model + '. ' + (data.aiMessage || ''));
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
