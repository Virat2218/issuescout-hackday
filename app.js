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
const difficultyFilterBar = document.querySelector('#difficulty-filter');
const diffCountLabel = document.querySelector('#diff-count');
const diffResetButton = document.querySelector('#diff-reset');
const diffPillsContainer = document.querySelector('.difficulty-pills');
const viewTabShortlist = document.querySelector('#view-tab-shortlist');
const viewTabLearning = document.querySelector('#view-tab-learning');
const learningPathPanel = document.querySelector('#learning-path-panel');
const learningStageIndicator = document.querySelector('#learning-stage-indicator');
const learningGoalSelect = document.querySelector('#learning-goal-select');
const learningProgressBanner = document.querySelector('#learning-progress-banner');
const pickPrivacyNote = document.querySelector('#pick-privacy-note');

const PICK_STORAGE_KEY = 'issuescout:chosen-issues:v1';
const LEARNING_STORAGE_KEY = 'issuescout:learning-path:v1';

let chosenIssues = loadChosenIssues();
let learningProfile = loadLearningProfile();
let currentIssues = [];
let activeDifficultyFilter = 'all'; // 'all' | 'beginner' | 'intermediate' | 'advanced'
let activeViewMode = 'shortlist'; // 'shortlist' | 'learning'

function loadLearningProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEARNING_STORAGE_KEY) || '{}');
    if (stored && typeof stored === 'object') {
      return {
        targetStage: stored.targetStage || 'beginner',
        userGoal: stored.userGoal || 'first-pr',
        completedContributions: stored.completedContributions || {},
        inProgressContributions: stored.inProgressContributions || {},
      };
    }
  } catch { /* ignore */ }
  return {
    targetStage: 'beginner',
    userGoal: 'first-pr',
    completedContributions: {},
    inProgressContributions: {},
  };
}

function saveLearningProfile() {
  try {
    localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(learningProfile));
  } catch { /* ignore */ }
}

