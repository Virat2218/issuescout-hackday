import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b-instruct';
const githubToken = process.env.GITHUB_TOKEN;

function send(res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}

async function bodyJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function sanitizeTerm(term) {
  return String(term || '').replace(/[^\w#+.-]/g, '').trim();
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchSkillInText(text, skill) {
  if (!text || !skill) return false;
  const trimmed = skill.trim();
  if (!trimmed) return false;
  const escaped = escapeRegex(trimmed);
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9#+.-])${escaped}(?:$|[^a-zA-Z0-9#+.-])`, 'i');
  return regex.test(text);
}

function extractEvidence(issue, matchedSkills) {
  const fields = [
    { source: 'Issue title', text: String(issue.title || '') },
    { source: 'Issue description', text: String(issue.body || '') },
    { source: 'Issue labels', text: (issue.labels || []).join(', ') },
  ];
  const seen = new Set();
  const evidence = [];

  for (const skill of matchedSkills) {
    const trimmed = String(skill || '').trim();
    const normalized = trimmed.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;

    for (const field of fields) {
      if (matchSkillInText(field.text, trimmed)) {
        seen.add(normalized);
        const escaped = escapeRegex(trimmed);
        const regex = new RegExp(`(?:^|[^a-zA-Z0-9#+.-])(${escaped})(?:$|[^a-zA-Z0-9#+.-])`, 'i');
        const match = regex.exec(field.text);
        const index = match ? match.index + match[0].toLowerCase().indexOf(normalized) : field.text.toLowerCase().indexOf(normalized);
        const start = Math.max(0, index - 50);
        const end = Math.min(field.text.length, index + trimmed.length + 60);
        const snippet = field.text.slice(start, end).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        const quote = (start > 0 ? '…' : '') + snippet + (end < field.text.length ? '…' : '');
        evidence.push({ source: field.source, skill: trimmed, quote });
        break;
      }
    }
    if (evidence.length >= 3) break;
  }
  return evidence;
}

function detectReferencedFiles(body) {
  const fileRegex = /\b([a-zA-Z0-9_-]+\.(?:jsx?|tsx?|css|scss|html|json|md|py|go|rs|java|rb|sh|ya?ml))\b/gi;
  const matches = [];
  let m;
  while ((m = fileRegex.exec(body)) !== null && matches.length < 3) {
    if (!matches.includes(m[1])) matches.push(m[1]);
  }
  return matches;
}

/**
 * Estimate difficulty level of a GitHub issue using deterministic heuristics.
 * Returns a rich structured object:
 *   { level, explanation, confidence, signals, uncertainty, referencedFiles, bodyLength }
 *
 * - level: 'beginner' | 'intermediate' | 'advanced' | 'unknown'
 * - explanation: human-readable summary of why this level was assigned
 * - confidence: 'label' (explicit label match) | 'heuristic' (pattern analysis) | 'low' (insufficient data)
 * - signals: array of { factor, found, weight } — evidence supporting the estimate
 * - uncertainty: array of strings — what information is missing or conflicting
 * - referencedFiles: number of files explicitly mentioned in the issue body
 * - bodyLength: length of the issue body in characters
 *
 * Does NOT call the AI model — runs synchronously on every issue.
 * The `good first issue` label alone does NOT guarantee a Beginner rating.
 * The `help wanted` label is NOT treated as a difficulty signal.
 */
function estimateDifficulty(issue) {
  const labels     = (issue.labels || []);
  const labelStr   = labels.join(' ').toLowerCase();
  const titleStr   = (issue.title || '').toLowerCase();
  const bodyStr    = (issue.body  || '').toLowerCase();
  const combined   = `${titleStr} ${bodyStr} ${labelStr}`;
  const bodyLength = (issue.body || '').length;
  const referencedFiles = detectReferencedFiles(issue.body || '');
  const commentCount = issue.comments || 0;

  const signals = [];     // evidence collected
  const uncertainty = [];  // missing or conflicting info

  // ── Track missing information ──────────────────────────────────────────
  if (!issue.body || bodyLength < 30) {
    uncertainty.push('Issue description is very short or missing — difficulty estimate may be unreliable.');
  }
  if (!labels.length) {
    uncertainty.push('No labels present — cannot cross-reference difficulty labels.');
  }
  if (referencedFiles.length === 0 && bodyLength > 100) {
    uncertainty.push('No specific files referenced — scope of changes is unclear.');
  }

  // ── 1. Explicit difficulty labels (highest confidence) ─────────────────
  const ADVANCED_LABEL_RE   = /\b(difficulty[:-]hard|difficulty[:-]advanced|complexity[:-]high|senior|expert)\b/;
  const INTERMEDIATE_LABEL_RE = /\b(difficulty[:-]medium|skill[:-]intermediate|moderate)\b/;
  // Note: 'help wanted' is intentionally excluded — it does not indicate difficulty
  const BEGINNER_LABEL_RE   = /\b(good[- ]first[- ]issue|beginner|first[- ]timer|easy|starter|introductory|newbie)\b/;

  const hasAdvancedLabel     = ADVANCED_LABEL_RE.test(labelStr);
  const hasIntermediateLabel = INTERMEDIATE_LABEL_RE.test(labelStr);
  const hasBeginnerLabel     = BEGINNER_LABEL_RE.test(labelStr);
  const hasHacktoberfest     = /\bhacktoberfest\b/.test(labelStr);

  if (hasAdvancedLabel)     signals.push({ factor: 'Label explicitly marks advanced difficulty', found: true, weight: 'high' });
  if (hasIntermediateLabel) signals.push({ factor: 'Label explicitly marks intermediate difficulty', found: true, weight: 'high' });
  if (hasBeginnerLabel)     signals.push({ factor: 'Label marks issue as beginner-friendly (e.g. good first issue)', found: true, weight: 'medium' });
  if (hasHacktoberfest)     signals.push({ factor: 'Hacktoberfest label — typically beginner-friendly but not guaranteed', found: true, weight: 'low' });

  // ── 2. Scope & complexity signals ──────────────────────────────────────
  const scopeSignals = {
    refactorArchitecture: /\b(refactor|redesign|rewrite|overhaul|rearchitect)\b/i.test(combined),
    securityAuth:         /\b(security|auth|encryption|vulnerability|cve|oauth|jwt)\b/i.test(combined),
    performance:          /\b(performance|benchmark|optimize|profile|memory leak|race condition)\b/i.test(combined),
    breakingChange:       /\b(breaking change|api design|schema|migration|upgrade path)\b/i.test(combined),
    concurrency:          /\b(concurrency|thread|async queue|deadlock|websocket|worker)\b/i.test(combined),
    infrastructure:       /\b(database|redis|kubernetes|docker|ci\/cd|pipeline|deploy)\b/i.test(combined),
    testing:              /\b(unit test|integration test|e2e|coverage|mock|fixture)\b/i.test(combined),
    apiWork:              /\b(api|endpoint|route|middleware|hook|plugin)\b/i.test(combined),
    configuration:        /\b(configuration|environment|settings|feature flag|env var)\b/i.test(combined),
    debuggingInvestigation: /\b(debug|investigate|root cause|reproduce|regression|stack trace|segfault)\b/i.test(combined),
    dependenciesSetup:    /\b(dependency|upgrade dependency|package\.json|cargo\.toml|go\.mod|requirements\.txt|setup guide|toolchain)\b/i.test(combined),
    documentation:        /\b(documentation|readme|contributing|changelog|docs?)\b/i.test(combined),
    typoSmallFix:         /\b(typo|spelling|grammar|comment|rename|broken link|lint|format)\b/i.test(combined),
    smallTitle:           /\b(fix|update|correct|remove|add \w+ to)\b/i.test(titleStr),
  };

  const entityMentions = (bodyStr.match(/\b(file|class|module|function|component|hook|method|interface|struct)\b/gi) || []).length;
  const heavyDiscussion = commentCount > 15;
  const longBody = bodyLength > 600;
  const shortBody = bodyLength < 250 && titleStr.length < 80;
  const singleFile = referencedFiles.length === 1;
  const manyFiles = referencedFiles.length > 3;
  const manyEntities = entityMentions > 8;
  const hasAcceptanceCriteria = /acceptance criteria|tasks|to-do|\bchecklist\b/i.test(bodyStr);
  const hasTestRequirement = /\btest|pytest|jest|npm test|cargo test|go test\b/i.test(bodyStr);

  // Record what was found
  if (scopeSignals.refactorArchitecture) signals.push({ factor: 'Mentions refactoring or architectural changes', found: true, weight: 'high' });
  if (scopeSignals.securityAuth)         signals.push({ factor: 'Involves security, authentication, or encryption', found: true, weight: 'high' });
  if (scopeSignals.performance)          signals.push({ factor: 'Performance optimization or profiling required', found: true, weight: 'high' });
  if (scopeSignals.breakingChange)       signals.push({ factor: 'Breaking changes, schema migration, or API design', found: true, weight: 'high' });
  if (scopeSignals.concurrency)          signals.push({ factor: 'Concurrency, threading, or async queue work', found: true, weight: 'high' });
  if (scopeSignals.infrastructure)       signals.push({ factor: 'Infrastructure or deployment (database, Docker, CI/CD)', found: true, weight: 'medium' });
  if (scopeSignals.testing)              signals.push({ factor: 'Testing requirements (unit, integration, or e2e)', found: true, weight: 'medium' });
  if (scopeSignals.apiWork)              signals.push({ factor: 'API, endpoint, or middleware work', found: true, weight: 'medium' });
  if (scopeSignals.configuration)        signals.push({ factor: 'Configuration or environment setup changes', found: true, weight: 'medium' });
  if (scopeSignals.debuggingInvestigation) signals.push({ factor: 'Requires debugging, root cause analysis, or regression reproduction', found: true, weight: 'medium' });
  if (scopeSignals.dependenciesSetup)    signals.push({ factor: 'Dependency management, toolchain, or setup requirements', found: true, weight: 'medium' });
  if (scopeSignals.documentation)        signals.push({ factor: 'Documentation or README changes', found: true, weight: 'low' });
  if (scopeSignals.typoSmallFix)         signals.push({ factor: 'Small fix (typo, lint, formatting, broken link)', found: true, weight: 'low' });
  if (manyFiles)        signals.push({ factor: `${referencedFiles.length} files referenced — broad change scope`, found: true, weight: 'medium' });
  if (singleFile)       signals.push({ factor: 'Single file referenced — narrow scope', found: true, weight: 'low' });
  if (manyEntities)     signals.push({ factor: `${entityMentions} code entities mentioned — large surface area`, found: true, weight: 'medium' });
  if (heavyDiscussion)  signals.push({ factor: `${commentCount} comments — indicates complex or contested design`, found: true, weight: 'medium' });
  if (longBody)         signals.push({ factor: 'Long issue description (>600 chars) — detailed requirements', found: true, weight: 'low' });
  if (hasAcceptanceCriteria) signals.push({ factor: 'Has acceptance criteria or task checklist', found: true, weight: 'low' });

  // ── 3. Score each level ────────────────────────────────────────────────
  // Count weighted signals for advanced
  const advancedScore = [
    scopeSignals.refactorArchitecture,
    scopeSignals.securityAuth,
    scopeSignals.performance,
    scopeSignals.breakingChange,
    scopeSignals.concurrency,
    heavyDiscussion,
    manyEntities,
    manyFiles,
  ].filter(Boolean).length;

  const intermediateScore = [
    scopeSignals.apiWork,
    scopeSignals.testing,
    scopeSignals.configuration,
    scopeSignals.infrastructure,
    scopeSignals.debuggingInvestigation,
    scopeSignals.dependenciesSetup,
    advancedScore >= 1,
    longBody,
    hasTestRequirement,
  ].filter(Boolean).length;

  const beginnerScore = [
    scopeSignals.typoSmallFix,
    scopeSignals.smallTitle,
    scopeSignals.documentation,
    shortBody,
    singleFile,
  ].filter(Boolean).length;

  // ── 4. Determine level with conflict resolution ────────────────────────
  let level, explanation, confidence;

  if (hasAdvancedLabel) {
    level = 'advanced';
    explanation = 'Issue labels explicitly indicate advanced complexity.';
    confidence = 'label';
  } else if (hasIntermediateLabel) {
    level = 'intermediate';
    explanation = 'Issue labels explicitly indicate intermediate difficulty.';
    confidence = 'label';
  } else if (hasBeginnerLabel) {
    // CRITICAL: do NOT assign beginner solely from label — check for scope upgrades
    const scopeUpgradeCount = [
      scopeSignals.refactorArchitecture,
      scopeSignals.securityAuth,
      scopeSignals.performance,
      scopeSignals.infrastructure,
      scopeSignals.concurrency,
      manyFiles,
      manyEntities,
    ].filter(Boolean).length;

    if (scopeUpgradeCount >= 3) {
      level = 'advanced';
      explanation = 'Labelled beginner-friendly, but scope suggests a broad change involving multiple components or complex subsystems.';
      confidence = 'heuristic';
      uncertainty.push('Beginner label conflicts with detected complexity signals — the label may be inaccurate.');
    } else if (scopeUpgradeCount >= 1 || intermediateScore >= 2) {
      level = 'intermediate';
      explanation = 'Labelled beginner-friendly, but scope hints at moderate complexity (testing, infrastructure, or multi-file changes).';
      confidence = 'heuristic';
      uncertainty.push('Beginner label partially conflicts with scope signals — verify task boundaries before starting.');
    } else {
      level = 'beginner';
      explanation = 'The issue is labelled for first-time contributors and describes a small, clearly defined change.';
      confidence = 'label';
    }
  } else if (advancedScore >= 3) {
    level = 'advanced';
    explanation = 'The description suggests a broad change involving architectural refactoring, security, or multiple components.';
    confidence = 'heuristic';
  } else if (scopeSignals.debuggingInvestigation) {
    level = 'intermediate';
    explanation = 'The task appears to require debugging an existing component and validating changes with tests.';
    confidence = 'heuristic';
  } else if (intermediateScore >= 3) {
    level = 'intermediate';
    explanation = 'The task involves building or integrating functionality — API work, testing, or configuration setup detected.';
    confidence = 'heuristic';
  } else if (beginnerScore >= 2) {
    level = 'beginner';
    explanation = 'The issue describes a small, clearly defined change (documentation, typo, or minor fix) suitable for starters.';
    confidence = 'heuristic';
  } else {
    level = 'unknown';
    explanation = 'There is not enough reliable information in the available issue description to estimate the difficulty.';
    confidence = 'low';
    uncertainty.push('Consider reading the full issue thread on GitHub for additional context.');
  }

  // ── 5. Detect conflicting signals ──────────────────────────────────────
  if (beginnerScore >= 2 && advancedScore >= 2) {
    uncertainty.push('Issue shows both beginner-friendly and advanced signals — difficulty may vary depending on approach.');
  }

  // ── 6. Verified source-backed facts ────────────────────────────────────
  const sourceFacts = [];
  if (labels.length) {
    sourceFacts.push(`Labels: ${labels.slice(0, 3).join(', ')}`);
  }
  if (referencedFiles.length > 0) {
    sourceFacts.push(`${referencedFiles.length} file${referencedFiles.length === 1 ? '' : 's'} referenced (${referencedFiles.slice(0, 2).join(', ')}${referencedFiles.length > 2 ? '…' : ''})`);
  }
  if (hasAcceptanceCriteria) {
    sourceFacts.push('Has structured acceptance criteria or checklist');
  }
  if (hasTestRequirement) {
    sourceFacts.push('Mentions test suite or testing requirements');
  }

  return {
    level,
    explanation,
    confidence,
    signals: signals.slice(0, 6),   // cap at 6 most relevant
    uncertainty,
    sourceFacts,
    referencedFiles: referencedFiles.length,
    bodyLength,
  };
}

const memoryQueryCache = new Map();
const knownIssuesPool = new Map();

const BUNDLED_STARTER_ISSUES = [
  {
    id: 6016473906,
    title: "Escape the apostrophe in the More Human Than Human call for speakers",
    url: "https://github.com/devsanantonio/next-devsa/issues/6",
    repository: "devsanantonio/next-devsa",
    state: "open",
    createdAt: "2026-10-24T18:58:53Z",
    updatedAt: "2026-10-24T18:58:53Z",
    comments: 0,
    labels: ["good first issue", "react", "frontend"],
    body: "`pnpm lint` reports an error in the More Human Than Human call for speakers:\n\n```\ncomponents/aiconference/more-human-than-human.tsx\n 607:35 error `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;` react/no-unescaped-entities\n```\n\nIt's the apostrophe in \"San Antonio's builders\". In JSX text, write it as `&apos;` (or `&rsquo;` for a typographic apostrophe, which is what most of the site uses).\n\nDone when that line no longer appears in pnpm lint, and the page reads the same. See CONTRIBUTING.md.",
  },
  {
    id: 6016267731,
    title: "Add new Anime Quote - Good First Issue",
    url: "https://github.com/lingdojo/kana-dojo/issues/33090",
    repository: "lingdojo/kana-dojo",
    state: "open",
    createdAt: "2026-10-24T18:35:35Z",
    updatedAt: "2026-10-24T18:35:43Z",
    comments: 1,
    labels: ["good first issue", "help wanted", "hacktoberfest", "react", "typescript"],
    body: "## Good First Issue: Add Quote\nLanguage: TypeScript, JSON\nFramework: Next.js, React\nGood for: First-time contributors, Hacktoberfest\nOpen community/content/anime-quotes.json in your browser, add the quote object, and submit a PR referencing this issue. See CONTRIBUTING.md for details.",
  },
  {
    id: 6016282109,
    title: "Done tasks should not fade below WCAG 1.4.3 contrast minimum",
    url: "https://github.com/jzheaux/reader/issues/128",
    repository: "jzheaux/reader",
    state: "open",
    createdAt: "2026-10-24T18:37:15Z",
    updatedAt: "2026-10-24T19:30:38Z",
    comments: 0,
    labels: ["accessibility", "good first issue", "css"],
    body: "The li.task-done rule in features/tasks/tasks.css uses opacity: 0.6 so completed tasks fade. This leaves them under the 4.5:1 WCAG contrast minimum. Let's remove the opacity rule. Run npm test to verify.",
  },
  {
    id: 6016246821,
    title: "Expand the active-page highlight to mobile drawer text",
    url: "https://github.com/kiinshuk/pineapple-site/issues/100",
    repository: "kiinshuk/pineapple-site",
    state: "open",
    createdAt: "2026-10-24T18:33:08Z",
    updatedAt: "2026-10-24T18:33:08Z",
    comments: 0,
    labels: ["good first issue", "ui/ux", "css", "javascript"],
    body: "Good-first-issue candidate for the Pineapple website (HTML/CSS/JS/UI). Scope: Expand the active-page highlight to mobile drawer text. Keeps brand tokens and passes visual checks in README.md.",
  },
  {
    id: 5946493699,
    title: "ui: Extract inline styles and script from magic_success.html into CSS and JS modules",
    url: "https://github.com/fossasia/voxbento/issues/900",
    repository: "fossasia/voxbento",
    state: "open",
    createdAt: "2026-10-20T17:35:17Z",
    updatedAt: "2026-10-24T05:50:40Z",
    comments: 2,
    labels: ["frontend", "ui", "good first issue", "javascript", "css"],
    body: "Extract the inline styles in magic_success.html into CSS classes inside portal/static/css/auth.css and move the client-side JavaScript logic into a dedicated ES module at portal/static/js/magic-success.js. See CONTRIBUTING.md.",
  },
  {
    id: 6004631844,
    title: "Easy: Add loading and error states to an API request",
    url: "https://github.com/programming-club-knit/code-quest-project/issues/6",
    repository: "programming-club-knit/code-quest-project",
    state: "open",
    createdAt: "2026-10-23T20:03:35Z",
    updatedAt: "2026-10-24T04:44:23Z",
    comments: 0,
    labels: ["good first issue", "difficulty:easy", "javascript", "react"],
    body: "Make an existing API-driven component handle loading and failed requests properly. Skills: JavaScript, async/await, fetch, React if applicable. Ensure existing tests pass.",
  },
  {
    id: 6016629912,
    title: "Add auto-detection predicates for common frameworks",
    url: "https://github.com/koda-ai-studio/agent-bom/issues/45",
    repository: "koda-ai-studio/agent-bom",
    state: "open",
    createdAt: "2026-10-24T19:15:20Z",
    updatedAt: "2026-10-24T19:15:20Z",
    comments: 0,
    labels: ["good first issue", "help wanted", "python"],
    body: "Where: src/agent_bom/repo_auto_detect.py. Acceptance criteria: Each predicate detects python framework markers and uv run ruff check src passes. See CONTRIBUTING.md for setup.",
  },
];

async function queryGitHub(query, perPage = 25) {
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(perPage));
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'IssueScout-Hackathon-MVP',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || `GitHub search returned ${response.status}`);
  }
  return (await response.json()).items || [];
}

