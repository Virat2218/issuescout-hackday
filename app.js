const form = document.querySelector('#search-form');
const input = document.querySelector('#skills');
const technologyInput = document.querySelector('#technologies');
const button = document.querySelector('#find-button');
const results = document.querySelector('#results');
const notice = document.querySelector('#notice');
const count = document.querySelector('#result-count');
const clearPicksButton = document.querySelector('#clear-picks');
const exportPlanButton = document.querySelector('#export-plan');
const modelStatus = document.querySelector('#model-status');
const liveDot = document.querySelector('.live-dot');
const PICK_STORAGE_KEY = 'issuescout:chosen-issues:v1';
let chosenIssues = loadChosenIssues();
let currentIssues = [];

function updatePickButtons() {
  const pickCount = Object.keys(chosenIssues).length;
  if (clearPicksButton) {
    clearPicksButton.hidden = pickCount === 0;
    clearPicksButton.textContent = 'Clear picks (' + pickCount + ')';
  }
  if (exportPlanButton) {
    exportPlanButton.hidden = pickCount === 0;
    exportPlanButton.textContent = 'Export plan (' + pickCount + ') 📋';
  }
}

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

const GENERIC_STARTER_LABELS = new Set([
  'good first issue',
  'good-first-issue',
  'help wanted',
  'help-wanted',
  'hacktoberfest',
  'up-for-grabs',
  'first-timers-only',
]);

function normalizePreference(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPickMatchScore(issue) {
  const weights = new Map();
  Object.values(chosenIssues).forEach((pick) => {
    [...(pick.labels || []), ...(pick.matchedSkills || [])].forEach((value) => {
      const token = normalizePreference(value);
      if (token && !GENERIC_STARTER_LABELS.has(token)) {
        weights.set(token, (weights.get(token) || 0) + 1);
      }
    });
  });
  const issueTokens = new Set(
    [...(issue.labels || []), ...(issue.matchedSkills || [])]
      .map(normalizePreference)
      .filter((token) => token && !GENERIC_STARTER_LABELS.has(token))
  );
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

function formatEvidenceQuote(quote, skill) {
  let escaped = escapeHtml(quote);
  if (skill) {
    const escapedSkill = escapeHtml(skill);
    const regex = new RegExp(`(^|[^a-zA-Z0-9#+.-])(${escapeRegex(escapedSkill)})($|[^a-zA-Z0-9#+.-])`, 'gi');
    escaped = escaped.replace(regex, '$1<mark class="evidence-highlight">$2</mark>$3');
  }
  return escaped;
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
    const evidence = getIssueEvidence(issue);
    const issueId = escapeHtml(issue.id || '');
    const picked = Boolean(chosenIssues[issue.id]);
    const pickButtonLabel = picked ? 'Added to my picks' : 'I’d work on this';
    const similarBadge = issue.pickMatchScore > 0 ? '<span class="pick-similar">Similar to your picks</span>' : '';
    const freshnessClass = freshness.stale ? 'issue-freshness stale' : 'issue-freshness';
    const freshnessNote = freshness.stale
      ? 'May be stale. Recheck on GitHub before starting.'
      : 'Open and unassigned when GitHub returned it. Recheck before starting.';

    const repoUrl = 'https://github.com/' + escapeHtml(issue.repository);
    const contributingUrl = repoUrl + '/blob/HEAD/CONTRIBUTING.md';

    return [
      '<article class="issue-card">',
      '<div class="issue-top"><span class="repo">' + escapeHtml(issue.repository) + '</span><span class="score">' + score + '</span>' + similarBadge + '</div>',
      '<h3 class="issue-title"><a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.title) + '</a></h3>',
      '<p class="issue-reason">' + escapeHtml(issue.reason) + '</p>',
      '<div class="issue-evidence"><strong>Evidence from issue</strong>' + (evidence.length ? '<ul>' + evidence.map((item) => '<li><span class="evidence-source">' + escapeHtml(item.source) + '</span>' + (item.skill ? ' <span class="evidence-skill">[' + escapeHtml(item.skill) + ']</span>' : '') + ': “' + formatEvidenceQuote(item.quote, item.skill) + '”</li>').join('') + '</ul>' : '<p class="no-evidence">No exact skill phrase found in the issue text. Review it before relying on this match.</p>') + '</div>',
      '<div class="tags">' + tags + '</div>',
      '<div class="issue-bottom"><span class="first-step"><b>First step</b> · ' + escapeHtml(issue.firstStep) + '</span><div class="issue-actions"><button class="pick-button' + (picked ? ' picked' : '') + '" type="button" data-issue-id="' + issueId + '" aria-pressed="' + picked + '">' + pickButtonLabel + '</button><a class="guide-link" href="' + contributingUrl + '" target="_blank" rel="noopener noreferrer" title="View repository contribution guidelines">Guide 📖</a><a class="open-link" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">View issue ↗</a></div></div>',
      '<p class="' + freshnessClass + '"><span>' + escapeHtml(freshness.label) + '</span> · ' + freshnessNote + '</p>',
      '</article>',
    ].join('');
  }).join('');
  updatePickButtons();
}