function updatePickButtons() {
  const pickCount = Object.keys(chosenIssues).length;
  if (clearPicksButton) {
    clearPicksButton.hidden = pickCount === 0;
    clearPicksButton.textContent = 'Clear picks (' + pickCount + ')';
  }
  if (exportPlanButton) {
    exportPlanButton.hidden = pickCount === 0;
    exportPlanButton.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg> <span>Export plan (' + pickCount + ')</span>';
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

/**
 * Distinct SVG icons for each difficulty level so badges are distinguishable
 * without relying solely on color (accessible for all vision types).
 */
const DIFFICULTY_ICONS = {
  beginner: '<svg class="diff-badge-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>',
  intermediate: '<svg class="diff-badge-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  advanced: '<svg class="diff-badge-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  unknown: '<svg class="diff-badge-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

/**
 * Render an accessible difficulty badge for an issue card header.
 * Supports Beginner, Intermediate, Advanced, and Unknown.
 * Falls back to Unknown if difficulty data is missing or invalid.
 * @param {object} difficulty  { level, explanation, confidence, signals, uncertainty }
 */
function renderDifficultyBadge(difficulty) {
  const validLevels = ['beginner', 'intermediate', 'advanced', 'unknown'];
  const rawLevel = (difficulty && typeof difficulty.level === 'string')
    ? difficulty.level.toLowerCase().trim()
    : 'unknown';
  const level = validLevels.includes(rawLevel) ? rawLevel : 'unknown';
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  const icon = DIFFICULTY_ICONS[level] || DIFFICULTY_ICONS.unknown;

  const rawExplanation = (difficulty && typeof difficulty.explanation === 'string' && difficulty.explanation.trim())
    ? difficulty.explanation.trim()
    : 'Difficulty estimated from issue signals and scope.';
  const tooltip = `Difficulty: ${label} (Estimated: ${rawExplanation} Always recheck on GitHub before starting.)`;

  return `<span class="diff-badge diff-badge--${level}" role="status" title="${escapeHtml(tooltip)}" aria-label="Difficulty: ${label}. Difficulty is an estimated level.">${icon}<span>${label}</span></span>`;
}

/**
 * Render structured difficulty section on issue cards:
 * explanation, detected signals / evidence, and uncertainty notes.
 */
/**
 * Render structured difficulty section on issue cards:
 * concise evidence-based explanation, source-backed facts vs interpretation signals,
 * and uncertainty callouts within a collapsible 'Why this difficulty?' block.
 */
function renderDifficultyBlock(difficulty) {
  if (!difficulty || typeof difficulty !== 'object') {
    return `
      <div class="diff-card-block diff-block--unknown">
        <div class="diff-explanation">
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span class="diff-why-badge">Why Unknown?</span>
          <span class="diff-reason-text">There is not enough reliable information in the available issue description to estimate the difficulty.</span>
        </div>
      </div>
    `;
  }

  const validLevels = ['beginner', 'intermediate', 'advanced', 'unknown'];
  const rawLevel = (typeof difficulty.level === 'string') ? difficulty.level.toLowerCase().trim() : 'unknown';
  const level = validLevels.includes(rawLevel) ? rawLevel : 'unknown';
  const levelTitle = level.charAt(0).toUpperCase() + level.slice(1);

  const rawExplanation = (typeof difficulty.explanation === 'string' && difficulty.explanation.trim())
    ? difficulty.explanation.trim()
    : 'There is not enough reliable information in the available issue description to estimate the difficulty.';

  const confidence = typeof difficulty.confidence === 'string' ? difficulty.confidence.toLowerCase() : 'low';
  const confLabel = (confidence === 'label' || confidence === 'high')
    ? 'High'
    : (confidence === 'heuristic' || confidence === 'medium')
      ? 'Medium'
      : 'Low';
  const confClass = confLabel.toLowerCase();

  const signals = Array.isArray(difficulty.signals) ? difficulty.signals : [];
  const uncertainty = Array.isArray(difficulty.uncertainty) ? difficulty.uncertainty : [];
  const sourceFacts = Array.isArray(difficulty.sourceFacts) ? difficulty.sourceFacts : [];
  const referencedFiles = Number.isInteger(difficulty.referencedFiles) ? difficulty.referencedFiles : 0;

  const factsHtml = sourceFacts.length > 0
    ? `<div class="diff-breakdown-group">
        <span class="diff-group-title">Verified Source Facts:</span>
        <div class="diff-facts-chips">
          ${sourceFacts.map((fact) => `<span class="diff-fact-chip"><svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>${escapeHtml(fact)}</span>`).join('')}
        </div>
      </div>`
    : '';

  const signalsHtml = signals.length > 0
    ? `<div class="diff-breakdown-group">
        <span class="diff-group-title">Scope & Complexity Signals:</span>
        <div class="diff-signals-chips">
          ${signals.map((s) => {
            const factor = typeof s === 'string' ? s : (s && s.factor ? s.factor : '');
            const weight = typeof s === 'object' && s && s.weight ? s.weight : 'medium';
            return `<span class="diff-signal-chip weight-${escapeHtml(weight)}">${escapeHtml(factor)}</span>`;
          }).join('')}
        </div>
      </div>`
    : '';

  const uncertaintyHtml = uncertainty.length > 0
    ? `<div class="diff-uncertainty">
        <span class="diff-uncertainty-icon">⚠</span>
        <div class="diff-uncertainty-text">
          ${uncertainty.map((u) => `<span>${escapeHtml(u)}</span>`).join(' ')}
        </div>
      </div>`
    : '';

  const filesTag = referencedFiles > 0
    ? `<span class="diff-files-pill">${referencedFiles} referenced file${referencedFiles === 1 ? '' : 's'}</span>`
    : '';

  const hasExtraDetails = factsHtml || signalsHtml || uncertaintyHtml;

  if (!hasExtraDetails) {
    return `
      <div class="diff-card-block diff-block--${level}">
        <div class="diff-explanation">
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span class="diff-why-badge">Why ${levelTitle}?</span>
          <span class="diff-reason-text">${escapeHtml(rawExplanation)}</span>
          <div class="diff-header-tags">
            ${filesTag}
            <span class="diff-conf-badge conf-${confClass}" title="Confidence: ${confLabel}">${confLabel} confidence</span>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <details class="diff-card-block diff-block--${level}">
      <summary class="diff-why-summary">
        <div class="diff-explanation">
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span class="diff-why-badge">Why ${levelTitle}?</span>
          <span class="diff-reason-text">${escapeHtml(rawExplanation)}</span>
        </div>
        <div class="diff-header-tags">
          ${filesTag}
          <span class="diff-conf-badge conf-${confClass}" title="Confidence: ${confLabel}">${confLabel} confidence</span>
          <svg class="icon-svg diff-arrow" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </summary>
      <div class="diff-breakdown-details">
        ${factsHtml}
        ${signalsHtml}
        ${uncertaintyHtml}
      </div>
    </details>
  `;
}

/**
 * Safely extract and normalize the difficulty level of an issue.
 * Supports: 'beginner', 'intermediate', 'advanced'.
 * Falls back to 'unknown' if missing or invalid.
 */
function getIssueDifficultyLevel(issue) {
  const raw = issue?.difficulty?.level;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['beginner', 'intermediate', 'advanced', 'unknown'].includes(normalized)) {
      return normalized;
    }
  }
  return 'unknown';
}

/**
 * Apply the active difficulty filter to the stored issue list and re-render.
 * Filters issues without mutating original issue objects, fit scores, or ranks.
 */
function applyDifficultyFilter() {
  const filtered = activeDifficultyFilter === 'all'
    ? currentIssues
    : currentIssues.filter((issue) => getIssueDifficultyLevel(issue) === activeDifficultyFilter);

  // Update pill active states and accessibility
  document.querySelectorAll('.diff-pill').forEach((pill) => {
    const isSelected = pill.dataset.level === activeDifficultyFilter;
    pill.classList.toggle('active', isSelected);
    pill.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    pill.tabIndex = isSelected ? 0 : -1;
  });

  // Toggle optional clear/reset button
  if (diffResetButton) {
    diffResetButton.hidden = (activeDifficultyFilter === 'all');
  }

  // Update count label
  if (diffCountLabel) {
    diffCountLabel.textContent = activeDifficultyFilter === 'all'
      ? ''
      : `${filtered.length} of ${currentIssues.length} shown`;
  }

  if (!filtered.length && currentIssues.length > 0) {
    const levelLabel = activeDifficultyFilter.charAt(0).toUpperCase() + activeDifficultyFilter.slice(1);
    results.innerHTML = `<div class="empty-state">
      <div class="empty-icon">⌕</div>
      <strong>No ${levelLabel} issues in your current shortlist.</strong>
      <span>Try a different difficulty level or broaden your search skills.</span>
      <button class="diff-reset-btn" type="button" id="diff-empty-reset">Show all levels</button>
    </div>`;
    count.textContent = '0 SHOWN';
    document.querySelector('#diff-empty-reset')?.addEventListener('click', () => {
      activeDifficultyFilter = 'all';
      applyDifficultyFilter();
      document.querySelector('.diff-pill[data-level="all"]')?.focus();
    });
    return;
  }

  count.textContent = (activeDifficultyFilter === 'all' ? currentIssues.length : filtered.length) + (activeDifficultyFilter === 'all' ? ' FOUND' : ' SHOWN');
  renderIssueCards(filtered);
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
  // Show or hide difficulty filter bar (only visible in shortlist view)
  if (difficultyFilterBar) {
    difficultyFilterBar.hidden = (activeViewMode !== 'shortlist') || (issues.length === 0);
  }

  const sorted = issues
    .map((issue, index) => ({ ...issue, pickMatchScore: getPickMatchScore(issue), originalIndex: index }))
    .sort((a, b) => b.pickMatchScore - a.pickMatchScore || a.originalIndex - b.originalIndex);

  currentIssues = sorted;

  if (!sorted.length) {
    results.innerHTML = '<div class="empty-state"><div class="empty-icon">⌕</div><strong>No matching starter issues came back.</strong><span>Try broader skills or remove a technology filter.</span></div>';
    count.textContent = '0 FOUND';
    if (diffCountLabel) diffCountLabel.textContent = '';
    return;
  }

  if (activeViewMode === 'learning') {
    renderLearningPathView();
  } else {
    applyDifficultyFilter();
  }
  updatePickButtons();
}


function renderIssueCards(issues) {
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
    const pickButtonContent = picked
      ? '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> <span>Added to picks</span>'
      : '<svg class="icon-svg" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> <span>I\u2019d work on this</span>';
    const similarBadge = issue.pickMatchScore > 0 ? '<span class="pick-similar">Similar to your picks</span>' : '';
    const difficultyBadge = renderDifficultyBadge(issue.difficulty);
    const freshnessClass = freshness.stale ? 'issue-freshness stale' : 'issue-freshness';
    const freshnessNote = freshness.stale
      ? 'May be stale. Recheck on GitHub before starting.'
      : 'Open and unassigned when GitHub returned it. Recheck before starting.';

    const repoUrl = 'https://github.com/' + escapeHtml(issue.repository);
    const contributingUrl = repoUrl + '/blob/HEAD/CONTRIBUTING.md';

    const diffBlock = renderDifficultyBlock(issue.difficulty);

    return [
      '<article class="issue-card">',
      '<div class="issue-top"><span class="repo">' + escapeHtml(issue.repository) + '</span><div class="issue-top-badges"><span class="score">' + score + '</span>' + difficultyBadge + similarBadge + '</div></div>',
      '<h3 class="issue-title"><a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.title) + '</a></h3>',
      '<p class="issue-reason">' + escapeHtml(issue.reason) + '</p>',
      '<div class="issue-evidence"><strong>Evidence from issue</strong>' + (evidence.length ? '<ul>' + evidence.map((item) => '<li><span class="evidence-source">' + escapeHtml(item.source) + '</span>' + (item.skill ? ' <span class="evidence-skill">[' + escapeHtml(item.skill) + ']</span>' : '') + ': "' + formatEvidenceQuote(item.quote, item.skill) + '"</li>').join('') + '</ul>' : '<p class="no-evidence">No exact skill phrase found in the issue text. Review it before relying on this match.</p>') + '</div>',
      '<div class="tags">' + tags + '</div>',
      diffBlock,
      '<div class="issue-bottom"><span class="first-step"><b>First step</b> · ' + escapeHtml(issue.firstStep) + '</span><div class="issue-actions"><button class="pick-button' + (picked ? ' picked' : '') + '" type="button" data-issue-id="' + issueId + '" aria-pressed="' + picked + '">' + pickButtonContent + '</button><a class="guide-link" href="' + contributingUrl + '" target="_blank" rel="noopener noreferrer" title="View repository contribution guidelines"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> <span>Guide</span></a><a class="open-link" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer"><span>View issue</span> <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a></div></div>',
      '<p class="' + freshnessClass + '"><span>' + escapeHtml(freshness.label) + '</span> · ' + freshnessNote + '</p>',
      '</article>',
    ].join('');
  }).join('');
  updatePickButtons();
}