async function searchGitHub(skills = [], technologies = []) {
  const cacheKey = `${skills.map((s) => s.toLowerCase()).sort().join(',')}|${technologies.map((t) => t.toLowerCase()).sort().join(',')}`;
  const cached = memoryQueryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 180000)) {
    return { issues: cached.issues, fallbackActive: false };
  }

  const techTerms = technologies.map(sanitizeTerm).filter(Boolean).slice(0, 4);
  const skillTerms = skills.map(sanitizeTerm).filter(Boolean).slice(0, 5);

  const clauses = [];
  if (techTerms.length) clauses.push(`(${techTerms.join(' OR ')})`);
  if (skillTerms.length) clauses.push(`(${skillTerms.join(' OR ')})`);
  const keywordClause = clauses.join(' ');

  const searchLabels = ['good first issue', 'help wanted'];
  const queries = searchLabels.map((label) => {
    return `is:issue is:open no:assignee label:"${label}" ${keywordClause}`.trim();
  });

  const queryResults = await Promise.all(
    queries.map(async (query) => {
      try {
        return await queryGitHub(query, 25);
      } catch {
        return [];
      }
    })
  );

  let combined = queryResults.flat();

  // If targeted search yielded few candidates, broaden search to ensure candidates exist
  if (combined.length < 12) {
    const fallbackQueries = [];
    if (techTerms.length && skillTerms.length) {
      fallbackQueries.push(`is:issue is:open no:assignee label:"good first issue" (${techTerms.join(' OR ')})`);
    } else if (skillTerms.length) {
      fallbackQueries.push('is:issue is:open no:assignee label:"good first issue"');
    }
    if (fallbackQueries.length) {
      const extraResults = await Promise.all(
        fallbackQueries.map(async (q) => {
          try {
            return await queryGitHub(q, 20);
          } catch {
            return [];
          }
        })
      );
      combined = [...combined, ...extraResults.flat()];
    }
  }

  const unique = new Map();
  for (const item of combined) {
    if (!item || !item.html_url) continue;
    const normalized = {
      id: item.id,
      title: item.title,
      url: item.html_url,
      repository: (item.repository_url || '').split('/').slice(-2).join('/'),
      state: item.state,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      comments: item.comments || 0,
      labels: (item.labels || []).map((label) => typeof label === 'string' ? label : label.name),
      body: (item.body || '').slice(0, 2400),
    };
    unique.set(item.html_url, normalized);
    knownIssuesPool.set(item.html_url, normalized);
  }

  let fallbackActive = false;
  if (unique.size === 0) {
    fallbackActive = true;
    const backupPool = [...knownIssuesPool.values(), ...BUNDLED_STARTER_ISSUES];
    for (const item of backupPool) {
      if (!unique.has(item.url)) {
        unique.set(item.url, item);
      }
    }
  }

  const issues = [...unique.values()].slice(0, 50);
  if (issues.length && !fallbackActive) {
    memoryQueryCache.set(cacheKey, { timestamp: Date.now(), issues });
  }

  return { issues, fallbackActive };
}

