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
  const navPicksBadge = document.querySelector('#nav-picks-count');
  if (navPicksBadge) {
    navPicksBadge.textContent = pickCount;
    navPicksBadge.hidden = pickCount === 0;
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
  if (notice) {
    notice.textContent = message;
    notice.className = 'notice ' + kind;
    notice.hidden = !message;
  }
  if (message) {
    showGlobalToast(message, kind);
  }
}

function showGlobalToast(message = '', kind = '') {
  const toastContainer = document.querySelector('#global-toast');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast-item ${kind || 'info'}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const icon = kind === 'error'
    ? '<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    : kind === 'success' || !kind
      ? '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
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

const TRUSTED_LEARNING_RESOURCES = {
  JavaScript: {
    name: 'MDN Web Docs — JavaScript',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    description: 'Official beginner-friendly guide to JavaScript syntax and features.',
  },
  TypeScript: {
    name: 'TypeScript Official Handbook',
    url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
    description: 'Official introduction to types, interfaces, and compiler basics.',
  },
  Python: {
    name: 'Python Official Tutorial',
    url: 'https://docs.python.org/3/tutorial/',
    description: 'Official standard library guide covering Python essentials.',
  },
  React: {
    name: 'React Official Docs — Quick Start',
    url: 'https://react.dev/learn',
    description: 'Interactive introduction to components, state, hooks, and props.',
  },
  'Node.js': {
    name: 'Node.js Official Documentation',
    url: 'https://nodejs.org/en/learn',
    description: 'Official guide to Node.js modules, event loops, and asynchronous I/O.',
  },
  HTML: {
    name: 'MDN Web Docs — HTML Basics',
    url: 'https://developer.mozilla.org/en-US/docs/Learn/HTML',
    description: 'Structured guide on HTML5 elements, semantic structure, and accessibility.',
  },
  CSS: {
    name: 'MDN Web Docs — CSS First Steps',
    url: 'https://developer.mozilla.org/en-US/docs/Learn/CSS',
    description: 'Comprehensive reference for CSS selectors, layouts, Flexbox, and Grid.',
  },
  'Git / PR Workflow': {
    name: 'GitHub Docs — Contributing to Projects',
    url: 'https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project',
    description: 'Official guide on forking, branching, commits, and Pull Requests.',
  },
  Jest: {
    name: 'Jest Official Getting Started',
    url: 'https://jestjs.io/docs/getting-started',
    description: 'Quickstart on writing assertions and running JavaScript unit tests.',
  },
  Pytest: {
    name: 'Pytest Official Documentation',
    url: 'https://docs.pytest.org/en/stable/getting-started.html',
    description: 'Beginner guide to writing and running Python test cases.',
  },
  Go: {
    name: 'Go Official Tutorial',
    url: 'https://go.dev/doc/tutorial/getting-started',
    description: 'Official tutorial covering Go packages, functions, and testing.',
  },
  Rust: {
    name: 'The Rust Programming Language Book',
    url: 'https://doc.rust-lang.org/book/',
    description: 'Official open-source book introducing Rust syntax and cargo.',
  },
  Docker: {
    name: 'Docker Official Get Started Guide',
    url: 'https://docs.docker.com/get-started/',
    description: 'Introduction to Dockerfiles, images, and container environments.',
  },
  Markdown: {
    name: 'The Markdown Guide',
    url: 'https://www.markdownguide.org/getting-started/',
    description: 'Clear reference for formatting documentation, tables, and comments.',
  },
  GraphQL: {
    name: 'GraphQL Official Documentation',
    url: 'https://graphql.org/learn/',
    description: 'Official guide on queries, schemas, and GraphQL API fundamentals.',
  },
  Vue: {
    name: 'Vue.js Official Guide',
    url: 'https://vuejs.org/guide/introduction.html',
    description: 'Official quick start covering Vue reactive state and templates.',
  },
  SQL: {
    name: 'MDN Web Docs — SQL Reference',
    url: 'https://developer.mozilla.org/en-US/docs/Glossary/SQL',
    description: 'Introductory reference to database queries, tables, and CRUD operations.',
  },
  'GitHub Actions / CI': {
    name: 'GitHub Actions Quickstart',
    url: 'https://docs.github.com/en/actions/quickstart',
    description: 'Official guide to workflow YAML syntax, automated tests, and CI/CD runs.',
  },
};

/**
 * Retrieve skill-gap analysis object from issue or calculate client-side fallback.
 */
function getIssueSkillGap(issue) {
  if (issue.skillGap && Array.isArray(issue.skillGap.matchingSkills)) {
    return issue.skillGap;
  }

  const enteredSkills = (input?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const enteredTech = (technologyInput?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const userSet = new Set([...enteredSkills, ...enteredTech].map((s) => s.toLowerCase()));

  const matched = (issue.matchedSkills || []).map((s) => ({
    name: s,
    required: true,
    reason: `Directly matches your entered skill: ${s}`,
    evidence: 'Found in issue text / labels',
  }));

  const candidateGaps = [];
  const text = `${issue.title || ''} ${issue.body || ''} ${(issue.labels || []).join(' ')}`.toLowerCase();

  if (/\btypescript\b|\bts\b|\.tsx?\b/.test(text) && !userSet.has('typescript') && !userSet.has('ts')) {
    candidateGaps.push({
      name: 'TypeScript',
      required: true,
      reason: 'Issue mentions TypeScript or includes .ts/.tsx files requiring type definitions.',
      evidence: 'Detected in issue text / file extensions',
      resources: TRUSTED_LEARNING_RESOURCES.TypeScript,
    });
  }
  if (/\bpython\b|\.py\b/.test(text) && !userSet.has('python') && !userSet.has('py')) {
    candidateGaps.push({
      name: 'Python',
      required: true,
      reason: 'Issue requires Python code changes or script execution.',
      evidence: 'Detected in issue text / file extensions',
      resources: TRUSTED_LEARNING_RESOURCES.Python,
    });
  }
  if (/\bdocker\b|dockerfile/i.test(text) && !userSet.has('docker')) {
    candidateGaps.push({
      name: 'Docker',
      required: true,
      reason: 'Service containerization or Docker configuration is referenced.',
      evidence: 'Detected in issue text',
      resources: TRUSTED_LEARNING_RESOURCES.Docker,
    });
  }

  const helpful = [];
  if (/\bjest\b/.test(text)) {
    helpful.push({
      name: 'Jest',
      required: false,
      reason: 'Unit tests in this project use Jest assertions.',
      evidence: 'Mentioned in test instructions',
      resources: TRUSTED_LEARNING_RESOURCES.Jest,
    });
  }
  if (!userSet.has('git') && !userSet.has('git / pr workflow')) {
    helpful.push({
      name: 'Git / PR Workflow',
      required: false,
      reason: 'Forking, branching, and opening a clean Pull Request on GitHub.',
      evidence: 'General contribution process',
      resources: TRUSTED_LEARNING_RESOURCES['Git / PR Workflow'],
    });
  }

  const unconfirmedCount = candidateGaps.length;
  let readiness = 'ready';
  let readinessLabel = 'Ready to Start';
  let readinessSummary = 'You have entered the primary skills required for this issue.';

  if (unconfirmedCount === 1) {
    readiness = 'moderate';
    readinessLabel = '1 Unconfirmed Skill Gap';
    readinessSummary = `You match most skills, but ${candidateGaps[0].name} is unconfirmed in your profile. Review the guide below if needed.`;
  } else if (unconfirmedCount > 1) {
    readiness = 'needs-prep';
    readinessLabel = `${unconfirmedCount} Unconfirmed Skill Gaps`;
    readinessSummary = `The issue requires ${candidateGaps.map((s) => s.name).join(', ')}. Review the official learning resources below before contributing.`;
  }

  return {
    readiness,
    readinessLabel,
    readinessSummary,
    matchingSkills: matched,
    unconfirmedSkills: candidateGaps,
    helpfulSkills: helpful,
    totalRequired: matched.length + candidateGaps.length,
    unclearDescription: false,
    unclearWarning: null,
  };
}

/**
 * Render the dedicated Skill-Gap Analysis block with three distinct categories:
 * 1. Matching skills
 * 2. Missing or unverified skills (with verified official guides)
 * 3. Additional helpful skills
 */
function renderSkillGapBlock(issue) {
  const gap = getIssueSkillGap(issue);
  const readiness = gap.readiness || 'ready';
  const readinessLabel = gap.readinessLabel || 'Ready to Start';

  let readinessBadgeClass = 'gap-badge-ready';
  let readinessIcon = '✓';
  if (readiness === 'moderate') {
    readinessBadgeClass = 'gap-badge-moderate';
    readinessIcon = '⌕';
  } else if (readiness === 'needs-prep') {
    readinessBadgeClass = 'gap-badge-needs-prep';
    readinessIcon = '!';
  } else if (readiness === 'unconfirmed') {
    readinessBadgeClass = 'gap-badge-unconfirmed';
    readinessIcon = '?';
  }

  const matchingHtml = gap.matchingSkills.length
    ? gap.matchingSkills.map((item) => `
        <div class="skill-item-card match">
          <div class="skill-item-top">
            <span class="skill-item-name"><span class="item-status-icon">✓</span>${escapeHtml(item.name)}</span>
            <span class="skill-type-tag required">Required</span>
          </div>
          <p class="skill-item-reason">${escapeHtml(item.reason)}</p>
          <span class="skill-item-evidence">Source: ${escapeHtml(item.evidence)}</span>
        </div>
      `).join('')
    : `<div class="cat-empty-notice">No exact matches with your search input. Check unconfirmed & helpful skills below.</div>`;

  const unconfirmedHtml = gap.unconfirmedSkills.length
    ? gap.unconfirmedSkills.map((item) => {
        const res = item.resources;
        const resLink = res
          ? `<a class="skill-resource-link" href="${escapeHtml(res.url)}" target="_blank" rel="noopener noreferrer" title="Official beginner guide for ${escapeHtml(item.name)}">
               <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
               <span>${escapeHtml(res.name)}</span>
             </a>`
          : '';
        return `
          <div class="skill-item-card unconfirmed">
            <div class="skill-item-top">
              <span class="skill-item-name"><span class="item-status-icon">!</span>${escapeHtml(item.name)}</span>
              <span class="skill-type-tag unconfirmed-tag">Unconfirmed</span>
            </div>
            <p class="skill-item-reason">${escapeHtml(item.reason)}</p>
            ${res ? `<p class="skill-resource-desc">${escapeHtml(res.description)}</p>` : ''}
            <div class="skill-item-bottom">
              <span class="skill-item-evidence">Evidence: ${escapeHtml(item.evidence)}</span>
              ${resLink}
            </div>
          </div>
        `;
      }).join('')
    : `<div class="cat-all-clear">✓ All primary skills required by this issue match your entered profile!</div>`;

  const helpfulHtml = gap.helpfulSkills.length
    ? gap.helpfulSkills.map((item) => {
        const res = item.resources;
        const resLink = res
          ? `<a class="skill-resource-link helpful" href="${escapeHtml(res.url)}" target="_blank" rel="noopener noreferrer">
               <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
               <span>${escapeHtml(res.name)}</span>
             </a>`
          : '';
        return `
          <div class="skill-item-card helpful">
            <div class="skill-item-top">
              <span class="skill-item-name"><span class="item-status-icon">+</span>${escapeHtml(item.name)}</span>
              <span class="skill-type-tag helpful-tag">Helpful</span>
            </div>
            <p class="skill-item-reason">${escapeHtml(item.reason)}</p>
            <div class="skill-item-bottom">
              <span class="skill-item-evidence">${escapeHtml(item.evidence)}</span>
              ${resLink}
            </div>
          </div>
        `;
      }).join('')
    : `<div class="cat-empty-notice">No additional tools or workflows flagged.</div>`;

  const warningHtml = gap.unclearWarning
    ? `<div class="skill-gap-unclear-box">
         <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
         <span>${escapeHtml(gap.unclearWarning)}</span>
       </div>`
    : '';

  return `
    <details class="skill-gap-block" id="skill-gap-${escapeHtml(issue.id || '')}">
      <summary class="skill-gap-summary-btn">
        <div class="skill-gap-summary-left">
          <span class="skill-gap-icon-wrap">
            <svg class="icon-svg" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </span>
          <span class="skill-gap-title">Skill-Gap Analysis</span>
          <span class="skill-gap-badge ${readinessBadgeClass}">
            <span class="badge-icon">${readinessIcon}</span>
            <span>${escapeHtml(readinessLabel)}</span>
          </span>
        </div>
        <div class="skill-gap-summary-right">
          <span class="gap-toggle-hint">Review gaps & resources</span>
          <svg class="icon-svg skill-gap-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </summary>

      <div class="skill-gap-content">
        <div class="skill-gap-verdict-row">
          <p class="skill-gap-verdict-text">${escapeHtml(gap.readinessSummary)}</p>
          ${warningHtml}
        </div>

        <!-- Category Navigation & Swipe Hints -->
        <div class="skill-gap-nav-row">
          <div class="skill-cat-pills" role="tablist" aria-label="Category selector">
            <button class="skill-cat-pill active" type="button" data-cat="matching" aria-label="View matching skills">
              <span class="cat-pill-dot dot-matching"></span>
              <span>Matching (${gap.matchingSkills.length})</span>
            </button>
            <button class="skill-cat-pill" type="button" data-cat="unconfirmed" aria-label="View unconfirmed skill gaps">
              <span class="cat-pill-dot dot-unconfirmed"></span>
              <span>Unconfirmed Gaps (${gap.unconfirmedSkills.length})</span>
            </button>
            <button class="skill-cat-pill" type="button" data-cat="helpful" aria-label="View helpful skills">
              <span class="cat-pill-dot dot-helpful"></span>
              <span>Helpful (${gap.helpfulSkills.length})</span>
            </button>
          </div>
          <span class="skill-swipe-indicator" title="Swipe or click category tabs to view all 3 columns">
            <span>Swipe columns</span>
            <svg class="icon-svg" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </span>
        </div>

        <div class="skill-gap-categories-grid" tabindex="0" role="region" aria-label="Skill categories carousel">
          
          <!-- Category 1: Matching Skills -->
          <div class="skill-category-col cat-matching" data-category="matching">
            <div class="cat-header">
              <span class="cat-icon-badge">✓</span>
              <div class="cat-title-wrap">
                <strong>Matching Skills</strong>
                <span class="cat-sub">${gap.matchingSkills.length} verified in your profile</span>
              </div>
            </div>
            <div class="cat-items">
              ${matchingHtml}
            </div>
          </div>

          <!-- Category 2: Missing or Unverified Skills -->
          <div class="skill-category-col cat-unconfirmed" data-category="unconfirmed">
            <div class="cat-header">
              <span class="cat-icon-badge">!</span>
              <div class="cat-title-wrap">
                <strong>Unconfirmed Skills (Gaps)</strong>
                <span class="cat-sub">${gap.unconfirmedSkills.length} required · unconfirmed</span>
              </div>
            </div>
            <div class="cat-items">
              ${unconfirmedHtml}
            </div>
          </div>

          <!-- Category 3: Additional Helpful Skills -->
          <div class="skill-category-col cat-helpful" data-category="helpful">
            <div class="cat-header">
              <span class="cat-icon-badge">+</span>
              <div class="cat-title-wrap">
                <strong>Additional Helpful Skills</strong>
                <span class="cat-sub">${gap.helpfulSkills.length} optional / inferred workflows</span>
              </div>
            </div>
            <div class="cat-items">
              ${helpfulHtml}
            </div>
          </div>

        </div>

        <div class="skill-gap-footer-note">
          <span class="note-disclaimer"><b>Guidance:</b> Unconfirmed skills are not assumed missing — they simply were not listed in your search skills. Click the official learning guides above to review documentation before opening a PR.</span>
        </div>
      </div>
    </details>
  `;
}

/**
 * Safely retrieve repository health assessment or generate fallback from issue data.
 */
function getIssueRepoHealth(issue) {
  if (issue.repoHealth && typeof issue.repoHealth === 'object') {
    return issue.repoHealth;
  }

  const repo = issue.repository || 'unknown/repository';
  const issueAgeDays = issue.updatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(issue.updatedAt)) / 86400000))
    : null;

  return {
    repository: repo,
    status: 'unverified',
    statusLabel: 'Activity Data Unverified',
    statusSummary: `Repository signals could not be fetched live over the network. Issue was updated ${issueAgeDays !== null ? (issueAgeDays === 0 ? 'today' : issueAgeDays + 'd ago') : 'recently'}.`,
    score: null, // Avoid misleading scores when evidence is insufficient (Requirement 8)
    scoringCriteria: null,
    signals: [
      { name: 'Issue Update Recency', value: issueAgeDays !== null ? `Issue updated ${issueAgeDays === 0 ? 'today' : issueAgeDays + 'd ago'}` : 'Update timestamp unavailable', verified: false, sourceUrl: issue.url || `https://github.com/${repo}` },
      { name: 'Repository Source', value: 'Check commit & PR activity directly on GitHub', verified: false, sourceUrl: `https://github.com/${repo}` },
    ],
    isArchived: false,
    daysSincePush: null,
    observationPeriod: 'Past 90 days',
    checkedAt: new Date().toISOString(),
    qualityDisclaimer: 'Maintenance pace reflects recent change frequency, not code quality. Stable libraries often require fewer changes.',
    sources: {
      repo: `https://github.com/${repo}`,
      commits: `https://github.com/${repo}/commits`,
      releases: `https://github.com/${repo}/releases`,
      pulls: `https://github.com/${repo}/pulls`,
    },
    isFallback: true,
  };
}