/**
 * Identify practical skills a contributor may develop through an issue,
 * grounded strictly in actual issue content, tools, and signals.
 */
function identifySkillsToDevelop(issue) {
  const combined = `${issue.title || ''} ${issue.body || ''} ${(issue.labels || []).join(' ')}`.toLowerCase();
  const skills = new Set();

  if (issue.difficulty?.level === 'beginner') {
    skills.add('Git branch & Pull Request workflow');
    skills.add('CONTRIBUTING guide etiquette');
  }

  if (/\b(react|jsx|tsx|hooks?|component)\b/i.test(combined)) {
    skills.add('React component lifecycle & props');
  }
  if (/\b(typescript|ts|types?|interface)\b/i.test(combined)) {
    skills.add('TypeScript type definitions');
  }
  if (/\b(python|django|flask|pytest)\b/i.test(combined)) {
    skills.add('Python environment & testing');
  }
  if (/\b(css|html|ui|style|tailwind|contrast|wcag|responsive)\b/i.test(combined)) {
    skills.add('Accessible UI & CSS styling');
  }
  if (/\b(test|jest|unit test|integration|cypress|e2e|coverage|pytest)\b/i.test(combined)) {
    skills.add('Test suite verification & assertions');
  }
  if (/\b(api|route|endpoint|json|backend|express|rest)\b/i.test(combined)) {
    skills.add('API endpoints & request validation');
  }
  if (/\b(docs?|documentation|readme|typo|markdown)\b/i.test(combined)) {
    skills.add('Technical documentation clarity');
  }
  if (/\b(refactor|redesign|architecture|performance|optimize)\b/i.test(combined)) {
    skills.add('Code modularity & optimization');
  }
  if (/\b(debug|root cause|fix|crash|error|bug)\b/i.test(combined)) {
    skills.add('Root-cause debugging & reproduction');
  }

  (issue.matchedSkills || []).slice(0, 2).forEach((s) => {
    skills.add(`${s} practical usage`);
  });

  return Array.from(skills).slice(0, 4);
}