function localScore(issue, skills = [], technologies = []) {
  const matched = skills.filter((skill) =>
    matchSkillInText(issue.title, skill) ||
    matchSkillInText(issue.body, skill) ||
    matchSkillInText(issue.repository, skill) ||
    issue.labels.some((l) => matchSkillInText(l, skill))
  );

  const matchesTech = technologies.some((tech) =>
    matchSkillInText(issue.title, tech) ||
    matchSkillInText(issue.body, tech) ||
    matchSkillInText(issue.repository, tech) ||
    issue.labels.some((l) => matchSkillInText(l, tech))
  );

  const starter = issue.labels.some((label) =>
    /good first issue|good-first-issue|beginner|first-timers|easy|starter/i.test(label)
  );

  const matchedInTitleOrLabels = matched.some((skill) =>
    matchSkillInText(issue.title, skill) || issue.labels.some((l) => matchSkillInText(l, skill))
  );

  let score = starter ? 60 : 50;
  score += Math.min(36, matched.length * 14);
  if (matchesTech) score += 10;
  if (matchedInTitleOrLabels) score += 6;

  const ageDays = (Date.now() - Date.parse(issue.updatedAt || '')) / 86400000;
  if (ageDays <= 14) score += 4;
  score = Math.min(98, Math.max(45, score));

  // Evidence extraction
  const evidence = extractEvidence(issue, matched);

  // Reason generation
  let reason;
  if (matched.length) {
    if (matchesTech && technologies.length) {
      reason = `Directly focuses on ${technologies.join('/')} and matches your skills in ${matched.join(', ')}.`;
    } else if (matchedInTitleOrLabels) {
      reason = `Highlighted in repository labels/title and directly involves ${matched.slice(0, 3).join(', ')}.`;
    } else {
      reason = `Issue requirements mention ${matched.slice(0, 3).join(', ')} with open starter tasks.`;
    }
  } else if (matchesTech) {
    reason = `Matches your technology focus in ${technologies.join(', ')} and is open for starter contributions.`;
  } else {
    reason = `This is an open, unassigned starter issue on GitHub. Read the contribution guide before starting.`;
  }

  // First step generation
  let firstStep;
  const files = detectReferencedFiles(issue.body);
  const hasAcceptanceCriteria = /acceptance criteria|tasks|to-do|\bchecklist\b/i.test(issue.body);
  const hasTests = /\btest|pytest|jest|npm test|cargo test\b/i.test(issue.body);

  if (files.length) {
    firstStep = `Locate ${files.slice(0, 2).join(' and ')} in the repository and inspect the current implementation.`;
  } else if (hasAcceptanceCriteria) {
    firstStep = `Review the acceptance checklist in the issue description and comment to claim the task.`;
  } else if (hasTests) {
    firstStep = `Run the project's test suite locally to understand current behavior before making changes.`;
  } else {
    firstStep = `Open the issue, check the repository's CONTRIBUTING guide, and leave a comment to claim.`;
  }

  return {
    ...issue,
    score,
    matchedSkills: matched,
    reason,
    firstStep,
    evidence,
    difficulty: estimateDifficulty(issue),
  };
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('The local model returned an unreadable ranking.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function rankWithOllama(issues, skills) {
  const candidates = issues.slice(0, 20).map(({ id, title, repository, url, labels, body, updatedAt }) => ({
    id, title, repository, url, labels, body: body.slice(0, 850), updatedAt,
  }));
  const prompt = `You help a developer choose an open-source starter issue. Rank the supplied issues for the person's skills and evaluate difficulty level (Beginner, Intermediate, Advanced, or Unknown). Use only evidence in the issue data. Do not classify an issue as Beginner solely because it has 'good first issue' if its scope involves architectural changes, security, or many files. Return ONLY a JSON array, with one object for each selected issue: {"id": number, "score": number from 0 to 100, "matchedSkills": [string], "difficulty": "Beginner" | "Intermediate" | "Advanced" | "Unknown", "difficultyReason": "short explanation of difficulty", "reason": "one short evidence-based sentence", "firstStep": "one concrete first action"}. Return at most 8 objects, ordered best fit first. Skills: ${skills.join(', ')}. Issues: ${JSON.stringify(candidates)}`;
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
  const payload = await response.json();
  const ranking = parseModelJson(payload.response || '');
  const byId = new Map(issues.map((issue) => [String(issue.id), issue]));
  const ranked = ranking
    .filter((item) => byId.has(String(item.id)))
    .slice(0, 8)
    .map((item) => {
      const original = byId.get(String(item.id));
      const modelMatched = Array.isArray(item.matchedSkills) ? item.matchedSkills : [];
      // Combine with regex-detected skills to guarantee accuracy
      const verifiedMatched = skills.filter((s) =>
        modelMatched.includes(s) ||
        matchSkillInText(original.title, s) ||
        matchSkillInText(original.body, s) ||
        original.labels.some((l) => matchSkillInText(l, s))
      );
      const evidence = extractEvidence(original, verifiedMatched);
      const heuristicDiff = estimateDifficulty(original);

      let difficulty = heuristicDiff;
      if (item.difficulty && typeof item.difficulty === 'string') {
        const aiLevel = item.difficulty.toLowerCase().trim();
        if (['beginner', 'intermediate', 'advanced', 'unknown'].includes(aiLevel)) {
          const aiReason = (typeof item.difficultyReason === 'string' && item.difficultyReason.trim())
            ? item.difficultyReason.trim()
            : heuristicDiff.explanation;
          difficulty = {
            ...heuristicDiff,
            level: aiLevel,
            explanation: aiReason + ' (Refined with local AI model)',
            confidence: heuristicDiff.confidence === 'low' ? 'heuristic' : heuristicDiff.confidence,
            signals: [
              { factor: `AI model evaluated task scope: ${aiLevel}`, found: true, weight: 'high' },
              ...heuristicDiff.signals,
            ].slice(0, 6),
          };
        }
      }

      return {
        ...original,
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        matchedSkills: verifiedMatched,
        reason: String(item.reason || 'The model found a possible skill match.'),
        firstStep: String(item.firstStep || 'Read the issue and repository contribution guide.'),
        evidence,
        difficulty,
      };
    });
  if (!ranked.length) throw new Error('The local model did not match any issue IDs.');
  return ranked;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      let localModelReady = false;
      let models = [];
      try {
        const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
        if (response.ok) {
          const data = await response.json();
          models = (data.models || []).map((model) => model.name);
          localModelReady = models.some((name) => name === ollamaModel || name.startsWith(`${ollamaModel}:`));
        }
      } catch { /* Ollama is optional for browsing and fallback ranking. */ }
      return send(res, 200, { model: ollamaModel, localModelReady, models });
    }
    if (req.method === 'POST' && url.pathname === '/api/find') {
      const input = await bodyJson(req);
      const skills = String(input.skills || '').split(',').map((skill) => skill.trim()).filter(Boolean).slice(0, 12);
      if (!skills.length) return send(res, 400, { error: 'Enter at least one skill or technology.' });
      const technologies = String(input.technologies || '').split(',').map((technology) => technology.trim()).filter(Boolean).slice(0, 8);
      const searchResult = await searchGitHub(skills, technologies);
      let issues = searchResult.issues;
      const fallbackActive = searchResult.fallbackActive;
      if (technologies.length) {
        const techMatches = issues.filter((issue) => {
          return technologies.some((tech) =>
            matchSkillInText(issue.title, tech) ||
            matchSkillInText(issue.body, tech) ||
            matchSkillInText(issue.repository, tech) ||
            issue.labels.some((l) => matchSkillInText(l, tech))
          );
        });
        if (techMatches.length >= 3) {
          issues = techMatches;
        }
      }
      if (!issues.length) return send(res, 200, { issues: [], rankingMode: 'none', fallbackActive });
      try {
        const ranked = await rankWithOllama(issues, skills);
        return send(res, 200, { issues: ranked, rankingMode: 'local-ai', model: ollamaModel, fallbackActive });
      } catch (error) {
        const ranked = issues.map((issue) => localScore(issue, skills, technologies)).sort((a, b) => b.score - a.score).slice(0, 8);
        return send(res, 200, { issues: ranked, rankingMode: 'keyword-fallback', model: ollamaModel, aiMessage: error.message, fallbackActive });
      }
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readFile(path.join(root, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/styles.css') {
      const css = await readFile(path.join(root, 'styles.css'), 'utf8');
      return send(res, 200, css, 'text/css; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      const js = await readFile(path.join(root, 'app.js'), 'utf8');
      return send(res, 200, js, 'text/javascript; charset=utf-8');
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`IssueScout ready at http://localhost:${port}`));