function renderRepoHealthBadge(health) {
  if (!health) return '';
  const status = health.status || 'unverified';
  let dotClass = 'dot-active';
  if (status === 'moderate') dotClass = 'dot-moderate';
  else if (status === 'quiet') dotClass = 'dot-quiet';
  else if (status === 'archived') dotClass = 'dot-archived';
  else if (status === 'estimated' || status === 'unverified') dotClass = 'dot-unverified';

  return `
    <span class="repo-health-pill status-${escapeHtml(status)}" title="Repository Health: ${escapeHtml(health.statusSummary)}">
      <span class="repo-health-dot ${dotClass}"></span>
      <span class="repo-health-pill-text">${escapeHtml(health.statusLabel)}</span>
      ${health.score !== null ? `<span class="repo-health-pill-score">${health.score}/100</span>` : ''}
    </span>
  `;
}

function renderRepoHealthBlock(issue) {
  const health = getIssueRepoHealth(issue);
  const status = health.status || 'unverified';
  const checkedDate = health.checkedAt ? new Date(health.checkedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';

  let statusIcon = '●';
  if (status === 'active') statusIcon = '⚡';
  else if (status === 'moderate') statusIcon = '●';
  else if (status === 'quiet') statusIcon = '○';
  else if (status === 'archived') statusIcon = '⚠';
  else statusIcon = 'ℹ';

  const criteria = health.scoringCriteria;
  const scoringHtml = criteria ? `
    <div class="repo-scoring-breakdown">
      <div class="scoring-breakdown-header">
        <span class="scoring-breakdown-title">Normalized Maintenance Activity Score (0–100 Criteria):</span>
        <span class="scoring-total-badge">${health.score}/100</span>
      </div>
      <div class="scoring-bars-grid">
        <div class="scoring-bar-item">
          <div class="bar-label-row"><span>Commit Recency (max 35)</span><strong>${criteria.commitRecency.points}/35</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width: ${Math.round((criteria.commitRecency.points / 35) * 100)}%"></div></div>
          <span class="bar-detail">${escapeHtml(criteria.commitRecency.detail)}</span>
        </div>
        <div class="scoring-bar-item">
          <div class="bar-label-row"><span>Release Cadence (max 25)</span><strong>${criteria.releaseCadence.points}/25</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width: ${Math.round((criteria.releaseCadence.points / 25) * 100)}%"></div></div>
          <span class="bar-detail">${escapeHtml(criteria.releaseCadence.detail)}</span>
        </div>
        <div class="scoring-bar-item">
          <div class="bar-label-row"><span>Issue & PR Activity (max 25)</span><strong>${criteria.issuePrActivity.points}/25</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width: ${Math.round((criteria.issuePrActivity.points / 25) * 100)}%"></div></div>
          <span class="bar-detail">${escapeHtml(criteria.issuePrActivity.detail)}</span>
        </div>
        <div class="scoring-bar-item">
          <div class="bar-label-row"><span>Maintenance Status (max 15)</span><strong>${criteria.maintenanceStatus.points}/15</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width: ${Math.round((criteria.maintenanceStatus.points / 15) * 100)}%"></div></div>
          <span class="bar-detail">${escapeHtml(criteria.maintenanceStatus.detail)}</span>
        </div>
      </div>
    </div>
  ` : `
    <div class="repo-score-unassigned-notice">
      <span class="notice-icon">ℹ</span>
      <span><b>Score unassigned:</b> Live GitHub API data was limited or offline. Scores are not fabricated when evidence is insufficient.</span>
    </div>
  `;

  return `
    <details class="repo-health-block" id="repo-health-${escapeHtml(issue.id || '')}">
      <summary class="repo-health-summary-btn">
        <div class="repo-health-summary-left">
          <span class="repo-health-icon-wrap">
            <svg class="icon-svg" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </span>
          <span class="repo-health-title">Repository Health Assessment</span>
          <span class="repo-health-badge badge-${escapeHtml(status)}">
            <span class="badge-icon">${statusIcon}</span>
            <span>${escapeHtml(health.statusLabel)}</span>
            ${health.score !== null ? `<span class="health-badge-score">· ${health.score}/100</span>` : ''}
          </span>
        </div>
        <div class="repo-health-summary-right">
          <span class="repo-health-hint">Inspect maintenance signals</span>
          <svg class="icon-svg repo-health-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </summary>

      <div class="repo-health-content">
        <div class="repo-health-summary-box">
          <p class="repo-health-summary-text">${escapeHtml(health.statusSummary)}</p>
          <div class="repo-health-meta-row">
            <span class="meta-tag">Observation Window: ${escapeHtml(health.observationPeriod)}</span>
            <span class="meta-tag">Checked: ${escapeHtml(checkedDate)}</span>
            ${health.isArchived ? '<span class="meta-tag archived-tag">⚠ Archived Repository</span>' : ''}
            ${health.isFallback ? '<span class="meta-tag fallback-tag">ℹ Rate Limit Guard (Issue Signals)</span>' : ''}
          </div>
        </div>

        <!-- Activity vs Quality distinction (Requirement 6) -->
        <div class="repo-health-quality-callout">
          <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <p><b>Activity vs Quality Note:</b> Maintenance pace reflects recent change frequency, not code quality. Stable, battle-tested utilities often require fewer commits or releases.</p>
        </div>

        ${scoringHtml}

        <!-- Verifiable Signals Grid with direct links (Requirement 2, 10) -->
        <div class="repo-signals-grid">
          ${(health.signals || []).map((s) => `
            <div class="repo-signal-card ${s.verified ? 'verified' : 'unverified'}">
              <div class="signal-header">
                <span class="signal-name">${escapeHtml(s.name)}</span>
                <span class="signal-status-pill ${s.verified ? 'verified-pill' : 'unverified-pill'}">${s.verified ? 'Verified' : 'Estimated'}</span>
              </div>
              <span class="signal-value">${escapeHtml(s.value)}</span>
              <a class="signal-link" href="${escapeHtml(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">
                <span>View on GitHub</span>
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          `).join('')}
        </div>

        <!-- Activity Sources Quick Links (Requirement 10) -->
        <div class="repo-sources-row">
          <span class="sources-label">Direct Activity Sources:</span>
          <div class="sources-links-group">
            <a class="repo-source-btn" href="${escapeHtml(health.sources.repo)}" target="_blank" rel="noopener noreferrer">
              <span>Repository</span>
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <a class="repo-source-btn" href="${escapeHtml(health.sources.commits)}" target="_blank" rel="noopener noreferrer">
              <span>Commits</span>
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <a class="repo-source-btn" href="${escapeHtml(health.sources.releases)}" target="_blank" rel="noopener noreferrer">
              <span>Releases</span>
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
            <a class="repo-source-btn" href="${escapeHtml(health.sources.pulls)}" target="_blank" rel="noopener noreferrer">
              <span>Pull Requests</span>
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>
      </div>
    </details>
  `;
}

// ── Duplicate and Related Issue Detection Renderers ─────────────────
function getIssueRelatedIssues(issue) {
  if (Array.isArray(issue.relatedIssues)) return issue.relatedIssues;
  return [];
}

function renderRelatedIssuesBadge(relatedIssues) {
  if (!Array.isArray(relatedIssues)) return '';
  const dupMatch = relatedIssues.find((r) => r.relationship === 'possible_duplicate');
  const depMatch = relatedIssues.find((r) => r.relationship === 'dependency');

  if (dupMatch) {
    return `
      <span class="related-badge-indicator badge-dup" title="Potential duplicate issue identified in repository">
        <svg class="icon-svg" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Possible Duplicate</span>
      </span>
    `;
  }
  if (depMatch) {
    return `
      <span class="related-badge-indicator badge-dep" title="Issue has a blocking dependency or blocker">
        <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Dependency</span>
      </span>
    `;
  }
  if (relatedIssues.length > 0) {
    return `
      <span class="related-badge-indicator badge-rel" title="${relatedIssues.length} related or same-area issues identified">
        <svg class="icon-svg" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span>${relatedIssues.length} Related</span>
      </span>
    `;
  }
  return `
    <span class="related-badge-indicator badge-clean" title="No duplicate or blocking issues detected in analyzed repository activity">
      <svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      <span>0 Duplicates</span>
    </span>
  `;
}

function renderRelatedIssuesBlock(issue) {
  const related = getIssueRelatedIssues(issue);
  const dupCount = related.filter((r) => r.relationship === 'possible_duplicate').length;
  const depCount = related.filter((r) => r.relationship === 'dependency').length;

  let pillClass = 'pill-clean';
  let pillText = '0 Duplicates Detected';
  if (dupCount > 0) {
    pillClass = 'pill-warning';
    pillText = `${dupCount} Potential Duplicate${dupCount > 1 ? 's' : ''}`;
  } else if (depCount > 0) {
    pillClass = 'pill-dep';
    pillText = `${depCount} Dependency / Blocker${depCount > 1 ? 's' : ''}`;
  } else if (related.length > 0) {
    pillClass = 'pill-info';
    pillText = `${related.length} Related Task${related.length > 1 ? 's' : ''}`;
  }

  const repoName = issue.repository || 'repository';
  const ghSearchQuery = encodeURIComponent(`is:issue ${(issue.title || '').slice(0, 45)}`);
  const ghSearchUrl = `https://github.com/${escapeHtml(repoName)}/issues?q=${ghSearchQuery}`;

  return `
    <details class="related-issues-block" id="related-issues-${escapeHtml(issue.id || '')}">
      <summary class="related-summary-btn">
        <div class="related-summary-left">
          <span class="related-icon-wrap">
            <svg class="icon-svg" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </span>
          <span class="related-summary-title">Duplicate & Related Issue Detection</span>
          <span class="related-status-pill ${pillClass}">
            <span>${pillText}</span>
          </span>
        </div>
        <div class="related-summary-right">
          <span class="related-summary-hint">Check prior art & dependencies</span>
          <svg class="icon-svg related-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </summary>

      <div class="related-issues-body">
        <div class="related-guidance-callout">
          <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <p><b>Duplicate & Dependency Check:</b> Reviewing surrounding issues helps prevent overlapping pull requests, reveals existing test cases, and ensures no blocking prerequisites are missed. Matches are labeled as potential relationships based on available evidence.</p>
        </div>

        ${related.length === 0 ? `
          <div class="no-related-box">
            <svg class="icon-svg" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <div class="no-related-content">
              <strong>No duplicates or blocking dependencies found</strong>
              <span>No overlapping tasks were detected in recent repository activity. This issue appears independent and safe to claim.</span>
            </div>
          </div>
        ` : `
          <div class="related-items-grid">
            ${related.map((item) => {
              const stateClass = item.state === 'open' ? 'state-open' : 'state-closed';
              const stateText = item.state === 'open' ? 'Open' : 'Closed';
              let relTypeClass = 'rel-related';
              if (item.relationship === 'possible_duplicate') relTypeClass = 'rel-duplicate';
              else if (item.relationship === 'dependency') relTypeClass = 'rel-dependency';
              else if (item.relationship === 'same_area') relTypeClass = 'rel-same-area';

              return `
                <div class="related-item-card ${relTypeClass}">
                  <div class="related-item-top">
                    <span class="rel-badge-state ${stateClass}">${stateText}</span>
                    <span class="rel-badge-category ${relTypeClass}">${escapeHtml(item.relationshipLabel)}</span>
                    <span class="rel-badge-repo ${item.isSameRepo ? 'same-repo' : 'cross-repo'}">
                      ${item.isSameRepo ? 'Same Repository' : escapeHtml(item.repository)}
                    </span>
                  </div>

                  <h4 class="related-item-title">
                    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                      <span>${escapeHtml(item.title)}</span>
                      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  </h4>

                  <p class="related-item-explanation">${escapeHtml(item.explanation)}</p>

                  ${item.sharedSignals && item.sharedSignals.length > 0 ? `
                    <div class="related-signals-row">
                      <span class="signals-label">Evidence signals:</span>
                      <div class="signals-chips">
                        ${item.sharedSignals.map((sig) => `<span class="signal-chip">${escapeHtml(sig)}</span>`).join('')}
                      </div>
                    </div>
                  ` : ''}

                  <div class="related-item-footer">
                    <a class="view-related-gh-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                      <span>View issue on GitHub</span>
                      <svg class="icon-svg" viewBox="0 0 24 24"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
                    </a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}

        <div class="related-footer-bar">
          <span class="related-footer-text">Need to explore further discussions in this repository?</span>
          <a class="related-gh-search-btn" href="${ghSearchUrl}" target="_blank" rel="noopener noreferrer">
            <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>Search all issues in ${escapeHtml(repoName)}</span>
          </a>
        </div>
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


/**
 * Retrieves the structured match explanation or synthesizes a client-side fallback.
 * Strictly adheres to non-fabrication: only real text and quotes are preserved.
 */
function getIssueMatchExplanation(issue) {
  if (issue.matchExplanation && typeof issue.matchExplanation === 'object' && Array.isArray(issue.matchExplanation.matchingSkills)) {
    return issue.matchExplanation;
  }

  // Synthesize client-side fallback for saved picks or offline items
  const matched = Array.isArray(issue.matchedSkills) ? issue.matchedSkills : [];
  const fields = [
    { source: 'Title', text: String(issue.title || '') },
    { source: 'Description', text: String(issue.body || '') },
    { source: 'Labels', text: (issue.labels || []).join(', ') },
    { source: 'Repository', text: String(issue.repository || '') },
  ];

  const matchingSkills = matched.map((skill) => {
    const s = String(skill || '').trim();
    const sources = fields.filter((f) => matchSkillInText(f.text, s)).map((f) => f.source);
    return {
      name: s,
      source: sources.length ? sources.join(', ') : 'Issue metadata',
      primarySource: sources[0] || 'Metadata',
      verifiedInSource: sources.length > 0,
    };
  });

  const supportingEvidence = getIssueEvidence(issue);
  const gap = getIssueSkillGap(issue);
  const unconfirmedRequirements = (gap.unconfirmedSkills || []).slice(0, 4).map((g) => ({
    name: g.name,
    note: g.reason || `${g.name} may be required based on repository signals.`,
    isAiInterpreted: false,
  }));

  const limitations = [
    'Fit score is a relative ranking estimate based on skill overlap, not a guarantee that your contribution will succeed.',
    'Maintainer responsiveness and PR guidelines should be checked on GitHub before starting work.',
  ];

  if (!issue.body || issue.body.length < 150) {
    limitations.push('Issue description is brief; some project requirements or instructions may be omitted.');
  }
  if (!supportingEvidence.length) {
    limitations.push('No exact verbatim skill phrases were quoted from the issue body; match was inferred from tags or repository name.');
  }

  return {
    suitabilityReason: issue.reason || 'This open starter issue matches your entered skills and tech profile.',
    matchingSkills,
    supportingEvidence,
    unconfirmedRequirements,
    limitations,
    scoreDisclaimer: issue.scoreDisclaimer || 'This fit score is a relative ranking estimate based on skill overlap and issue signals, not a probability that your contribution will succeed.',
    sourceType: 'keyword-heuristic',
    sourceLabel: 'Issue Signal Analysis',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Renders the transparent AI Match Explanation block.
 * - Collapsible details element
 * - Clearly distinguishes source-backed evidence (📋 In Description, 📋 In Title) from AI interpretation (🤖 AI Interpreted)
 * - Highlights verbatim quotes from GitHub issue data
 * - Transparently communicates unconfirmed requirements and limitations
 * - Explains fit score is an estimation, not a success guarantee
 */
function renderMatchExplanationBlock(issue) {
  const expl = getIssueMatchExplanation(issue);
  const isAi = expl.sourceType === 'ai-analyzed';
  const scoreNum = Number.isFinite(Number(issue.score)) ? Math.round(issue.score) : null;
  const scoreText = scoreNum !== null ? `${scoreNum}% fit estimate` : 'Fit ranking estimate';

  // 1. Matching Skills HTML with source distinction
  const matchingSkillsHtml = expl.matchingSkills.length > 0
    ? expl.matchingSkills.map((m) => {
        const isVerified = m.verifiedInSource !== false;
        const chipClass = isVerified ? 'match-skill-verified' : 'match-skill-inferred';
        const icon = isVerified
          ? '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        const originLabel = isVerified ? `📋 In ${escapeHtml(m.source)}` : '🤖 AI-Inferred';
        return `
          <div class="match-skill-chip ${chipClass}">
            <span class="match-skill-name">${icon} ${escapeHtml(m.name)}</span>
            <span class="match-skill-origin" title="Source location: ${escapeHtml(m.source)}">${originLabel}</span>
          </div>
        `;
      }).join('')
    : '<span class="match-no-skills">General starter issue; no explicit skill phrase matched in text.</span>';

  // 2. Supporting Evidence Excerpts (Strictly real quotes, formatted with highlights)
  const evidenceHtml = expl.supportingEvidence && expl.supportingEvidence.length > 0
    ? `
      <div class="match-detail-section">
        <span class="match-section-label">Source-Backed Evidence Excerpts:</span>
        <ul class="match-evidence-list">
          ${expl.supportingEvidence.map((item) => `
            <li class="match-evidence-item">
              <div class="evidence-item-header">
                <span class="evidence-source-tag">📋 ${escapeHtml(item.source)}</span>
                ${item.skill ? `<span class="evidence-skill-tag">[${escapeHtml(item.skill)}]</span>` : ''}
                <span class="source-verified-tag">✓ Verified Real Excerpt</span>
              </div>
              <blockquote class="evidence-quote-box">"${formatEvidenceQuote(item.quote, item.skill)}"</blockquote>
            </li>
          `).join('')}
        </ul>
      </div>
    `
    : `
      <div class="match-detail-section">
        <span class="match-section-label">Source-Backed Evidence Excerpts:</span>
        <p class="no-evidence-note">No verbatim skill phrase was directly extracted from the issue text. Match was established through repository labels, technology tags, or issue metadata.</p>
      </div>
    `;

  // 3. Unconfirmed Requirements
  const unconfirmedHtml = expl.unconfirmedRequirements && expl.unconfirmedRequirements.length > 0
    ? `
      <div class="match-detail-section">
        <span class="match-section-label">Relevant Requirements Not Yet Confirmed:</span>
        <div class="match-unconfirmed-grid">
          ${expl.unconfirmedRequirements.map((u) => `
            <div class="match-unconfirmed-item">
              <span class="unconfirmed-name">⚠ ${escapeHtml(u.name)}</span>
              <span class="unconfirmed-note">${escapeHtml(u.note)}</span>
              ${u.isAiInterpreted ? '<span class="unconfirmed-ai-pill">AI Context</span>' : '<span class="unconfirmed-repo-pill">Repo Signal</span>'}
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '';

  // 4. Limitations & Uncertainty Notes
  const limitationsHtml = expl.limitations && expl.limitations.length > 0
    ? `
      <div class="match-limitations-box">
        <div class="limitations-header">
          <svg class="icon-svg warn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <strong>Limitations & Recommendation Uncertainty:</strong>
        </div>
        <ul class="limitations-list">
          ${expl.limitations.map((lim) => `<li>${escapeHtml(lim)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const originBadge = isAi
    ? '<span class="match-origin-badge origin-ai" title="Suitability analyzed by local AI (qwen2.5:1.5b-instruct)">🤖 AI Analyzed</span>'
    : '<span class="match-origin-badge origin-heuristic" title="Suitability matched by deterministic keywords and issue signals">📋 Keyword Match</span>';

  return `
    <details class="match-card-block">
      <summary class="match-why-summary">
        <div class="match-why-header">
          <svg class="icon-svg match-info-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z"/></svg>
          <span class="match-why-badge">Why this match?</span>
          ${originBadge}
          <span class="match-reason-preview">${escapeHtml(expl.suitabilityReason)}</span>
        </div>
        <div class="match-header-tags">
          <span class="match-score-pill" title="${escapeHtml(expl.scoreDisclaimer)}">${scoreText}</span>
          <svg class="icon-svg match-arrow" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </summary>
      <div class="match-breakdown-details">
        <!-- Suitability Explanation -->
        <div class="match-detail-section">
          <span class="match-section-label">Suitability Assessment:</span>
          <p class="match-suitability-text">${escapeHtml(expl.suitabilityReason)}</p>
        </div>

        <!-- Matching Skills & Source Attribution -->
        <div class="match-detail-section">
          <span class="match-section-label">Matching Skills & Source Location:</span>
          <div class="match-skills-grid">
            ${matchingSkillsHtml}
          </div>
        </div>

        <!-- Verified Real Quotes -->
        ${evidenceHtml}

        <!-- Unconfirmed Skills & Requirements -->
        ${unconfirmedHtml}

        <!-- Fit Score Transparency Disclaimer -->
        <div class="match-disclaimer-box">
          <svg class="icon-svg disclaimer-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <div class="disclaimer-content">
            <strong>Fit Score Transparency:</strong> ${escapeHtml(expl.scoreDisclaimer)}
          </div>
        </div>

        <!-- Limitations & Uncertainty -->
        ${limitationsHtml}
      </div>
    </details>
  `;
}

function renderIssueCards(issues) {
  results.innerHTML = issues.map((issue) => {
    const tags = [
      ...(issue.matchedSkills || []).map((skill) => '<span class="tag match-tag">' + escapeHtml(skill) + '</span>'),
      ...(issue.labels || []).slice(0, 3).map((label) => '<span class="tag">' + escapeHtml(label) + '</span>'),
    ].join('');
    const score = Number.isFinite(Number(issue.score)) ? Math.round(issue.score) + '% FIT' : 'MATCH';
    const freshness = formatIssueFreshness(issue.updatedAt);
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

    const matchBlock = renderMatchExplanationBlock(issue);
    const diffBlock = renderDifficultyBlock(issue.difficulty);
    const health = getIssueRepoHealth(issue);
    const healthBadge = renderRepoHealthBadge(health);
    const healthBlock = renderRepoHealthBlock(issue);
    const related = getIssueRelatedIssues(issue);
    const relatedBadge = renderRelatedIssuesBadge(related);
    const relatedBlock = renderRelatedIssuesBlock(issue);

    return [
      '<article class="issue-card">',
      '<div class="issue-top"><div class="issue-top-left"><span class="repo">' + escapeHtml(issue.repository) + '</span>' + healthBadge + '</div><div class="issue-top-badges"><span class="score" title="' + escapeHtml(issue.scoreDisclaimer || 'Relative ranking estimate based on skill overlap, not a success probability') + '">' + score + '</span>' + difficultyBadge + similarBadge + relatedBadge + '</div></div>',
      '<h3 class="issue-title"><a href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(issue.title) + '</a></h3>',
      matchBlock,
      '<div class="tags">' + tags + '</div>',
      diffBlock,
      renderSkillGapBlock(issue),
      healthBlock,
      relatedBlock,
      '<div class="issue-bottom"><span class="first-step"><b>First step</b> · ' + escapeHtml(issue.firstStep) + '</span><div class="issue-actions">' +
      '<button class="pick-button' + (picked ? ' picked' : '') + '" type="button" data-issue-id="' + issueId + '" aria-pressed="' + picked + '">' + pickButtonContent + '</button>' +
      '<button class="blueprint-btn" type="button" data-action="blueprint" data-issue-id="' + issueId + '" title="Step-by-step contribution plan"><svg class="icon-svg" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> <span>Blueprint</span></button>' +
      '<button class="pr-btn" type="button" data-action="pr-gen" data-issue-id="' + issueId + '" title="Generate PR Markdown"><svg class="icon-svg" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg> <span>PR Gen</span></button>' +
      '<a class="guide-link" href="' + contributingUrl + '" target="_blank" rel="noopener noreferrer" title="View repository contribution guidelines"><svg class="icon-svg" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> <span>Guide</span></a><a class="open-link" href="' + escapeHtml(issue.url) + '" target="_blank" rel="noopener noreferrer"><span>View issue</span> <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a></div></div>',
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
    const health = getIssueRepoHealth(issue);
    const healthBadge = renderRepoHealthBadge(health);
    const healthBlock = renderRepoHealthBlock(issue);
    const related = getIssueRelatedIssues(issue);
    const relatedBadge = renderRelatedIssuesBadge(related);
    const relatedBlock = renderRelatedIssuesBlock(issue);

    return `
      <article class="issue-card learning-card stage-card--${stage}">
        <div class="issue-top">
          <span class="repo">${escapeHtml(issue.repository)}</span>
          <div class="issue-top-badges">
            <span class="learning-stage-tag stage-${stage}">Stage ${stageNum} Recommendation</span>
            <span class="score">${score}</span>
            ${difficultyBadge}
            ${healthBadge}
            ${relatedBadge}
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

        ${renderSkillGapBlock(issue)}

        ${healthBlock}

        ${relatedBlock}

        <div class="issue-bottom">
          <span class="first-step"><b>Next concrete action</b> · ${escapeHtml(issue.firstStep)}</span>
          <div class="learning-actions-row">
            <button class="pick-button${isPicked ? ' picked' : ''}" type="button" data-issue-id="${issueId}" aria-pressed="${isPicked}">
              ${pickButtonContent}
            </button>
            <button class="blueprint-btn" type="button" data-action="blueprint" data-issue-id="${issueId}" title="Step-by-step contribution plan">
              <svg class="icon-svg" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
              <span>Blueprint</span>
            </button>
            <button class="pr-btn" type="button" data-action="pr-gen" data-issue-id="${issueId}" title="Generate PR Markdown">
              <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
              <span>PR Gen</span>
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
    const gap = getIssueSkillGap(item);
    const health = getIssueRepoHealth(item);
    const healthScoreText = health.score !== null ? `${health.score}/100 activity score` : 'Activity score unassigned';
    const related = getIssueRelatedIssues(item);

    const expl = getIssueMatchExplanation(item);

    md += `### ${idx + 1}. [${repo}] ${title}\n\n`;
    md += `- **Issue Link**: [View on GitHub](${url})\n`;
    md += `- **Contribution Guide**: [Read CONTRIBUTING.md](${contributingUrl})\n`;
    md += `- **Difficulty**: ${diffLevel} — ${diffExplanation}\n`;
    md += `- **Fit Score**: ${scoreText} *(Ranking estimate based on skill overlap, not a guarantee of success)*\n`;
    md += `- **Match Explanation** (${expl.sourceLabel}):\n`;
    md += `  - *Suitability*: ${expl.suitabilityReason}\n`;
    if (expl.matchingSkills.length > 0) {
      md += `  - *Matching Skills*: ${expl.matchingSkills.map((m) => `${m.name} (${m.verifiedInSource ? 'In ' + m.source : 'AI Inferred'})`).join(', ')}\n`;
    }
    if (expl.supportingEvidence && expl.supportingEvidence.length > 0) {
      md += `  - *Verified Real Excerpts*: ${expl.supportingEvidence.map((e) => `"${e.quote}" [${e.source}]`).join('; ')}\n`;
    }
    if (expl.unconfirmedRequirements && expl.unconfirmedRequirements.length > 0) {
      md += `  - *Unconfirmed Requirements*: ${expl.unconfirmedRequirements.map((u) => u.name).join(', ')}\n`;
    }
    if (expl.limitations && expl.limitations.length > 0) {
      md += `  - *Limitations / Uncertainty*: ${expl.limitations.join('; ')}\n`;
    }
    md += `- **Repository Health**: ${health.statusLabel} (${healthScoreText})\n`;
    if (health.summary) {
      md += `  - Health Summary: ${health.summary}\n`;
    }
    if (health.sources) {
      md += `  - Activity Sources: [Commits](${health.sources.commitsUrl}) · [Pull Requests](${health.sources.pullsUrl}) · [Releases](${health.sources.releasesUrl})\n`;
    }
    if (related && related.length > 0) {
      md += `- **Duplicate & Related Issues Checked** (${related.length} identified):\n`;
      related.forEach((rel) => {
        md += `  - [${rel.state.toUpperCase()}] **${rel.relationshipLabel}**: [${rel.repository} - ${rel.title}](${rel.url})\n`;
        md += `    *${rel.explanation}*\n`;
      });
    } else {
      md += `- **Duplicate & Related Issues Checked**: No duplicate or blocking issues detected in analyzed repository records.\n`;
    }
    md += `- **Skill-Gap Status**: ${gap.readinessLabel} (${gap.matchingSkills.length} matching, ${gap.unconfirmedSkills.length} unconfirmed gap${gap.unconfirmedSkills.length === 1 ? '' : 's'})\n`;
    if (gap.unconfirmedSkills.length > 0) {
      md += `  - Gaps to review: ${gap.unconfirmedSkills.map((s) => s.name + (s.resources ? ` ([${s.resources.name}](${s.resources.url}))` : '')).join(', ')}\n`;
    }
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
  // 0. Skill-Gap Category navigation pill click
  const catPill = event.target.closest('.skill-cat-pill');
  if (catPill) {
    const parentBlock = catPill.closest('.skill-gap-block');
    if (!parentBlock) return;
    const cat = catPill.dataset.cat;
    const targetCol = parentBlock.querySelector(`.skill-category-col[data-category="${cat}"]`);
    const grid = parentBlock.querySelector('.skill-gap-categories-grid');
    if (targetCol && grid) {
      const scrollPos = targetCol.offsetLeft - grid.offsetLeft - 8;
      grid.scrollTo({ left: Math.max(0, scrollPos), behavior: 'smooth' });
    }
    parentBlock.querySelectorAll('.skill-cat-pill').forEach((p) => {
      p.classList.toggle('active', p === catPill);
    });
    return;
  }

  // 0b. Blueprint button click
  const blueprintBtn = event.target.closest('[data-action="blueprint"], .blueprint-btn');
  if (blueprintBtn) {
    const issueId = blueprintBtn.dataset.issueId;
    const issue = findIssueById(issueId);
    if (issue) {
      setSelectedIssue(issue, 'blueprint');
    }
    return;
  }

  // 0c. PR Gen button click
  const prBtn = event.target.closest('[data-action="pr-gen"], .pr-btn');
  if (prBtn) {
    const issueId = prBtn.dataset.issueId;
    const issue = findIssueById(issueId);
    if (issue) {
      setSelectedIssue(issue, 'pr-gen');
    }
    return;
  }

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
        skillGap: issue.skillGap,
        repoHealth: issue.repoHealth,
        relatedIssues: issue.relatedIssues || [],
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

// Sync active category pill when user swipes or scrolls the skill-gap grid
results.addEventListener('scroll', (event) => {
  const grid = event.target.closest?.('.skill-gap-categories-grid') || (event.target.classList?.contains('skill-gap-categories-grid') ? event.target : null);
  if (!grid) return;
  const parentBlock = grid.closest('.skill-gap-block');
  if (!parentBlock) return;
  const cols = Array.from(grid.querySelectorAll('.skill-category-col'));
  if (!cols.length) return;

  const scrollLeft = grid.scrollLeft;
  let activeCol = cols[0];
  let minDiff = Infinity;

  cols.forEach((col) => {
    const diff = Math.abs((col.offsetLeft - grid.offsetLeft) - scrollLeft);
    if (diff < minDiff) {
      minDiff = diff;
      activeCol = col;
    }
  });

  const activeCat = activeCol.dataset.category;
  parentBlock.querySelectorAll('.skill-cat-pill').forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.cat === activeCat);
  });
}, { capture: true, passive: true });

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

/* ==========================================================================
   MASTER INTEGRATION: THEMES, ROUTING, BLUEPRINT, PR GEN, HANDBOOK, STREAM, PICKS
   ========================================================================== */


const SELECTED_ISSUE_KEY = 'issuescout:selected-issue';
const BLUEPRINT_PROGRESS_KEY = 'issuescout:blueprint-progress:v1';
const CONTRIBUTOR_USERNAME_KEY = 'issuescout:contributor-username';

let selectedIssue = loadSelectedIssue();
let streamPollingTimer = null;
let streamIsPaused = false;
let streamLastFetchedEvents = [];
let seenStreamEventIds = new Set();

/* --- Shared Selected Issue State --- */
function loadSelectedIssue() {
  try {
    const raw = localStorage.getItem(SELECTED_ISSUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSelectedIssue(issue, nextView = null) {
  if (!issue) return;
  selectedIssue = issue;
  try {
    localStorage.setItem(SELECTED_ISSUE_KEY, JSON.stringify(issue));
  } catch {}

  const issueNum = issue.number || (issue.url ? issue.url.split('/').pop() : '');
  showNotice(`Selected issue #${issueNum}: "${issue.title || 'Starter issue'}"`, 'info');

  if (nextView) {
    switchAppView(nextView);
  }
}

function findIssueById(issueId) {
  if (!issueId) return selectedIssue;
  const idStr = String(issueId);
  const foundInCurrent = currentIssues.find((item) => String(item.id) === idStr);
  if (foundInCurrent) return foundInCurrent;
  if (chosenIssues[idStr]) return chosenIssues[idStr];
  if (selectedIssue && String(selectedIssue.id) === idStr) return selectedIssue;
  return null;
}

/* --- 3. View Routing System --- */
const VIEW_IDS = ['find', 'blueprint', 'pr-gen', 'handbook', 'stream', 'picks'];

function initAppRouting() {
  document.querySelectorAll('.nav-tab, .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.nav || btn.dataset.view;
      if (view && VIEW_IDS.includes(view)) {
        switchAppView(view);
      }
    });
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '').trim();
    if (VIEW_IDS.includes(hash)) {
      switchAppView(hash, false);
    }
  });

  const initialHash = window.location.hash.replace('#', '').trim();
  if (VIEW_IDS.includes(initialHash)) {
    switchAppView(initialHash, false);
  } else {
    switchAppView('find', false);
  }
}

function switchAppView(viewId, updateHash = true) {
  if (!VIEW_IDS.includes(viewId)) viewId = 'find';

  // Toggle navigation buttons
  document.querySelectorAll('.nav-tab, .nav-btn').forEach((btn) => {
    const view = btn.dataset.nav || btn.dataset.view;
    const isActive = view === viewId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Toggle view containers
  VIEW_IDS.forEach((id) => {
    const el = document.querySelector(`#view-${id}`);
    if (el) {
      if (id === viewId) {
        el.classList.add('active');
        el.removeAttribute('hidden');
      } else {
        el.classList.remove('active');
        el.setAttribute('hidden', '');
      }
    }
  });

  if (updateHash && window.location.hash !== `#${viewId}`) {
    window.location.hash = `#${viewId}`;
  }

  // Handle stream polling lifecycle
  if (viewId === 'stream') {
    startStreamPolling();
  } else {
    stopStreamPolling();
  }

  // Trigger view renderers
  if (viewId === 'blueprint') {
    renderBlueprintView();
  } else if (viewId === 'pr-gen') {
    renderPRGeneratorView();
  } else if (viewId === 'handbook') {
    renderGitHandbookView();
  } else if (viewId === 'picks') {
    renderPicksView();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* --- 4. Fix Blueprint View --- */
function loadBlueprintProgress(issueId) {
  try {
    const map = JSON.parse(localStorage.getItem(BLUEPRINT_PROGRESS_KEY) || '{}');
    return map[issueId] || {};
  } catch {
    return {};
  }
}

function saveBlueprintProgress(issueId, progress) {
  try {
    const map = JSON.parse(localStorage.getItem(BLUEPRINT_PROGRESS_KEY) || '{}');
    map[issueId] = progress;
    localStorage.setItem(BLUEPRINT_PROGRESS_KEY, JSON.stringify(map));
  } catch {}
}

function getStoredContributorUsername() {
  try {
    return localStorage.getItem(CONTRIBUTOR_USERNAME_KEY) || 'your-username';
  } catch {
    return 'your-username';
  }
}

function setStoredContributorUsername(name) {
  try {
    localStorage.setItem(CONTRIBUTOR_USERNAME_KEY, name.trim());
  } catch {}
}

function extractReferencedFiles(issue) {
  if (!issue) return [];
  const text = `${issue.title || ''}\n${issue.body || ''}`;
  const fileRegex = /(?:[\w-]+\/)*[\w-]+\.(?:js|ts|jsx|tsx|py|go|rs|rb|java|cpp|c|h|md|json|yml|yaml|toml|css|html|sh)\b/gi;
  const matches = text.match(fileRegex) || [];
  const unique = [...new Set(matches.map((f) => f.trim()))].filter((f) => !f.startsWith('http') && f.length < 90);
  return unique.slice(0, 8);
}

function detectSuggestedCommands(issue) {
  const combined = `${issue?.title || ''} ${issue?.body || ''} ${(issue?.labels || []).join(' ')} ${issue?.repository || ''}`.toLowerCase();
  const commands = [];

  if (combined.includes('python') || combined.includes('pytest') || combined.includes('.py')) {
    commands.push({ tool: 'pytest', cmd: 'pytest -v', desc: 'Run Python test suite' });
    commands.push({ tool: 'flake8 / ruff', cmd: 'ruff check .', desc: 'Python linter & code checks' });
  } else if (combined.includes('rust') || combined.includes('cargo') || combined.includes('.rs')) {
    commands.push({ tool: 'cargo test', cmd: 'cargo test', desc: 'Run Rust unit and integration tests' });
    commands.push({ tool: 'cargo clippy', cmd: 'cargo clippy', desc: 'Rust static analysis and linter' });
  } else if (combined.includes('go') || combined.includes('golang') || combined.includes('.go')) {
    commands.push({ tool: 'go test', cmd: 'go test ./...', desc: 'Run Go tests across all packages' });
    commands.push({ tool: 'golangci-lint', cmd: 'golangci-lint run', desc: 'Go linter suite' });
  } else {
    // Default Node.js / Web ecosystem
    commands.push({ tool: 'npm test', cmd: 'npm test', desc: 'Run repository test runner' });
    commands.push({ tool: 'npm run lint', cmd: 'npm run lint', desc: 'Check code formatting and lint rules' });
    commands.push({ tool: 'npm install', cmd: 'npm install', desc: 'Install project dependencies' });
  }

  return commands;
}

function renderBlueprintView() {
  const container = document.querySelector('#view-blueprint');
  if (!container) return;

  const issue = selectedIssue;
  if (!issue) {
    const pickList = Object.values(chosenIssues);
    container.innerHTML = `
      <div class="blueprint-empty-banner card">
        <div class="empty-icon-wrap">
          <svg class="empty-hero-icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        </div>
        <h2>Select an Issue to Build a Fix Blueprint</h2>
        <p>A Fix Blueprint gives you a step-by-step verified action plan: claiming the issue, setting up your fork, finding files, running tests, and preparing a clean PR.</p>
        <div class="empty-cta-actions">
          <button class="primary-btn" type="button" onclick="switchAppView('find')">Browse Starter Issues</button>
          ${pickList.length > 0 ? `<button class="secondary-btn" type="button" onclick="switchAppView('picks')">View My Picks (${pickList.length})</button>` : ''}
        </div>
        ${pickList.length > 0 ? `
          <div class="blueprint-recent-picks">
            <h4>Or start with one of your saved picks:</h4>
            <div class="recent-pick-chips">
              ${pickList.slice(0, 5).map((p) => `
                <button class="recent-pick-btn" type="button" data-issue-id="${p.id}">
                  <span class="pick-repo">${escapeHtml(p.repository || '')}</span>: ${escapeHtml(p.title || '')}
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    container.querySelectorAll('.recent-pick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = findIssueById(btn.dataset.issueId);
        if (p) setSelectedIssue(p, 'blueprint');
      });
    });
    return;
  }

  const issueId = String(issue.id || issue.url || 'current');
  const progress = loadBlueprintProgress(issueId);
  const totalSteps = 5;
  const completedSteps = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5'].filter((s) => progress[s]).length;
  const progressPct = Math.round((completedSteps / totalSteps) * 100);

  const repoFullName = issue.repository || 'owner/repo';
  const [repoOwner, repoName] = repoFullName.includes('/') ? repoFullName.split('/') : ['owner', repoFullName];
  const issueNum = issue.number || (issue.url ? issue.url.split('/').pop() : '1');
  const issueSlug = String(issue.title || 'starter')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const branchName = `fix-${issueNum}-${issueSlug || 'patch'}`;
  const username = getStoredContributorUsername();

  const filesFound = extractReferencedFiles(issue);
  const suggestedCommands = detectSuggestedCommands(issue);
  const claimCommentTemplate = `Hi @maintainers! I'd like to work on this issue if it's currently unassigned. I've reviewed the issue description and the contributing guidelines, and I plan to submit a minimal, tested PR. Thanks!`;

  container.innerHTML = `
    <div class="blueprint-container">
      <!-- Header Banner -->
      <header class="blueprint-header-card card">
        <div class="blueprint-topline">
          <div class="blueprint-meta">
            <span class="repo-badge">${escapeHtml(repoFullName)}</span>
            <span class="issue-badge">Issue #${escapeHtml(issueNum)}</span>
            ${renderDifficultyBadge(issue.difficulty)}
          </div>
          <div class="blueprint-header-actions">
            <button class="secondary-btn btn-sm" id="blueprint-change-issue-btn" type="button" title="Switch to another issue">Switch Issue</button>
            <button class="primary-btn btn-sm" type="button" onclick="switchAppView('pr-gen')" title="Open PR Generator for this issue">
              <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
              <span>Open in PR Gen</span>
            </button>
          </div>
        </div>
        <h1 class="blueprint-title">
          <a href="${escapeHtml(issue.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(issue.title || 'Starter Issue')}</a>
        </h1>
        <p class="blueprint-subtitle">Follow this 5-stage contribution blueprint to take this issue from discovery to an accepted pull request.</p>
        
        <!-- Progress Tracker -->
        <div class="blueprint-progress-box">
          <div class="progress-info-row">
            <span class="progress-label">Blueprint Completion: <b>${progressPct}%</b> (${completedSteps} of ${totalSteps} steps completed)</span>
            <button class="text-btn btn-xs" id="blueprint-reset-btn" type="button">Reset progress</button>
          </div>
          <div class="blueprint-progress-track" role="progressbar" aria-valuenow="${progressPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="blueprint-progress-fill" style="width: ${progressPct}%;"></div>
          </div>
        </div>
      </header>

      <!-- Step Cards -->
      <div class="blueprint-steps-stack">
        <!-- Step 1: Claim -->
        <section class="blueprint-step-card card ${progress['step-1'] ? 'step-completed' : ''}" data-step="step-1">
          <div class="step-card-header">
            <label class="step-checkbox-label">
              <input type="checkbox" class="step-checkbox" data-step="step-1" ${progress['step-1'] ? 'checked' : ''}/>
              <span class="step-pill">Stage 1</span>
              <span class="step-card-title">Verify Availability &amp; Request Assignment</span>
            </label>
          </div>
          <div class="step-card-body">
            <p>Before writing code, inspect the issue thread on GitHub. Look for recent comments from contributors saying "Can I work on this?" or existing pull requests that link to this issue.</p>
            <div class="blueprint-callout info">
              <svg class="icon-svg callout-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <span><b>Maintainer Etiquette:</b> Only request assignment if no active PR exists. Avoid commenting "I want to work on this" across multiple issues simultaneously.</span>
            </div>
            <div class="snippet-box">
              <div class="snippet-header">
                <span>Copyable maintainer comment template</span>
                <button class="copy-btn btn-xs" type="button" data-copy="${escapeHtml(claimCommentTemplate)}">Copy comment</button>
              </div>
              <textarea class="snippet-textarea" readonly rows="3">${claimCommentTemplate}</textarea>
            </div>
            <div class="step-actions-row">
              <a class="secondary-btn btn-sm" href="${escapeHtml(issue.url || '#')}" target="_blank" rel="noopener noreferrer">
                <span>Open Issue on GitHub</span>
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </div>
        </section>

        <!-- Step 2: Fork & Branch -->
        <section class="blueprint-step-card card ${progress['step-2'] ? 'step-completed' : ''}" data-step="step-2">
          <div class="step-card-header">
            <label class="step-checkbox-label">
              <input type="checkbox" class="step-checkbox" data-step="step-2" ${progress['step-2'] ? 'checked' : ''}/>
              <span class="step-pill">Stage 2</span>
              <span class="step-card-title">Fork Repository &amp; Configure Remote Branch</span>
            </label>
          </div>
          <div class="step-card-body">
            <p>Fork the repository on GitHub to your account, then clone your fork locally and configure an <code>upstream</code> remote pointing to the maintainer repo so you can fetch latest changes.</p>
            <div class="username-config-row">
              <label for="blueprint-username-input">Your GitHub Username:</label>
              <input type="text" id="blueprint-username-input" class="inline-input" value="${escapeHtml(username)}" placeholder="e.g. octocat" />
            </div>
            <div class="snippet-box">
              <div class="snippet-header">
                <span>Git setup commands for your terminal</span>
                <button class="copy-btn btn-xs" id="copy-fork-cmds-btn" type="button">Copy all commands</button>
              </div>
              <pre class="code-block" id="fork-cmds-pre"><code>git clone https://github.com/${escapeHtml(username)}/${escapeHtml(repoName)}.git
cd ${escapeHtml(repoName)}
git remote add upstream https://github.com/${escapeHtml(repoFullName)}.git
git fetch upstream
git checkout -b ${escapeHtml(branchName)}</code></pre>
            </div>
          </div>
        </section>

        <!-- Step 3: Locate Files & Reproduce -->
        <section class="blueprint-step-card card ${progress['step-3'] ? 'step-completed' : ''}" data-step="step-3">
          <div class="step-card-header">
            <label class="step-checkbox-label">
              <input type="checkbox" class="step-checkbox" data-step="step-3" ${progress['step-3'] ? 'checked' : ''}/>
              <span class="step-pill">Stage 3</span>
              <span class="step-card-title">Locate Target Files &amp; Reproduce Problem</span>
            </label>
          </div>
          <div class="step-card-body">
            <p>Before editing, read the relevant source files and reproduce the issue locally or write a failing test case.</p>
            ${filesFound.length > 0 ? `
              <div class="blueprint-files-box">
                <span class="files-box-title">Files explicitly mentioned in issue description:</span>
                <ul class="blueprint-files-list">
                  ${filesFound.map((f) => `
                    <li>
                      <a href="https://github.com/${escapeHtml(repoFullName)}/blob/HEAD/${escapeHtml(f)}" target="_blank" rel="noopener noreferrer">
                        <code>${escapeHtml(f)}</code>
                      </a>
                    </li>
                  `).join('')}
                </ul>
                <small class="verified-files-note">Note: Links open the file on the default branch of the official maintainer repository.</small>
              </div>
            ` : `
              <div class="blueprint-callout tip">
                <svg class="icon-svg callout-icon" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                <span>No specific filenames were detected in the issue text. Search the repository codebase for keywords from the issue title: <code>${escapeHtml(issue.title || '')}</code></span>
              </div>
            `}
            <div class="blueprint-instructions-block">
              <h5>Verification strategy:</h5>
              <ol class="blueprint-ordered-list">
                <li>Search for error messages or component names mentioned in the issue.</li>
                <li>Write a small reproducing test or manually verify the unexpected behavior.</li>
                <li>Never assume a bug is reproduced until you trigger it yourself in your development environment.</li>
              </ol>
            </div>
          </div>
        </section>

        <!-- Step 4: Run Tests & Linters -->
        <section class="blueprint-step-card card ${progress['step-4'] ? 'step-completed' : ''}" data-step="step-4">
          <div class="step-card-header">
            <label class="step-checkbox-label">
              <input type="checkbox" data-step="step-4" class="step-checkbox" ${progress['step-4'] ? 'checked' : ''}/>
              <span class="step-pill">Stage 4</span>
              <span class="step-card-title">Run Repository Tests &amp; Lint Checks</span>
            </label>
          </div>
          <div class="step-card-body">
            <p>Ensure that all existing tests and code formatting checks pass before making your changes, and again after implementing your fix.</p>
            <div class="commands-grid">
              ${suggestedCommands.map((c) => `
                <div class="command-card">
                  <div class="cmd-top">
                    <span class="cmd-name">${escapeHtml(c.tool)}</span>
                    <button class="copy-btn btn-xs" type="button" data-copy="${escapeHtml(c.cmd)}">Copy</button>
                  </div>
                  <pre class="cmd-snippet"><code>${escapeHtml(c.cmd)}</code></pre>
                  <span class="cmd-desc">${escapeHtml(c.desc)}</span>
                </div>
              `).join('')}
            </div>
            <p class="disclaimer-note">Disclaimer: Suggested commands are inferred from repository metadata and language indicators. Check the repository's <code>CONTRIBUTING.md</code> or <code>README.md</code> for authoritative instructions.</p>
          </div>
        </section>

        <!-- Step 5: Implement, Validate & Submit -->
        <section class="blueprint-step-card card ${progress['step-5'] ? 'step-completed' : ''}" data-step="step-5">
          <div class="step-card-header">
            <label class="step-checkbox-label">
              <input type="checkbox" data-step="step-5" class="step-checkbox" ${progress['step-5'] ? 'checked' : ''}/>
              <span class="step-pill">Stage 5</span>
              <span class="step-card-title">Commit, Push &amp; Open Pull Request</span>
            </label>
          </div>
          <div class="step-card-body">
            <p>Keep your changes focused strictly on resolving this single issue. Review your diff before committing.</p>
            <div class="snippet-box">
              <div class="snippet-header">
                <span>Commit &amp; Push commands</span>
                <button class="copy-btn btn-xs" id="copy-submit-cmds-btn" type="button">Copy commands</button>
              </div>
              <pre class="code-block" id="submit-cmds-pre"><code>git diff
git add .
git commit -m "fix: resolve ${escapeHtml(issueSlug || 'issue')} (fixes #${escapeHtml(issueNum)})"
git push -u origin ${escapeHtml(branchName)}</code></pre>
            </div>
            <div class="submit-cta-banner">
              <div class="cta-text">
                <b>Ready to write your pull request description?</b>
                <span>Use our PR Generator to build a structured, maintainer-friendly markdown description referencing #${escapeHtml(issueNum)}.</span>
              </div>
              <button class="primary-btn" type="button" onclick="switchAppView('pr-gen')">Launch PR Generator</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  // Attach blueprint event listeners
  container.querySelectorAll('.step-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const stepKey = e.target.dataset.step;
      const currentProgress = loadBlueprintProgress(issueId);
      currentProgress[stepKey] = e.target.checked;
      saveBlueprintProgress(issueId, currentProgress);

      const parentCard = e.target.closest('.blueprint-step-card');
      if (parentCard) parentCard.classList.toggle('step-completed', e.target.checked);

      // Refresh progress bar
      const updatedTotal = 5;
      const updatedCompleted = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5'].filter((s) => currentProgress[s]).length;
      const updatedPct = Math.round((updatedCompleted / updatedTotal) * 100);
      const fillEl = container.querySelector('.blueprint-progress-fill');
      const labelEl = container.querySelector('.progress-label b');
      if (fillEl) fillEl.style.width = `${updatedPct}%`;
      if (labelEl) labelEl.textContent = `${updatedPct}%`;

      if (e.target.checked) {
        showNotice(`Completed Stage ${stepKey.replace('step-', '')}!`, 'success');
      }
    });
  });

  const usernameInput = container.querySelector('#blueprint-username-input');
  if (usernameInput) {
    usernameInput.addEventListener('input', (e) => {
      const val = e.target.value.trim() || 'your-username';
      setStoredContributorUsername(val);
      const pre = container.querySelector('#fork-cmds-pre code');
      if (pre) {
        pre.textContent = `git clone https://github.com/${val}/${repoName}.git
cd ${repoName}
git remote add upstream https://github.com/${repoFullName}.git
git fetch upstream
git checkout -b ${branchName}`;
      }
    });
  }

  const copyForkBtn = container.querySelector('#copy-fork-cmds-btn');
  if (copyForkBtn) {
    copyForkBtn.addEventListener('click', async () => {
      const pre = container.querySelector('#fork-cmds-pre code');
      if (pre) {
        await copyToClipboard(pre.textContent);
        showNotice('Copied fork commands to clipboard.', 'success');
      }
    });
  }

  const copySubmitBtn = container.querySelector('#copy-submit-cmds-btn');
  if (copySubmitBtn) {
    copySubmitBtn.addEventListener('click', async () => {
      const pre = container.querySelector('#submit-cmds-pre code');
      if (pre) {
        await copyToClipboard(pre.textContent);
        showNotice('Copied commit & push commands.', 'success');
      }
    });
  }

  container.querySelectorAll('.copy-btn[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      if (text) {
        await copyToClipboard(text);
        showNotice('Copied to clipboard.', 'success');
      }
    });
  });

  const resetBtn = container.querySelector('#blueprint-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset your progress on this blueprint?')) {
        saveBlueprintProgress(issueId, {});
        renderBlueprintView();
        showNotice('Blueprint progress reset.', 'info');
      }
    });
  }

  const switchBtn = container.querySelector('#blueprint-change-issue-btn');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      switchAppView('find');
    });
  }
}

/* --- 5. PR Generator View --- */
const PR_TEMPLATES = {
  bugfix: {
    name: 'Bug Fix',
    prefix: 'fix',
    description: 'Fixes an issue or unintended behavior in the codebase.',
    summary: 'Briefly describe what bug this PR addresses and how the change resolves it.',
    testing: '- [ ] Ran existing test suite locally and verified all tests pass.\n- [ ] Added unit or integration test reproducing the bug to prevent regression.\n- [ ] Manually tested the fix in development environment.',
    checklist: [
      { text: 'My code follows the style guidelines of this project', checked: true },
      { text: 'I have performed a self-review of my own code', checked: true },
      { text: 'I have commented my code where necessary', checked: false },
      { text: 'I have verified that all existing and new tests pass', checked: true },
      { text: 'My changes generate no new warnings or lint errors', checked: true },
    ],
  },
  feature: {
    name: 'New Feature',
    prefix: 'feat',
    description: 'Adds new functionality, enhancements, or capabilities.',
    summary: 'Describe the new feature or capability added by this pull request.',
    testing: '- [ ] Added test coverage for new functionality.\n- [ ] Verified backwards compatibility.\n- [ ] Tested across supported platforms and browsers.',
    checklist: [
      { text: 'I have followed the architecture and contributing guidelines', checked: true },
      { text: 'I have added tests that prove my feature works', checked: true },
      { text: 'I have updated the corresponding documentation', checked: false },
      { text: 'My branch is up to date with the latest upstream main', checked: true },
    ],
  },
  docs: {
    name: 'Documentation',
    prefix: 'docs',
    description: 'Documentation updates, guide corrections, or typo fixes.',
    summary: 'Clarified instructions and corrected documentation for contributors.',
    testing: '- [ ] Previewed documentation build locally.\n- [ ] Checked for broken links and formatting issues.',
    checklist: [
      { text: 'I have verified the accuracy of the updated documentation', checked: true },
      { text: 'Grammar and formatting adhere to project standards', checked: true },
      { text: 'All links point to valid resources', checked: true },
    ],
  },
  refactor: {
    name: 'Refactor / Clean Up',
    prefix: 'refactor',
    description: 'Code restructuring without changing external behavior.',
    summary: 'Refactored code structure to improve maintainability and readability without altering external behavior.',
    testing: '- [ ] Ran complete test suite to ensure zero regressions.\n- [ ] Benchmarked performance where relevant.',
    checklist: [
      { text: 'Behavior remains identical to previous implementation', checked: true },
      { text: 'Existing tests continue to pass without modification', checked: true },
      { text: 'Code cleanliness and readability are improved', checked: true },
    ],
  },
};

let activePRTemplateKey = 'bugfix';

function renderPRGeneratorView() {
  const container = document.querySelector('#view-pr-gen');
  if (!container) return;

  const issue = selectedIssue;
  const issueNum = issue ? (issue.number || (issue.url ? issue.url.split('/').pop() : '')) : '';
  const repoFullName = issue?.repository || '';
  const initialTitle = issue ? `fix: resolve ${issue.title || 'issue'}` : 'fix: description of change';
  const initialRef = issue?.url || (issueNum ? `#${issueNum}` : '');

  const template = PR_TEMPLATES[activePRTemplateKey] || PR_TEMPLATES.bugfix;

  container.innerHTML = `
    <div class="pr-gen-layout">
      <!-- Top banner -->
      <header class="pr-gen-header card">
        <div class="pr-gen-header-top">
          <h2>Pull Request Description Generator</h2>
          ${issue ? `
            <div class="pr-selected-badge">
              <span>Linked to: <b>${escapeHtml(repoFullName)} #${escapeHtml(issueNum)}</b></span>
              <button class="text-btn btn-xs" type="button" onclick="switchAppView('blueprint')">View Blueprint</button>
            </div>
          ` : `
            <div class="pr-no-issue-badge">
              <span>No issue selected.</span>
              <button class="text-btn btn-xs" type="button" onclick="switchAppView('find')">Pick an issue</button>
            </div>
          `}
        </div>
        <p>Generate clean, maintainer-ready GitHub PR descriptions with structured summaries, testing verification, and checklists.</p>
        
        <!-- Template Selector -->
        <div class="template-pills-row">
          <span class="template-label">Template:</span>
          ${Object.entries(PR_TEMPLATES).map(([key, t]) => `
            <button class="template-pill ${key === activePRTemplateKey ? 'active' : ''}" type="button" data-tpl="${key}">
              ${escapeHtml(t.name)}
            </button>
          `).join('')}
        </div>
      </header>

      <!-- Main Split Pane -->
      <div class="pr-split-container">
        <!-- Left: Form & Raw Editor -->
        <div class="pr-editor-pane card">
          <div class="pane-header">
            <h3>PR Details</h3>
            <span class="pane-sub">Inputs automatically sync with Markdown preview</span>
          </div>

          <form id="pr-gen-form" class="pr-form">
            <div class="form-group">
              <label for="pr-title-input">PR Title</label>
              <input type="text" id="pr-title-input" class="form-control" value="${escapeHtml(initialTitle)}" placeholder="e.g. fix: handle missing token in auth header" required />
            </div>

            <div class="form-row">
              <div class="form-group col">
                <label for="pr-issue-input">Referenced Issue / URL</label>
                <input type="text" id="pr-issue-input" class="form-control" value="${escapeHtml(initialRef)}" placeholder="e.g. #42 or https://github.com/..." />
              </div>
              <div class="form-group col">
                <label for="pr-type-select">Type of Change</label>
                <select id="pr-type-select" class="form-control">
                  <option value="Bug fix (non-breaking change which fixes an issue)">Bug fix</option>
                  <option value="New feature (non-breaking change which adds functionality)">New feature</option>
                  <option value="Breaking change (fix or feature that causes existing functionality to change)">Breaking change</option>
                  <option value="Documentation update">Documentation</option>
                  <option value="Refactor or code cleanup">Refactor</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="pr-summary-textarea">Summary of Changes</label>
              <textarea id="pr-summary-textarea" class="form-control" rows="4" placeholder="Explain what was changed, why, and how it was implemented...">${escapeHtml(template.summary)}</textarea>
            </div>

            <div class="form-group">
              <label for="pr-testing-textarea">Testing Performed</label>
              <textarea id="pr-testing-textarea" class="form-control" rows="3" placeholder="Describe automated tests and manual verification performed...">${escapeHtml(template.testing)}</textarea>
            </div>

            <div class="form-group">
              <label>Checklist Items</label>
              <div class="pr-checklist-items" id="pr-checklist-box">
                ${template.checklist.map((item, idx) => `
                  <label class="pr-check-label">
                    <input type="checkbox" class="pr-check-cb" data-idx="${idx}" ${item.checked ? 'checked' : ''} />
                    <span>${escapeHtml(item.text)}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="form-group">
              <div class="raw-toggle-header">
                <label for="pr-raw-markdown">Direct Markdown Editor</label>
                <button class="text-btn btn-xs" id="pr-reset-fields-btn" type="button">Reset to Template</button>
              </div>
              <textarea id="pr-raw-markdown" class="form-control raw-md-box" rows="8"></textarea>
            </div>
          </form>
        </div>

        <!-- Right: Live Preview & Copy -->
        <div class="pr-preview-pane card">
          <div class="pane-header">
            <h3>GitHub Markdown Preview</h3>
            <div class="preview-actions">
              <button class="primary-btn btn-sm" id="pr-copy-md-btn" type="button">
                <svg class="icon-svg" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy Markdown</span>
              </button>
              <button class="secondary-btn btn-sm" id="pr-download-md-btn" type="button" title="Download PULL_REQUEST.md">
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Download .md</span>
              </button>
            </div>
          </div>
          <div class="markdown-preview-body" id="pr-rendered-preview"></div>
        </div>
      </div>
    </div>
  `;

  // Sync logic
  const titleInput = container.querySelector('#pr-title-input');
  const issueInput = container.querySelector('#pr-issue-input');
  const typeSelect = container.querySelector('#pr-type-select');
  const summaryArea = container.querySelector('#pr-summary-textarea');
  const testingArea = container.querySelector('#pr-testing-textarea');
  const rawTextarea = container.querySelector('#pr-raw-markdown');
  const previewBody = container.querySelector('#pr-rendered-preview');

  function buildMarkdownFromFields() {
    const title = titleInput?.value?.trim() || 'Pull Request';
    const issueRef = issueInput?.value?.trim() || '';
    const changeType = typeSelect?.value || 'Bug fix';
    const summary = summaryArea?.value?.trim() || '';
    const testing = testingArea?.value?.trim() || '';

    const checklistChecks = container.querySelectorAll('.pr-check-cb');
    const checklistLines = Array.from(checklistChecks).map((cb) => {
      const text = cb?.nextElementSibling?.textContent?.trim() || 'Checklist item';
      return `- [${cb?.checked ? 'x' : ' '}] ${text}`;
    }).join('\n');

    let issueSection = '';
    if (issueRef) {
      if (issueRef.startsWith('http')) {
        issueSection = `Fixes ${issueRef}`;
      } else if (issueRef.startsWith('#')) {
        issueSection = `Fixes ${issueRef}`;
      } else {
        issueSection = `Fixes #${issueRef}`;
      }
    } else {
      issueSection = '<!-- Reference issue here, e.g. Fixes #123 -->';
    }

    return `## Description
${summary || '<!-- Summary of changes made -->'}

## Related Issue
${issueSection}

## Type of Change
- ${changeType}

## Testing Performed
${testing || '<!-- Describe testing performed -->'}

## Checklist
${checklistLines}
`;
  }

  function updatePreview() {
    const md = buildMarkdownFromFields();
    if (rawTextarea && rawTextarea !== document.activeElement) {
      rawTextarea.value = md;
    }
    renderMarkdownToHtml(md, previewBody);
  }

  // Template pills
  container.querySelectorAll('.template-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      activePRTemplateKey = pill.dataset.tpl;
      renderPRGeneratorView();
    });
  });

  // Input listeners
  [titleInput, issueInput, typeSelect, summaryArea, testingArea].forEach((el) => {
    el?.addEventListener('input', updatePreview);
  });
  container.querySelectorAll('.pr-check-cb').forEach((cb) => {
    cb.addEventListener('change', updatePreview);
  });

  // Raw editor listener
  rawTextarea?.addEventListener('input', () => {
    renderMarkdownToHtml(rawTextarea.value, previewBody);
  });

  // Copy button
  const copyBtn = container.querySelector('#pr-copy-md-btn');
  copyBtn?.addEventListener('click', async () => {
    const md = rawTextarea.value || buildMarkdownFromFields();
    await copyToClipboard(md);
    showNotice('PR Markdown copied to clipboard!', 'success');
  });

  // Download button
  const downloadBtn = container.querySelector('#pr-download-md-btn');
  downloadBtn?.addEventListener('click', () => {
    const md = rawTextarea.value || buildMarkdownFromFields();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PULL_REQUEST-${issueNum || 'starter'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotice('Downloaded PULL_REQUEST.md file.', 'success');
  });

  // Reset button
  const resetFieldsBtn = container.querySelector('#pr-reset-fields-btn');
  resetFieldsBtn?.addEventListener('click', () => {
    renderPRGeneratorView();
  });

  // Initial preview render
  updatePreview();
}

/* --- Simple, Safe Markdown Preview Renderer --- */
function renderMarkdownToHtml(md, targetEl) {
  if (!targetEl) return;
  const lines = String(md || '').split('\n');
  let html = '';
  let inCodeBlock = false;
  let inList = false;

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        html += '</code></pre>';
        inCodeBlock = false;
      } else {
        html += '<pre class="preview-code"><code>';
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      html += escapeHtml(line) + '\n';
      return;
    }

    if (trimmed.startsWith('# ')) {
      html += `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
      return;
    }
    if (trimmed.startsWith('## ')) {
      html += `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
      return;
    }
    if (trimmed.startsWith('### ')) {
      html += `<h3>${escapeHtml(trimmed.slice(4))}</h3>`;
      return;
    }

    if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) {
      const isChecked = trimmed.startsWith('- [x] ');
      const text = trimmed.slice(6);
      html += `<div class="preview-check"><input type="checkbox" disabled ${isChecked ? 'checked' : ''} /> <span>${formatInlineMd(text)}</span></div>`;
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      html += `<li>${formatInlineMd(trimmed.slice(2))}</li>`;
      return;
    }

    if (trimmed.startsWith('> ')) {
      html += `<blockquote>${formatInlineMd(trimmed.slice(2))}</blockquote>`;
      return;
    }

    if (trimmed === '') {
      html += '<br />';
      return;
    }

    html += `<p>${formatInlineMd(line)}</p>`;
  });

  targetEl.innerHTML = html;
}

function formatInlineMd(text) {
  let s = escapeHtml(text);
  // `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // *italic*
  s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  // [link](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

/* --- 6. Git Handbook View --- */
const GIT_HANDBOOK_TOPICS = [
  {
    id: 'fundamentals',
    category: 'basics',
    title: '1. Git Fundamentals & The 4 Workspaces',
    description: 'Understand where your files live and how Git tracks state across working directory, index, and commits.',
    snippet: `Working Directory -> [git add] -> Staging Area (Index) -> [git commit] -> Local Repository -> [git push] -> Remote Repository`,
    details: 'Git records snapshots, not differences. Every commit points to the tree state and parent commit hash.',
    docsUrl: 'https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F',
  },
  {
    id: 'fork-clone',
    category: 'basics',
    title: '2. Forking and Cloning for Open-Source',
    description: 'How to make a personal copy on GitHub and download it to your local machine.',
    snippet: `git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
cd REPO_NAME
git remote add upstream https://github.com/ORIGINAL_OWNER/REPO_NAME.git
git remote -v`,
    details: 'Always set the maintainer repo as `upstream` so you can pull new changes as other contributors merge PRs.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Basics-Working-with-Remotes',
  },
  {
    id: 'branches',
    category: 'branching',
    title: '3. Branching & Switching Contexts',
    description: 'Never work directly on your main branch. Create descriptive feature branches for every pull request.',
    snippet: `git switch -c fix-issue-123-typo
# Or legacy syntax:
git checkout -b fix-issue-123-typo
git branch -a`,
    details: 'Branch names should be concise and kebab-cased: `fix-issue-number-short-desc` or `feat-login-validation`.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging',
  },
  {
    id: 'staging-commit',
    category: 'basics',
    title: '4. Staging and Crafting Clean Commits',
    description: 'Stage only files that belong to the fix. Review changes before committing.',
    snippet: `git status
git diff
git add path/to/file.js
git commit -m "fix(parser): resolve null token exception in header"`,
    details: 'Follow the Conventional Commits format (`fix:`, `feat:`, `docs:`, `test:`) to make maintainer review easy.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository',
  },
  {
    id: 'sync-upstream',
    category: 'upstream',
    title: '5. Syncing with Upstream (Keeping Branches Fresh)',
    description: 'Pull latest maintainer commits into your fork before opening or updating a PR.',
    snippet: `git fetch upstream
git switch main
git merge upstream/main
git switch fix-issue-123-typo
git rebase main`,
    details: 'Rebasing your feature branch on `upstream/main` ensures your pull request applies cleanly with zero merge commits.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Branching-Rebasing',
  },
  {
    id: 'push-pr',
    category: 'collaboration',
    title: '6. Pushing to Your Fork and Opening a PR',
    description: 'Send your commits to your GitHub fork and open the PR.',
    snippet: `git push -u origin fix-issue-123-typo`,
    details: 'GitHub will display a banner with a "Compare & pull request" button immediately after pushing.',
    docsUrl: 'https://docs.github.com/en/pull-requests/collaborating-with-pull-requests',
  },
  {
    id: 'conflicts',
    category: 'collaboration',
    title: '7. Resolving Merge Conflicts Step-by-Step',
    description: 'What to do when Git flags conflicting edits between your branch and upstream.',
    snippet: `git status
# Open conflicting files and locate markers:
# <<<<<<< HEAD (your change)
# =======
# >>>>>>> upstream/main (upstream change)
# Edit file to desired state, remove markers, then:
git add conflicting-file.js
git rebase --continue`,
    details: 'Never delete conflict markers without carefully verifying which lines to keep.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging#_basic_merge_conflicts',
  },
  {
    id: 'undoing-safe',
    category: 'undo',
    title: '8. Undoing Mistakes Safely',
    description: 'Unstage files, discard local working tree edits, or revert committed mistakes.',
    snippet: `# Unstage a file without losing edits:
git restore --staged path/to/file.js

# Discard uncommitted changes in a file:
git restore path/to/file.js

# Create a new commit that safely inverts a previous commit:
git revert COMMIT_HASH`,
    details: '`git revert` is the safest way to undo a commit in a shared branch because it preserves linear history.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things',
  },
  {
    id: 'stashing',
    category: 'basics',
    title: '9. Stashing Work in Progress',
    description: 'Temporarily shelve changes without committing so you can switch branches.',
    snippet: `git stash push -m "WIP on table layout"
git switch main
# Later, return to your branch and restore:
git switch fix-issue-123-typo
git stash pop`,
    details: 'Use `git stash list` to inspect saved stashes.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Tools-Stashing-and-Cleaning',
  },
  {
    id: 'amend-commits',
    category: 'undo',
    title: '10. Amending the Most Recent Commit',
    description: 'Fix typos or add a missed file to your latest unpushed commit.',
    snippet: `git add missed-file.js
git commit --amend --no-edit`,
    details: 'Only amend commits that have not been pushed to a public shared branch.',
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things#_changing_your_last_commit',
  },
  {
    id: 'git-config',
    category: 'basics',
    title: '11. Recommended Git Configuration & Aliases',
    description: 'Essential global settings for consistent author identity and faster workflows.',
    snippet: `git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --global init.defaultBranch main
git config --global pull.rebase true`,
    details: 'Ensure your Git author email matches the primary email on your GitHub account so commits are attributed to your profile.',
    docsUrl: 'https://git-scm.com/book/en/v2/Customizing-Git-Git-Configuration',
  },
  {
    id: 'danger-zone',
    category: 'danger',
    title: '12. Danger Zone: Destructive Commands & Warnings',
    description: 'Commands that can permanently delete uncommitted code or rewrite published history.',
    snippet: `# DANGER: Irreversibly deletes uncommitted edits in working directory!
git reset --hard HEAD

# DANGER: Deletes all untracked files and directories!
git clean -fd

# DANGER: Overwrites remote repository history!
git push --force`,
    details: 'Never run `git reset --hard` or `git clean -fd` if you have uncommitted changes you care about. Instead of `push --force`, use `git push --force-with-lease` if force-pushing is strictly necessary.',
    isDestructive: true,
    docsUrl: 'https://git-scm.com/book/en/v2/Git-Tools-Reset-Demystified',
  },
];

let activeHandbookCategory = 'all';
let handbookSearchQuery = '';

function renderGitHandbookView() {
  const container = document.querySelector('#view-handbook');
  if (!container) return;

  const filtered = GIT_HANDBOOK_TOPICS.filter((t) => {
    const matchesCat = activeHandbookCategory === 'all' || t.category === activeHandbookCategory;
    const q = handbookSearchQuery.toLowerCase().trim();
    const matchesQuery = !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.snippet.toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });

  container.innerHTML = `
    <div class="handbook-container">
      <header class="handbook-header card">
        <h1>Git Handbook for Open-Source Contributors</h1>
        <p>A reference guide covering Git workflows from forking to resolving merge conflicts and undoing mistakes safely.</p>
        
        <!-- Search and Category Filters -->
        <div class="handbook-controls">
          <div class="search-input-wrap">
            <svg class="search-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" id="handbook-search-input" class="search-input" placeholder="Search commands, conflicts, undo..." value="${escapeHtml(handbookSearchQuery)}" />
          </div>
          <div class="category-pills">
            ${[
              { id: 'all', label: 'All Topics' },
              { id: 'basics', label: 'Basics & Setup' },
              { id: 'branching', label: 'Branching' },
              { id: 'upstream', label: 'Sync Upstream' },
              { id: 'collaboration', label: 'PRs & Conflicts' },
              { id: 'undo', label: 'Undoing Safely' },
              { id: 'danger', label: 'Danger Zone' },
            ].map((c) => `
              <button class="cat-pill ${c.id === activeHandbookCategory ? 'active' : ''}" type="button" data-cat="${c.id}">
                ${c.label}
              </button>
            `).join('')}
          </div>
        </div>
      </header>

      <!-- Topic Cards -->
      <div class="handbook-cards-grid">
        ${filtered.length > 0 ? filtered.map((t) => `
          <article class="handbook-card card ${t.isDestructive ? 'destructive-card' : ''}">
            <div class="card-topline">
              <span class="category-tag ${t.category}">${escapeHtml(t.category.toUpperCase())}</span>
              ${t.isDestructive ? '<span class="danger-badge">CAUTION: DESTRUCTIVE</span>' : ''}
            </div>
            <h3>${escapeHtml(t.title)}</h3>
            <p class="topic-desc">${escapeHtml(t.description)}</p>
            
            <div class="code-snippet-box">
              <div class="snippet-header">
                <span>Terminal</span>
                <button class="copy-btn btn-xs" type="button" data-copy="${escapeHtml(t.snippet)}">Copy</button>
              </div>
              <pre class="code-block"><code>${escapeHtml(t.snippet)}</code></pre>
            </div>

            <p class="topic-details">${escapeHtml(t.details)}</p>

            <div class="card-footer">
              <a class="docs-link" href="${t.docsUrl}" target="_blank" rel="noopener noreferrer">
                <span>Official Git Documentation</span>
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </article>
        `).join('') : `
          <div class="no-topics-found card">
            <p>No handbook topics found matching "${escapeHtml(handbookSearchQuery)}".</p>
            <button class="secondary-btn btn-sm" type="button" onclick="handbookSearchQuery=''; activeHandbookCategory='all'; renderGitHandbookView();">Reset filters</button>
          </div>
        `}
      </div>
    </div>
  `;

  const searchInput = container.querySelector('#handbook-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      handbookSearchQuery = e.target.value;
      renderGitHandbookView();
    });
  }

  container.querySelectorAll('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      activeHandbookCategory = pill.dataset.cat;
      renderGitHandbookView();
    });
  });

  container.querySelectorAll('.copy-btn[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await copyToClipboard(btn.dataset.copy);
      showNotice('Copied command to clipboard.', 'success');
    });
  });
}