/**
 * Explain why an issue is suitable for the user's current learning stage.
 */
function getStageSuitability(issue, stage) {
  const diffLevel = getIssueDifficultyLevel(issue);
  if (stage === 'beginner') {
    if (diffLevel === 'beginner') {
      return 'Ideal starter step: Self-contained scope with a straightforward verification path, perfect for mastering the PR submission process without codebase overwhelm.';
    }
    return 'Gentle introduction: Helps you explore the repository structure and toolchain before diving into deeper tasks.';
  } else if (stage === 'intermediate') {
    if (diffLevel === 'intermediate') {
      return 'Core growth challenge: Requires investigating component behavior, tracing errors, and verifying changes with test assertions.';
    } else if (diffLevel === 'beginner') {
      return 'Quick confidence booster: Allows you to practice rapid reproduction and testing before taking on heavier logic changes.';
    }
    return 'Expands your problem-solving into multi-component interaction.';
  } else {
    // advanced
    if (diffLevel === 'advanced') {
      return 'High-impact milestone: Touches core subsystems, performance profiling, or multi-file architectural patterns requiring system design foresight.';
    }
    return 'Foundational deep-dive: Prepares you for major architectural contributions across this repository.';
  }
}

/**
 * Generate meaningful progress signals based on real contribution actions
 * without falsely claiming skill mastery.
 */