function generateContributionPlanMarkdown() {
  const picks = Object.values(chosenIssues);
  if (!picks.length) return '';
  const dateStr = new Date().toISOString().slice(0, 10);
  let md = `# My Open-Source Starter Plan\n\n`;
  md += `*Generated with [IssueScout](http://localhost:4173) on ${dateStr}*\n\n`;
  md += `## Selected Starter Issues (${picks.length})\n\n`;

  picks.forEach((item, idx) => {
    const title = item.title || `Issue #${item.id}`;
    const repo = item.repository || 'GitHub';
    const url = item.url || `https://github.com/${repo}`;
    const contributingUrl = `https://github.com/${repo}/blob/HEAD/CONTRIBUTING.md`;
    const skills = (item.matchedSkills || []).join(', ') || 'Starter';
    const step = item.firstStep || 'Review the issue and repository contribution guide.';
    const score = Number.isFinite(Number(item.score)) ? `${Math.round(item.score)}% fit` : 'Starter Match';

    md += `### ${idx + 1}. [${repo}] ${title}\n\n`;
    md += `- **Issue Link**: [View on GitHub](${url})\n`;
    md += `- **Contribution Guide**: [Read CONTRIBUTING.md](${contributingUrl})\n`;
    md += `- **Fit Score**: ${score}\n`;
    md += `- **Matched Skills**: ${skills}\n`;
    md += `- **First Concrete Step**: ${step}\n\n`;
    md += `**Action Checklist**:\n`;
    md += `- [ ] Read the repository [CONTRIBUTING guide](${contributingUrl})\n`;
    md += `- [ ] Fork & clone the repository locally\n`;
    md += `- [ ] Check existing test suite and reproduction steps\n`;
    md += `- [ ] Leave a comment on GitHub to claim the task\n`;
    md += `- [ ] Open a Pull Request referencing #${item.id || ''}\n\n`;
    md += `---\n\n`;
  });

  md += `*Good luck with your first open-source contribution!*\n`;
  return md;
}

results.addEventListener('click', (event) => {
  const pickButton = event.target.closest('.pick-button');
  if (!pickButton) return;
  const issue = currentIssues.find((item) => String(item.id) === pickButton.dataset.issueId);
  if (!issue || !issue.id) return;

  if (chosenIssues[issue.id]) {
    delete chosenIssues[issue.id];
    showNotice('Removed from your picks.');
  } else {
    chosenIssues[issue.id] = {
      id: issue.id,
      title: issue.title,
      url: issue.url,
      repository: issue.repository,
      firstStep: issue.firstStep,
      score: issue.score,
      labels: (issue.labels || []).slice(0, 12),
      matchedSkills: (issue.matchedSkills || []).slice(0, 12),
    };
    chosenIssues = Object.fromEntries(Object.entries(chosenIssues).slice(-50));
    showNotice('Marked as a pick! Similar starter issues will move higher on later searches.');
  }
  saveChosenIssues();
  renderIssues(currentIssues);
});

clearPicksButton?.addEventListener('click', () => {
  chosenIssues = {};
  saveChosenIssues();
  updatePickButtons();
  renderIssues(currentIssues);
  showNotice('Cleared your local picks. Shortlist restored to default fit ranking.');
});

exportPlanButton?.addEventListener('click', async () => {
  const md = generateContributionPlanMarkdown();
  if (!md) return;

  // 1. Copy to clipboard
  let copied = false;
  try {
    await navigator.clipboard.writeText(md);
    copied = true;
  } catch { /* Clipboard access fallback */ }

  // 2. Download markdown file
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'issuescout-starter-plan.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    showNotice(copied ? 'Plan copied to clipboard and downloaded as issuescout-starter-plan.md!' : 'Downloaded issuescout-starter-plan.md!');
  } catch {
    showNotice(copied ? 'Contribution plan copied to clipboard!' : 'Plan generated.');
  }
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
    if (data.fallbackActive) {
      showNotice('Showing verified starter issues (GitHub rate-limit guard active).' + (technologyInput.value.trim() ? ' Technology focus: ' + technologyInput.value.trim() + '.' : ''));
    } else if (data.rankingMode === 'local-ai') {
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
updatePickButtons();

function getIssueEvidence(issue) {
  if (Array.isArray(issue.evidence) && issue.evidence.length > 0) {
    return issue.evidence;
  }
  const fields = [
    { source: 'Issue title', text: String(issue.title || '') },
    { source: 'Issue description', text: String(issue.body || '') },
    { source: 'Issue labels', text: (issue.labels || []).join(', ') },
  ];
  const seen = new Set();
  return (Array.isArray(issue.matchedSkills) ? issue.matchedSkills : []).slice(0, 3).flatMap((skill) => {
    const needle = String(skill || '').trim();
    const normalized = needle.toLowerCase();
    if (!normalized || seen.has(normalized)) return [];
    const escaped = escapeRegex(needle);
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9#+.-])(${escaped})(?:$|[^a-zA-Z0-9#+.-])`, 'i');
    const field = fields.find(({ text }) => regex.test(text));
    if (!field) return [];
    seen.add(normalized);
    const match = regex.exec(field.text);
    const index = match ? match.index + match[0].toLowerCase().indexOf(normalized) : field.text.toLowerCase().indexOf(normalized);
    const start = Math.max(0, index - 50);
    const end = Math.min(field.text.length, index + needle.length + 60);
    const snippet = field.text.slice(start, end).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const quote = (start > 0 ? '…' : '') + snippet + (end < field.text.length ? '…' : '');
    return [{ source: field.source, skill: needle, quote }];
  });
}