/* --- 7. GitHub Live Stream View --- */
function renderStreamLoading() {
  const container = document.querySelector('#view-stream');
  if (!container) return;
  container.innerHTML = `
    <div class="stream-container">
      <header class="stream-header card">
        <div class="stream-title-row">
          <div class="title-with-pulse">
            <span class="live-pulse-dot"></span>
            <h2>GitHub Live Activity Stream</h2>
          </div>
        </div>
        <p>Live stream of recent open-source public events across GitHub repositories. Real activity from GitHub API with intelligent caching.</p>
        <div class="stream-status-strip">
          <span class="status-item">Connecting to GitHub live activity…</span>
        </div>
      </header>
      <div class="stream-events-feed">
        <div class="stream-empty card" style="text-align: center; padding: 48px 20px;">
          <div class="skeleton-bar" style="width: 50%; height: 16px; margin: 0 auto 12px; background: var(--surface-3); border-radius: 4px;"></div>
          <div class="skeleton-bar" style="width: 35%; height: 14px; margin: 0 auto; background: var(--surface-3); border-radius: 4px;"></div>
          <p style="margin-top: 16px; color: var(--text-3); font-size: 13px;">Fetching latest public GitHub events…</p>
        </div>
      </div>
    </div>
  `;
}

function startStreamPolling() {
  if (streamPollingTimer) return;
  if (!streamLastFetchedEvents || !streamLastFetchedEvents.length) {
    renderStreamLoading();
  }
  fetchLiveStreamEvents();
  streamPollingTimer = setInterval(() => {
    if (!streamIsPaused && document.visibilityState === 'visible') {
      fetchLiveStreamEvents(true);
    }
  }, 45000);
}