function getLearningStageProgressSignals() {
  const completed = Object.values(learningProfile.completedContributions || {});
  const inProgress = Object.values(learningProfile.inProgressContributions || {});
  const completedCount = completed.length;
  const inProgressCount = inProgress.length;

  const practicedSkills = new Set();
  completed.forEach((c) => {
    (c.skills || []).forEach((s) => practicedSkills.add(s));
  });

  let milestoneText = '';
  let unlockRecommendation = '';

  if (completedCount === 0) {
    milestoneText = 'Welcome to your learning path! We recommend starting in Stage 1 (Beginner) to make your first PR comfortably.';
    unlockRecommendation = 'Stage 1 active · Complete your first PR to unlock Stage 2 milestone recommendation.';
  } else if (completedCount < 2) {
    milestoneText = `Great milestone: ${completedCount} contribution completed! You've practiced open-source workflow and submission etiquette.`;
    unlockRecommendation = 'Stage 1 progress verified. You can continue building confidence in Stage 1 or challenge yourself in Stage 2.';
  } else if (completedCount < 4) {
    milestoneText = `Strong progress signal: ${completedCount} contributions completed with practical experience in ${Array.from(practicedSkills).slice(0, 3).join(', ') || 'starter workflows'}.`;
    unlockRecommendation = 'Stage 2 (Intermediate) strongly recommended: Ready for component logic, debugging, and testing.';
  } else {
    milestoneText = `Advanced progress signal: ${completedCount} contributions completed across repositories. Demonstrated consistent PR follow-through.`;
    unlockRecommendation = 'Stage 3 (Advanced) unlocked: Ready for architecture, refactoring, and multi-file contributions.';
  }

  return {
    completedCount,
    inProgressCount,
    practicedSkillsCount: practicedSkills.size,
    practicedSkillsList: Array.from(practicedSkills).slice(0, 4),
    milestoneText,
    unlockRecommendation,
  };
}

/**
 * Render the Personalized Learning Path view.
 */
function renderLearningPathView() {
  const stage = learningProfile.targetStage || 'beginner';
  const stageTitle = stage.charAt(0).toUpperCase() + stage.slice(1);

  // Update header stage indicator
  if (learningStageIndicator) {
    learningStageIndicator.textContent = `Stage: ${stageTitle}`;
    learningStageIndicator.className = `learning-pill-indicator stage-${stage}`;
  }

  // Update stage navigation buttons
  document.querySelectorAll('.stage-btn').forEach((btn) => {
    const isCurrent = btn.dataset.stage === stage;
    btn.classList.toggle('active', isCurrent);
    btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
  });

  // Update goal select
  if (learningGoalSelect) {
    learningGoalSelect.value = learningProfile.userGoal || 'first-pr';
  }

  // Render progress signals banner
  const signals = getLearningStageProgressSignals();
  if (learningProgressBanner) {
    const practicedText = signals.practicedSkillsCount > 0
      ? `<div class="progress-skills-note"><span>Practiced in completed tasks:</span> ${signals.practicedSkillsList.map(s => `<span class="practiced-skill-chip">${escapeHtml(s)}</span>`).join('')} <span class="no-mastery-disclaimer">(practice ongoing · not certified mastery)</span></div>`
      : '';

    learningProgressBanner.innerHTML = `
      <div class="progress-stats-row">
        <div class="stat-badge"><span class="stat-num">${signals.completedCount}</span> <span class="stat-label">PRs Completed</span></div>
        <div class="stat-badge"><span class="stat-num">${signals.inProgressCount}</span> <span class="stat-label">In Progress</span></div>
        <div class="stat-badge"><span class="stat-num">${signals.practicedSkillsCount}</span> <span class="stat-label">Skills Practiced</span></div>
        <div class="stage-status-box"><span class="current-stage-tag stage-${stage}">Active: Stage ${stage === 'beginner' ? '1' : stage === 'intermediate' ? '2' : '3'} (${stageTitle})</span></div>
      </div>
      <div class="progress-message-row">
        <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <div>
          <strong>${escapeHtml(signals.milestoneText)}</strong>
          <p>${escapeHtml(signals.unlockRecommendation)}</p>
        </div>
      </div>
      ${practicedText}
    `;
  }

  // Filter issues suitable for this stage
  const stageIssues = currentIssues.filter((issue) => {
    const level = getIssueDifficultyLevel(issue);
    if (stage === 'beginner') return level === 'beginner' || level === 'unknown';
    if (stage === 'intermediate') return level === 'intermediate';
    if (stage === 'advanced') return level === 'advanced';
    return true;
  });

  if (!stageIssues.length && currentIssues.length > 0) {
    results.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌕</div>
        <strong>No ${stageTitle} stage issues in this search shortlist.</strong>
        <span>Try switching to another stage above or enter broader skills to discover more issues.</span>
        <div class="empty-stage-actions">
          <button class="stage-nav-btn" type="button" onclick="setLearningStage('beginner')">Explore Stage 1 (Beginner)</button>
          <button class="stage-nav-btn" type="button" onclick="setLearningStage('intermediate')">Explore Stage 2 (Intermediate)</button>
          <button class="stage-nav-btn" type="button" onclick="setLearningStage('advanced')">Explore Stage 3 (Advanced)</button>
        </div>
      </div>
    `;
    count.textContent = '0 IN STAGE';
    return;
  }

  if (!currentIssues.length) {
    results.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">↗</div>
        <strong>Ready to start your personalized learning journey?</strong>
        <span>Enter your skills above (e.g. JavaScript, React, Python) to generate tailored recommendations for each stage.</span>
      </div>
    `;
    count.textContent = 'ROADMAP READY';
    return;
  }

  count.textContent = `${stageIssues.length} IN ${stageTitle.toUpperCase()} STAGE`;
  renderLearningPathCards(stageIssues, stage);
}

/**
 * Render issues formatted for the Personalized Learning Path.
 */
function renderLearningPathCards(issues, stage) {
  results.innerHTML = issues.map((issue) => {
    const issueId = escapeHtml(issue.id || '');
    const score = Number.isFinite(Number(issue.score)) ? Math.round(issue.score) + '% FIT' : 'MATCH';
    const freshness = formatIssueFreshness(issue.updatedAt);
    const difficultyBadge = renderDifficultyBadge(issue.difficulty);
    const repoUrl = 'https://github.com/' + escapeHtml(issue.repository);
    const contributingUrl = repoUrl + '/blob/HEAD/CONTRIBUTING.md';
    const skillsToDevelop = identifySkillsToDevelop(issue);
    const stageSuitability = getStageSuitability(issue, stage);

    const isInProgress = Boolean(learningProfile.inProgressContributions[issue.id]);
    const isCompleted = Boolean(learningProfile.completedContributions[issue.id]);
    const isPicked = Boolean(chosenIssues[issue.id]);

    const progressBtnClass = isInProgress ? 'learning-action-btn in-progress' : 'learning-action-btn';
    const progressBtnText = isInProgress
      ? '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> <span>In Progress</span>'
      : '<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <span>Work on this</span>';

    const completeBtnClass = isCompleted ? 'learning-action-btn completed' : 'learning-action-btn';
    const completeBtnText = isCompleted
      ? '<svg class="icon-svg" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span>PR Completed</span>'
      : '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> <span>Mark PR Done</span>';

    const pickButtonContent = isPicked
      ? '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> <span>In picks</span>'
      : '<svg class="icon-svg" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> <span>Save</span>';

    const stageNum = stage === 'beginner' ? '1' : stage === 'intermediate' ? '2' : '3';
    const stageName = stage.charAt(0).toUpperCase() + stage.slice(1);

    return `
      <article class="issue-card learning-card stage-card--${stage}">
        <div class="issue-top">
          <span class="repo">${escapeHtml(issue.repository)}</span>
          <div class="issue-top-badges">
            <span class="learning-stage-tag stage-${stage}">Stage ${stageNum} Recommendation</span>
            <span class="score">${score}</span>
            ${difficultyBadge}
          </div>
        </div>

        <h3 class="issue-title"><a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(issue.title)}</a></h3>

        <div class="learning-suitability-box">
          <div class="suitability-header">
            <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <strong>Why suitable for Stage ${stageNum} (${stageName}):</strong>
          </div>
          <p class="suitability-text">${escapeHtml(stageSuitability)}</p>
        </div>

        <div class="learning-skills-develop">
          <span class="skills-develop-label">Skills you may practice:</span>
          <div class="skills-develop-chips">
            ${skillsToDevelop.map((s) => `<span class="skill-dev-chip"><span class="chip-plus">+</span>${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>

        <div class="issue-bottom">
          <span class="first-step"><b>Next concrete action</b> · ${escapeHtml(issue.firstStep)}</span>
          <div class="learning-actions-row">
            <button class="pick-button${isPicked ? ' picked' : ''}" type="button" data-issue-id="${issueId}" aria-pressed="${isPicked}">
              ${pickButtonContent}
            </button>
            <button class="${progressBtnClass} learning-progress-btn" type="button" data-issue-id="${issueId}" aria-pressed="${isInProgress}">
              ${progressBtnText}
            </button>
            <button class="${completeBtnClass} learning-complete-btn" type="button" data-issue-id="${issueId}" aria-pressed="${isCompleted}">
              ${completeBtnText}
            </button>
            <a class="guide-link" href="${contributingUrl}" target="_blank" rel="noopener noreferrer" title="View repository contribution guidelines">
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              <span>Guide</span>
            </a>
            <a class="open-link" href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer">
              <span>View issue</span>
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>

        <p class="${freshness.stale ? 'issue-freshness stale' : 'issue-freshness'}">
          <span>${escapeHtml(freshness.label)}</span> · ${freshness.stale ? 'May be stale. Recheck on GitHub before starting.' : 'Open when GitHub returned it.'}
        </p>
      </article>
    `;
  }).join('');
}


function generateContributionPlanMarkdown() {
  const picks = Object.values(chosenIssues);
  if (!picks.length) return '';
  const dateStr = new Date().toISOString().slice(0, 10);
  let md = `# My Open-Source Starter Plan\n\n`;
  md += `*Generated with [IssueScout](http://localhost:4173) on ${dateStr}*\n\n`;

  const stage = learningProfile.targetStage || 'beginner';
  const stageTitle = stage.charAt(0).toUpperCase() + stage.slice(1);
  const signals = getLearningStageProgressSignals();
  md += `## Learning Path Status\n\n`;
  md += `- **Active Learning Stage**: Stage ${stage === 'beginner' ? '1' : stage === 'intermediate' ? '2' : '3'} (${stageTitle})\n`;
  md += `- **Target Goal**: ${learningProfile.userGoal || 'first-pr'}\n`;
  md += `- **Demonstrated Progress**: ${signals.completedCount} PRs completed · ${signals.inProgressCount} in progress · ${signals.practicedSkillsCount} skills practiced\n`;
  if (signals.practicedSkillsList.length > 0) {
    md += `- **Practiced Skills (Ongoing Practice)**: ${signals.practicedSkillsList.join(', ')}\n`;
  }
  md += `\n`;

  md += `## Selected Starter Issues (${picks.length})\n\n`;

  picks.forEach((item, idx) => {
    const title = item.title || `Issue #${item.id}`;
    const repo = item.repository || 'GitHub';
    const url = item.url || `https://github.com/${repo}`;
    const contributingUrl = `https://github.com/${repo}/blob/HEAD/CONTRIBUTING.md`;
    const skills = (item.matchedSkills || []).join(', ') || 'Starter';
    const step = item.firstStep || 'Review the issue and repository contribution guide.';
    const diffLevel = item.difficulty?.level ? (item.difficulty.level.charAt(0).toUpperCase() + item.difficulty.level.slice(1)) : 'Unknown';
    const diffExplanation = item.difficulty?.explanation || 'Difficulty not determined.';
    const scoreText = Number.isFinite(Number(item.score)) ? Math.round(item.score) + '% fit' : 'Match';

    md += `### ${idx + 1}. [${repo}] ${title}\n\n`;
    md += `- **Issue Link**: [View on GitHub](${url})\n`;
    md += `- **Contribution Guide**: [Read CONTRIBUTING.md](${contributingUrl})\n`;
    md += `- **Difficulty**: ${diffLevel} — ${diffExplanation}\n`;
    md += `- **Fit Score**: ${scoreText}\n`;
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

  md += `*Good luck with your open-source journey!*\n`;
  return md;
}

results.addEventListener('click', (event) => {
  // 1. Pick button
  const pickButton = event.target.closest('.pick-button');
  if (pickButton) {
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
        difficulty: issue.difficulty,
      };
      chosenIssues = Object.fromEntries(Object.entries(chosenIssues).slice(-50));
      showNotice('Marked as a pick! Similar starter issues will move higher on later searches.');
    }
    saveChosenIssues();
    renderIssues(currentIssues);
    return;
  }

  // 2. Learning Path: Work on this (in-progress)
  const progressBtn = event.target.closest('.learning-progress-btn');
  if (progressBtn) {
    const issue = currentIssues.find((item) => String(item.id) === progressBtn.dataset.issueId);
    if (!issue || !issue.id) return;

    if (learningProfile.inProgressContributions[issue.id]) {
      delete learningProfile.inProgressContributions[issue.id];
      showNotice('Removed from in-progress tasks.');
    } else {
      learningProfile.inProgressContributions[issue.id] = {
        id: issue.id,
        title: issue.title,
        repository: issue.repository,
        difficulty: issue.difficulty?.level || 'unknown',
        startedAt: new Date().toISOString(),
        skills: identifySkillsToDevelop(issue),
      };
      showNotice('Marked as In Progress! Focus on your next concrete step.');
    }
    saveLearningProfile();
    renderIssues(currentIssues);
    return;
  }

  // 3. Learning Path: Mark PR Done (completed)
  const completeBtn = event.target.closest('.learning-complete-btn');
  if (completeBtn) {
    const issue = currentIssues.find((item) => String(item.id) === completeBtn.dataset.issueId);
    if (!issue || !issue.id) return;

    if (learningProfile.completedContributions[issue.id]) {
      delete learningProfile.completedContributions[issue.id];
      showNotice('Removed completed PR milestone.');
    } else {
      delete learningProfile.inProgressContributions[issue.id];
      learningProfile.completedContributions[issue.id] = {
        id: issue.id,
        title: issue.title,
        repository: issue.repository,
        difficulty: issue.difficulty?.level || 'unknown',
        completedAt: new Date().toISOString(),
        skills: identifySkillsToDevelop(issue),
      };
      showNotice('Congratulations on your completed PR milestone! Progress signals have updated.');
    }
    saveLearningProfile();
    renderIssues(currentIssues);
    return;
  }
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
  const skeletonCard = '<article class="skeleton-card" aria-hidden="true"><div class="skeleton-bar short"></div><div class="skeleton-bar title"></div><div class="skeleton-bar medium"></div><div class="skeleton-box"></div></article>';
  results.innerHTML = skeletonCard + skeletonCard;
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

document.querySelectorAll('.preset-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.skills || '';
    technologyInput.value = chip.dataset.tech || '';
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
});

// Difficulty filter pill handlers — client-side only, no API calls
document.querySelectorAll('.diff-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    activeDifficultyFilter = pill.dataset.level || 'all';
    applyDifficultyFilter();
  });
});

// Reset difficulty filter button (resets to All Levels)
if (diffResetButton) {
  diffResetButton.addEventListener('click', () => {
    activeDifficultyFilter = 'all';
    applyDifficultyFilter();
    const allPill = document.querySelector('.diff-pill[data-level="all"]');
    if (allPill) allPill.focus();
  });
}

// Arrow key navigation for difficulty radio pills (Keyboard accessibility requirement 6)
if (diffPillsContainer) {
  diffPillsContainer.addEventListener('keydown', (event) => {
    const pills = Array.from(diffPillsContainer.querySelectorAll('.diff-pill'));
    const currentIndex = pills.findIndex((p) => p.dataset.level === activeDifficultyFilter);
    let nextIndex = -1;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % pills.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + pills.length) % pills.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIndex = pills.length - 1;
    }

    if (nextIndex >= 0) {
      const nextPill = pills[nextIndex];
      activeDifficultyFilter = nextPill.dataset.level || 'all';
      applyDifficultyFilter();
      nextPill.focus();
    }
  });
}