function stopStreamPolling() {
  if (streamPollingTimer) {
    clearInterval(streamPollingTimer);
    streamPollingTimer = null;
  }
}

async function fetchLiveStreamEvents(isBackground = false) {
  const container = document.querySelector('#view-stream');
  const refreshBtn = container?.querySelector('#stream-refresh-btn');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    const res = await fetch('/api/stream');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];
    
    // Mark newly arrived events
    events.forEach((ev) => {
      if (!seenStreamEventIds.has(ev.id)) {
        ev.isNew = seenStreamEventIds.size > 0;
        seenStreamEventIds.add(ev.id);
      }
    });

    streamLastFetchedEvents = events;
    renderStreamEvents(data);
  } catch (err) {
    if (!isBackground) {
      renderStreamError(err.message);
    }
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }
}

function renderStreamEvents(meta = {}) {
  const container = document.querySelector('#view-stream');
  if (!container) return;

  const events = streamLastFetchedEvents;
  const isFallback = Boolean(meta.isFallback);
  const rateLimitRemaining = meta.rateLimitRemaining ?? '—';
  const lastUpdated = new Date().toLocaleTimeString();

  container.innerHTML = `
    <div class="stream-container">
      <header class="stream-header card">
        <div class="stream-title-row">
          <div class="title-with-pulse">
            <span class="live-pulse-dot ${streamIsPaused ? 'paused' : ''}"></span>
            <h2>GitHub Live Activity Stream</h2>
          </div>
          <div class="stream-top-actions">
            <button class="secondary-btn btn-sm" id="stream-pause-btn" type="button">
              ${streamIsPaused ? 'Resume Stream' : 'Pause Stream'}
            </button>
            <button class="primary-btn btn-sm" id="stream-refresh-btn" type="button">
              <svg class="icon-svg" viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Refresh Now</span>
            </button>
          </div>
        </div>

        <p>Live stream of recent open-source public events across GitHub repositories. Real activity from GitHub API with intelligent 60s caching.</p>

        <!-- Status strip -->
        <div class="stream-status-strip">
          <span class="status-item"><b>Events:</b> ${events.length}</span>
          <span class="status-item"><b>Last Updated:</b> ${lastUpdated}</span>
          <span class="status-item"><b>API Remaining:</b> ${rateLimitRemaining}</span>
          ${isFallback ? '<span class="status-item fallback-warning">Cached / Sample Feed (GitHub rate limit reached)</span>' : '<span class="status-item live-indicator">● Live GitHub Stream</span>'}
        </div>
      </header>

      <!-- Events List -->
      <div class="stream-events-feed">
        ${events.length > 0 ? events.map((ev) => `
          <article class="stream-event-card card ${ev.isNew ? 'event-new' : ''}">
            <div class="event-header">
              <div class="event-actor">
                ${ev.actorAvatar ? `<img class="actor-avatar" src="${escapeHtml(ev.actorAvatar)}" alt="" loading="lazy" />` : ''}
                <span class="actor-name">${escapeHtml(ev.actor || 'Contributor')}</span>
              </div>
              <div class="event-meta">
                <span class="event-type-badge ${escapeHtml(ev.type)}">${escapeHtml(formatEventType(ev.type))}</span>
                <time class="event-time" title="${escapeHtml(ev.createdAt)}">${formatRelativeTime(ev.createdAt)}</time>
                ${ev.isNew ? '<span class="new-pill">NEW</span>' : ''}
              </div>
            </div>
            
            <div class="event-body">
              <div class="event-repo-link">
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.repo)}</a>
              </div>
              ${ev.snippet ? `<p class="event-snippet">${escapeHtml(ev.snippet)}</p>` : ''}
            </div>

            <div class="event-card-actions">
              <a class="open-link" href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">
                <span>View on GitHub</span>
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </article>
        `).join('') : `
          <div class="stream-empty card">
            <p>No recent public events recorded in the stream right now. Click "Refresh Now" to query GitHub API.</p>
          </div>
        `}
      </div>
    </div>
  `;

  // Listeners
  const refreshBtn = container.querySelector('#stream-refresh-btn');
  refreshBtn?.addEventListener('click', () => {
    fetchLiveStreamEvents(false);
  });

  const pauseBtn = container.querySelector('#stream-pause-btn');
  pauseBtn?.addEventListener('click', () => {
    streamIsPaused = !streamIsPaused;
    showNotice(streamIsPaused ? 'Stream paused.' : 'Stream resumed.', 'info');
    renderStreamEvents(meta);
  });
}