checkStatus();
updatePickButtons();

// View Mode Switching: Shortlist vs Personalized Learning Path
function switchViewMode(mode) {
  activeViewMode = mode;
  const isLearning = mode === 'learning';

  if (viewTabShortlist) {
    viewTabShortlist.classList.toggle('active', !isLearning);
    viewTabShortlist.setAttribute('aria-selected', !isLearning ? 'true' : 'false');
  }
  if (viewTabLearning) {
    viewTabLearning.classList.toggle('active', isLearning);
    viewTabLearning.setAttribute('aria-selected', isLearning ? 'true' : 'false');
  }
  if (learningPathPanel) {
    learningPathPanel.hidden = !isLearning;
  }
  if (difficultyFilterBar) {
    difficultyFilterBar.hidden = isLearning || (currentIssues.length === 0);
  }
  const resultsHeading = document.querySelector('#results-heading');
  if (resultsHeading) {
    resultsHeading.textContent = isLearning
      ? 'Personalized Learning Path Recommendations'
      : 'Good issues to start with';
  }
  if (pickPrivacyNote) {
    pickPrivacyNote.textContent = isLearning
      ? 'Track your real PR milestones and progressive skills without false mastery assumptions.'
      : 'Your picks stay in this browser and help move similar issues higher next time.';
  }
  renderIssues(currentIssues);
}

viewTabShortlist?.addEventListener('click', () => switchViewMode('shortlist'));
viewTabLearning?.addEventListener('click', () => switchViewMode('learning'));

// Stage buttons click delegation
document.querySelectorAll('.stage-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const stage = btn.dataset.stage;
    if (stage) setLearningStage(stage);
  });
});

window.setLearningStage = function (stage) {
  if (!['beginner', 'intermediate', 'advanced'].includes(stage)) return;
  learningProfile.targetStage = stage;
  saveLearningProfile();
  if (activeViewMode !== 'learning') {
    switchViewMode('learning');
  } else {
    renderLearningPathView();
  }
  showNotice(`Switched to Stage ${stage === 'beginner' ? '1 (Beginner)' : stage === 'intermediate' ? '2 (Intermediate)' : '3 (Advanced)'}.`);
};

// Learning goal selector
learningGoalSelect?.addEventListener('change', (event) => {
  learningProfile.userGoal = event.target.value;
  // Recommend matching stage based on user goal choice
  if (event.target.value === 'first-pr') {
    learningProfile.targetStage = 'beginner';
  } else if (event.target.value === 'logic-tests') {
    learningProfile.targetStage = 'intermediate';
  } else if (event.target.value === 'architecture') {
    learningProfile.targetStage = 'advanced';
  }
  saveLearningProfile();
  renderLearningPathView();
  showNotice('Updated target goal and aligned recommended learning stage.');
});

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