function renderStreamError(errorMsg) {
  const container = document.querySelector('#view-stream');
  if (!container) return;
  container.innerHTML = `
    <div class="stream-error-box card">
      <h3>Live Stream Unavailable</h3>
      <p>Could not fetch GitHub activity stream: <code>${escapeHtml(errorMsg)}</code></p>
      <button class="primary-btn btn-sm" type="button" onclick="fetchLiveStreamEvents(false)">Retry Connection</button>
    </div>
  `;
}

function formatEventType(type) {
  switch (type) {
    case 'IssuesEvent': return 'Issue Updated';
    case 'PullRequestEvent': return 'Pull Request';
    case 'WatchEvent': return 'Starred Repo';
    case 'PushEvent': return 'Pushed Code';
    case 'ForkEvent': return 'Forked Repo';
    default: return type.replace('Event', '') || 'Activity';
  }
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'recently';
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/* --- 8. My Picks View --- */
function renderPicksView() {
  const container = document.querySelector('#view-picks');
  if (!container) return;

  const picks = Object.values(chosenIssues);

  container.innerHTML = `
    <div class="picks-container">
      <header class="picks-header card">
        <div class="picks-header-top">
          <div>
            <h2>My Saved Picks (${picks.length})</h2>
            <p>Your curated shortlist of starter issues. Saved issues influence future search ranking by prioritizing matching skills and repository patterns.</p>
          </div>
          <div class="picks-header-actions">
            ${picks.length > 0 ? `
              <button class="primary-btn btn-sm" id="picks-export-btn" type="button">
                <svg class="icon-svg" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                <span>Export Plan</span>
              </button>
              <button class="secondary-btn btn-sm" id="picks-clear-btn" type="button">Clear All</button>
            ` : ''}
          </div>
        </div>

        <div class="picks-privacy-callout">
          <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span><b>Local Browser Storage:</b> Your picks are saved locally in this browser (${picks.length}/50 items). No external account or personal data collection is required.</span>
        </div>
      </header>

      <!-- Picks Grid -->
      <div class="picks-grid">
        ${picks.length > 0 ? picks.map((p) => {
          const diffBadge = renderDifficultyBadge(p.difficulty);
          const issueId = String(p.id || '');
          const score = typeof p.score === 'number' ? `Fit Score: ${p.score}` : '';

          return `
            <article class="pick-card card" data-issue-id="${issueId}">
              <div class="pick-card-top">
                <span class="repo-badge">${escapeHtml(p.repository || 'Repository')}</span>
                <div class="pick-badges">
                  ${score ? `<span class="score">${score}</span>` : ''}
                  ${diffBadge}
                </div>
              </div>

              <h3 class="pick-card-title">
                <a href="${escapeHtml(p.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title || 'Issue')}</a>
              </h3>

              ${Array.isArray(p.matchedSkills) && p.matchedSkills.length > 0 ? `
                <div class="matched-skills-chips">
                  ${p.matchedSkills.map((s) => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('')}
                </div>
              ` : ''}

              <div class="pick-card-actions">
                <button class="primary-btn btn-sm" data-pick-action="blueprint" data-issue-id="${issueId}" type="button">
                  <svg class="icon-svg" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                  <span>Fix Blueprint</span>
                </button>
                <button class="secondary-btn btn-sm" data-pick-action="pr-gen" data-issue-id="${issueId}" type="button">
                  <svg class="icon-svg" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
                  <span>PR Gen</span>
                </button>
                <button class="text-btn btn-sm remove-pick-btn" data-pick-action="remove" data-issue-id="${issueId}" type="button" title="Remove from picks">
                  Remove
                </button>
              </div>
            </article>
          `;
        }).join('') : `
          <div class="picks-empty card">
            <svg class="empty-icon" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <h3>No Issues Saved Yet</h3>
            <p>Click the "Pick" button on any issue in the search results to save it here for later.</p>
            <button class="primary-btn" type="button" onclick="switchAppView('find')">Discover Issues</button>
          </div>
        `}
      </div>
    </div>
  `;

  // Attach action handlers
  container.querySelectorAll('[data-pick-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.pickAction;
      const id = btn.dataset.issueId;
      const issue = chosenIssues[id] || findIssueById(id);

      if (action === 'blueprint' && issue) {
        setSelectedIssue(issue, 'blueprint');
      } else if (action === 'pr-gen' && issue) {
        setSelectedIssue(issue, 'pr-gen');
      } else if (action === 'remove' && issue) {
        delete chosenIssues[id];
        saveChosenIssues();
        updatePickButtons();
        renderPicksView();
        showNotice('Removed issue from your picks.', 'info');
      }
    });
  });

  const exportBtn = container.querySelector('#picks-export-btn');
  exportBtn?.addEventListener('click', async () => {
    const md = generateContributionPlanMarkdown();
    if (!md) return;
    await copyToClipboard(md);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'issuescout-starter-plan.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotice('Exported contribution plan (downloaded and copied to clipboard)!', 'success');
  });

  const clearBtn = container.querySelector('#picks-clear-btn');
  clearBtn?.addEventListener('click', () => {
    if (confirm(`Remove all ${picks.length} saved picks?`)) {
      chosenIssues = {};
      saveChosenIssues();
      updatePickButtons();
      renderPicksView();
      showNotice('Cleared all saved picks.', 'info');
    }
  });
}

/* --- Clipboard Helper --- */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch {
    document.body.removeChild(ta);
    return false;
  }
}

// Global initialization - executed strictly once
let appInitialized = false;
function initAppOnce() {
  if (appInitialized) return;
  appInitialized = true;
  initAppRouting();
  updatePickButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppOnce);
} else {
  initAppOnce();
}

