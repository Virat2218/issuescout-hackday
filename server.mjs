import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b-instruct';
const githubToken = process.env.GITHUB_TOKEN;

// Lightweight in-memory rate limiter (60 requests per minute per IP)
const ipRateLimitMap = new Map();
function checkRateLimit(ip, limit = 60, windowMs = 60000) {
  const now = Date.now();
  const record = ipRateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  record.count += 1;
  ipRateLimitMap.set(ip, record);
  return {
    allowed: record.count <= limit,
    remaining: Math.max(0, limit - record.count),
    reset: Math.ceil((record.resetAt - now) / 1000),
  };
}

function send(res, status, value, type = 'application/json; charset=utf-8', customHeaders = {}, isHead = false) {
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http://localhost:* http://127.0.0.1:* https://api.github.com; img-src 'self' data: https:;",
    ...customHeaders,
  };
  res.writeHead(status, headers);
  if (isHead) {
    res.end();
    return;
  }
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}

// Request size limit enforced at 64KB to prevent denial-of-service memory exhaustion
async function bodyJson(req, limit = 65536) {
  let body = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) {
      throw new Error('Payload Too Large: request body exceeds 64KB limit.');
    }
    body += chunk;
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const e = new Error('Invalid JSON in request body.');
    e.isParseError = true;
    throw e;
  }
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
        evidence.push({ source: field.source, skill: trimmed, quote, isSourceBacked: true });
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

const repoHealthCache = new Map();

/**
 * Fallback generator when GitHub API is rate-limited or fails.
 * Explicitly leaves score as null and flags unavailable data (Requirement 8, 12).
 */
function buildFallbackRepoHealth(repoName, fallbackIssue, reason, sources, checkedAt) {
  const issueUpdatedDays = fallbackIssue?.updatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(fallbackIssue.updatedAt)) / 86400000))
    : null;

  return {
    repository: repoName,
    status: reason === 'rate-limited' ? 'estimated' : 'unverified',
    statusLabel: reason === 'rate-limited' ? 'Rate Limit Guard (Estimated)' : 'Activity Data Unverified',
    statusSummary: reason === 'rate-limited'
      ? `GitHub API rate limit reached. The issue was updated ${issueUpdatedDays !== null ? (issueUpdatedDays === 0 ? 'today' : issueUpdatedDays + 'd ago') : 'recently'}. Direct activity sources are provided below.`
      : `Repository details could not be verified live over the network. Check the direct activity links below on GitHub.`,
    score: null, // Avoid assigning misleading score when evidence is insufficient (Requirement 8)
    scoringCriteria: null,
    signals: [
      { name: 'Issue Update Recency', value: issueUpdatedDays !== null ? `Issue updated ${issueUpdatedDays === 0 ? 'today' : issueUpdatedDays + 'd ago'}` : 'Update timestamp unavailable', verified: false, sourceUrl: fallbackIssue?.url || sources.repo },
      { name: 'Repository Source', value: 'Check commit & PR activity directly on GitHub', verified: false, sourceUrl: sources.repo },
    ],
    isArchived: false,
    daysSincePush: null,
    observationPeriod: 'Past 90 days',
    checkedAt,
    qualityDisclaimer: 'Maintenance pace reflects recent update frequency, not repository quality. Stable libraries often require fewer changes.',
    sources,
    isFallback: true,
    fallbackReason: reason,
  };
}

/**
 * Analyze publicly available GitHub repository information using the GitHub integration.
 * Evaluates:
 * - Recent commit activity (pushed_at)
 * - Recent releases
 * - Issue & Pull Request volume
 * - Repository archival status
 *
 * Normalizes an overall Activity Score (0-100) with documented criteria:
 * - Commit Recency: max 35 pts
 * - Release Cadence: max 25 pts
 * - Issue & PR Activity: max 25 pts
 * - Maintenance Status: max 15 pts
 *
 * Excludes stars/forks from quality/maintenance scoring (Requirement 7).
 * Caches responses in memory for 30 minutes to respect API rate limits (Requirement 9).
 */
async function assessRepoHealth(repoName, fallbackIssue = null) {
  if (!repoName || typeof repoName !== 'string' || !repoName.includes('/')) {
    return null;
  }

  const normalizedRepo = repoName.trim();
  const cached = repoHealthCache.get(normalizedRepo);
  if (cached && (Date.now() - cached.timestamp < 1800000)) { // 30 min cache
    return cached.data;
  }

  const now = Date.now();
  const checkedAt = new Date().toISOString();
  const observationPeriod = 'Past 90 days';
  const sources = {
    repo: `https://github.com/${normalizedRepo}`,
    commits: `https://github.com/${normalizedRepo}/commits`,
    releases: `https://github.com/${normalizedRepo}/releases`,
    pulls: `https://github.com/${normalizedRepo}/pulls`,
  };

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${normalizedRepo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'IssueScout-RepoHealth/1.0',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!repoRes.ok) {
      const remaining = Number(repoRes.headers.get('x-ratelimit-remaining'));
      const isRateLimited = repoRes.status === 403 || repoRes.status === 429 || remaining === 0;
      const fallback = buildFallbackRepoHealth(normalizedRepo, fallbackIssue, isRateLimited ? 'rate-limited' : 'api-unavailable', sources, checkedAt);
      repoHealthCache.set(normalizedRepo, { timestamp: now, data: fallback });
      return fallback;
    }

    const repoData = await repoRes.json();
    const rateRemaining = Number(repoRes.headers.get('x-ratelimit-remaining') || '50');

    // Only fetch releases if rate limit budget is healthy (> 6 remaining)
    let latestRelease = null;
    if (rateRemaining > 6) {
      try {
        const relRes = await fetch(`https://api.github.com/repos/${normalizedRepo}/releases?per_page=1`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'IssueScout-RepoHealth/1.0',
            ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
          },
          signal: AbortSignal.timeout(4000),
        });
        if (relRes.ok) {
          const relData = await relRes.json();
          if (Array.isArray(relData) && relData.length > 0) {
            latestRelease = {
              tag: relData[0].tag_name || relData[0].name || 'Release',
              publishedAt: relData[0].published_at || relData[0].created_at,
            };
          }
        }
      } catch { /* optional release fetch fallback */ }
    }

    const isArchived = Boolean(repoData.archived);
    const pushedTimestamp = Date.parse(repoData.pushed_at || '');
    const daysSincePush = Number.isFinite(pushedTimestamp) ? Math.max(0, Math.floor((now - pushedTimestamp) / 86400000)) : null;

    let releaseDays = null;
    if (latestRelease?.publishedAt) {
      const relTimestamp = Date.parse(latestRelease.publishedAt);
      if (Number.isFinite(relTimestamp)) {
        releaseDays = Math.max(0, Math.floor((now - relTimestamp) / 86400000));
      }
    }

    // Normalized scoring criteria:
    // 1. Commit Recency (max 35)
    let commitScore = 0;
    let commitLabel = 'No recent commit data';
    if (daysSincePush !== null) {
      if (daysSincePush <= 7) { commitScore = 35; commitLabel = `Very active — pushed ${daysSincePush === 0 ? 'today' : daysSincePush + 'd ago'}`; }
      else if (daysSincePush <= 30) { commitScore = 28; commitLabel = `Active — pushed ${daysSincePush}d ago`; }
      else if (daysSincePush <= 90) { commitScore = 18; commitLabel = `Moderate — pushed ${daysSincePush}d ago`; }
      else { commitScore = 8; commitLabel = `Quiet — last pushed ${daysSincePush}d ago`; }
    }

    // 2. Release Cadence (max 25)
    let releaseScore = 0;
    let releaseLabel = 'No recent tagged release recorded';
    if (releaseDays !== null) {
      if (releaseDays <= 30) { releaseScore = 25; releaseLabel = `${latestRelease.tag} released ${releaseDays === 0 ? 'today' : releaseDays + 'd ago'}`; }
      else if (releaseDays <= 90) { releaseScore = 20; releaseLabel = `${latestRelease.tag} released ${releaseDays}d ago`; }
      else if (releaseDays <= 180) { releaseScore = 12; releaseLabel = `${latestRelease.tag} released ${releaseDays}d ago`; }
      else { releaseScore = 6; releaseLabel = `${latestRelease.tag} (${releaseDays}d ago)`; }
    } else {
      releaseLabel = 'Continuous main branch development (rolling releases)';
      releaseScore = 12;
    }

    // 3. Issue & PR Activity (max 25)
    const openCount = repoData.open_issues_count || 0;
    let issueScore = 0;
    let issueLabel = `${openCount} open issues & PRs`;
    if (openCount > 0) {
      issueScore = Math.min(25, 10 + Math.min(15, Math.floor(openCount / 10)));
    } else {
      issueScore = 10;
    }

    // 4. Maintenance / Archival Status (max 15)
    let maintenanceScore = isArchived ? 0 : 15;

    let totalScore = commitScore + releaseScore + issueScore + maintenanceScore;
    if (isArchived) totalScore = Math.min(15, totalScore);

    let status = 'active';
    let statusLabel = 'High Activity Pace';
    let statusSummary = `High maintenance cadence with recent code pushes (${daysSincePush !== null ? (daysSincePush === 0 ? 'today' : daysSincePush + 'd ago') : 'recent'}) and active issue tracking.`;

    if (isArchived) {
      status = 'archived';
      statusLabel = 'Archived (Read-Only)';
      statusSummary = 'This repository has been archived by its maintainers. It no longer accepts contributions or pull requests.';
    } else if (totalScore < 50) {
      status = 'quiet';
      statusLabel = 'Quiet / Low Velocity';
      statusSummary = `Low commit velocity in the past 90 days. Note that quiet repositories may simply be stable, complete utilities.`;
    } else if (totalScore < 75) {
      status = 'moderate';
      statusLabel = 'Moderate Activity';
      statusSummary = `Steady maintenance with periodic updates and open issue tracking in the past 90 days.`;
    }

    const healthData = {
      repository: normalizedRepo,
      status,
      statusLabel,
      statusSummary,
      score: totalScore,
      scoringCriteria: {
        commitRecency: { points: commitScore, max: 35, detail: commitLabel },
        releaseCadence: { points: releaseScore, max: 25, detail: releaseLabel },
        issuePrActivity: { points: issueScore, max: 25, detail: issueLabel },
        maintenanceStatus: { points: maintenanceScore, max: 15, detail: isArchived ? 'Archived repository' : 'Active (not archived)' },
      },
      signals: [
        { name: 'Recent Commits', value: commitLabel, verified: true, sourceUrl: sources.commits },
        { name: 'Latest Release', value: releaseLabel, verified: Boolean(latestRelease), sourceUrl: sources.releases },
        { name: 'Open Issues & PRs', value: `${openCount} open issues & PRs`, verified: true, sourceUrl: sources.pulls },
        { name: 'Archival Status', value: isArchived ? 'Archived (Read-only)' : 'Active (Accepts contributions)', verified: true, sourceUrl: sources.repo },
      ],
      isArchived,
      daysSincePush,
      observationPeriod,
      checkedAt,
      qualityDisclaimer: 'Maintenance pace reflects recent change frequency, not repository quality. Stable libraries often require fewer changes.',
      sources,
      isFallback: false,
    };

    repoHealthCache.set(normalizedRepo, { timestamp: now, data: healthData });
    return healthData;
  } catch {
    const fallback = buildFallbackRepoHealth(normalizedRepo, fallbackIssue, 'network-error', sources, checkedAt);
    repoHealthCache.set(normalizedRepo, { timestamp: now, data: fallback });
    return fallback;
  }
}

const TRUSTED_LEARNING_RESOURCES = {
  JavaScript: {
    name: 'MDN Web Docs — JavaScript Guide',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    description: 'Official beginner-friendly reference for JavaScript syntax, functions, and modern ES features.',
  },
  TypeScript: {
    name: 'TypeScript Official Handbook',
    url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
    description: 'Official guide to types, interfaces, compiler options, and type safety.',
  },
  Python: {
    name: 'Python Official Tutorial',
    url: 'https://docs.python.org/3/tutorial/',
    description: 'Official standard library tutorial covering Python essentials and modules.',
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
    description: 'Official step-by-step walkthrough on forking, branching, commits, and Pull Requests.',
  },
  Jest: {
    name: 'Jest Official Getting Started',
    url: 'https://jestjs.io/docs/getting-started',
    description: 'Official quickstart on writing assertions, mocks, and running JavaScript unit tests.',
  },
  Pytest: {
    name: 'Pytest Official Documentation',
    url: 'https://docs.pytest.org/en/stable/getting-started.html',
    description: 'Official beginner guide to writing and running Python test cases.',
  },
  Go: {
    name: 'Go Official Tutorial: Get Started',
    url: 'https://go.dev/doc/tutorial/getting-started',
    description: 'Official tutorial covering Go packages, functions, and testing.',
  },
  Rust: {
    name: 'The Rust Programming Language Book',
    url: 'https://doc.rust-lang.org/book/',
    description: 'Official open-source book introducing Rust syntax, ownership, and cargo.',
  },
  Docker: {
    name: 'Docker Official Get Started Guide',
    url: 'https://docs.docker.com/get-started/',
    description: 'Step-by-step introduction to Dockerfiles, images, and container environments.',
  },
  Markdown: {
    name: 'The Markdown Guide',
    url: 'https://www.markdownguide.org/getting-started/',
    description: 'Clear reference for formatting documentation, tables, and issue comments.',
  },
  GraphQL: {
    name: 'GraphQL Official Documentation',
    url: 'https://graphql.org/learn/',
    description: 'Official guide on queries, schemas, and GraphQL API fundamentals.',
  },
  Vue: {
    name: 'Vue.js Official Guide',
    url: 'https://vuejs.org/guide/introduction.html',
    description: 'Official quick start covering Vue reactive state and component templates.',
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
 * Perform a rigorous Skill-Gap Analysis comparing the user's entered skills
 * with the skills required and inferred from a GitHub issue.
 * Categorizes into:
 * 1. Matching skills (user entered + issue requires)
 * 2. Missing or unverified skills (required by issue, but unconfirmed in user skills)
 * 3. Additional helpful skills (tools, testing, PR workflow)
 */
function analyzeSkillGap(issue, userSkills = [], technologies = []) {
  const title = String(issue.title || '');
  const body = String(issue.body || '');
  const labels = issue.labels || [];
  const labelStr = labels.join(' ').toLowerCase();
  const text = `${title} ${body} ${labelStr}`.toLowerCase();
  const refFiles = detectReferencedFiles(body);

  const normalizedUserSkills = new Set(
    [...userSkills, ...technologies].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
  );

  const candidateSkills = new Map();

  function addCandidate(name, isRequired, reason, evidence) {
    if (!candidateSkills.has(name) || (isRequired && !candidateSkills.get(name).required)) {
      candidateSkills.set(name, {
        name,
        required: isRequired,
        reason,
        evidence: evidence || 'Referenced in issue requirements',
        resources: TRUSTED_LEARNING_RESOURCES[name] || null,
      });
    }
  }

  // Detect from referenced files (strongest requirement signal)
  for (const file of refFiles) {
    const ext = file.split('.').pop()?.toLowerCase();
    if (ext === 'ts' || ext === 'tsx') {
      addCandidate('TypeScript', true, `Code changes involve ${file}, requiring TypeScript types and compiler verification.`, `Referenced file: ${file}`);
    } else if (ext === 'js' || ext === 'jsx' || ext === 'mjs') {
      addCandidate('JavaScript', true, `Code changes involve ${file}, modifying JavaScript module logic.`, `Referenced file: ${file}`);
    } else if (ext === 'py') {
      addCandidate('Python', true, `Code changes involve ${file}, requiring Python module development.`, `Referenced file: ${file}`);
    } else if (ext === 'go') {
      addCandidate('Go', true, `Code changes involve ${file}, requiring Go package compilation.`, `Referenced file: ${file}`);
    } else if (ext === 'rs') {
      addCandidate('Rust', true, `Code changes involve ${file}, requiring Rust language constructs and cargo checks.`, `Referenced file: ${file}`);
    } else if (ext === 'html') {
      addCandidate('HTML', true, `Code changes involve ${file}, modifying HTML markup or DOM structure.`, `Referenced file: ${file}`);
    } else if (ext === 'css' || ext === 'scss' || ext === 'sass') {
      addCandidate('CSS', true, `Styling changes involve ${file}, requiring CSS rules and layout adjustments.`, `Referenced file: ${file}`);
    } else if (ext === 'md') {
      addCandidate('Markdown', true, `Documentation update directly modifies ${file}.`, `Referenced file: ${file}`);
    } else if (file.toLowerCase().includes('docker')) {
      addCandidate('Docker', true, `Container configuration file ${file} needs modification or testing.`, `Referenced file: ${file}`);
    }
  }

  // Detect from labels
  labels.forEach((label) => {
    const l = label.toLowerCase();
    if (/\btypescript\b|\bts\b/.test(l)) {
      addCandidate('TypeScript', true, 'Repository label flags this issue as a TypeScript task.', `Label: ${label}`);
    } else if (/\bjavascript\b|\bjs\b/.test(l)) {
      addCandidate('JavaScript', true, 'Repository label flags this issue as a JavaScript task.', `Label: ${label}`);
    } else if (/\bpython\b|\bpy\b/.test(l)) {
      addCandidate('Python', true, 'Repository label indicates a Python task.', `Label: ${label}`);
    } else if (/\breact\b/.test(l)) {
      addCandidate('React', true, 'Repository label indicates React component work.', `Label: ${label}`);
    } else if (/\bvue\b/.test(l)) {
      addCandidate('Vue', true, 'Repository label indicates Vue component work.', `Label: ${label}`);
    } else if (/\bdocumentation\b|\bdocs\b/.test(l)) {
      addCandidate('Markdown', true, 'Documentation label indicates writing or fixing Markdown content.', `Label: ${label}`);
    } else if (/\bhtml\b/.test(l)) {
      addCandidate('HTML', true, 'Repository label flags HTML work.', `Label: ${label}`);
    } else if (/\bcss\b|\bstyle\b|\bstyling\b/.test(l)) {
      addCandidate('CSS', true, 'Repository label indicates CSS styling work.', `Label: ${label}`);
    } else if (/\bdocker\b/.test(l)) {
      addCandidate('Docker', true, 'Repository label specifies Docker environment configuration.', `Label: ${label}`);
    }
  });

  // Detect from title & body
  if (/\btypescript\b/.test(text) && !candidateSkills.has('TypeScript')) {
    addCandidate('TypeScript', true, 'Issue mentions TypeScript types or interfaces in the task description.', 'Mentioned in text');
  }
  if (/\bjavascript\b/.test(text) && !candidateSkills.has('JavaScript')) {
    addCandidate('JavaScript', true, 'Issue description mentions JavaScript implementation.', 'Mentioned in text');
  }
  if (/\breact\b|\bjsx\b/.test(text) && !candidateSkills.has('React')) {
    addCandidate('React', true, 'Issue task touches React components, hooks, or rendering.', 'Mentioned in text');
  }
  if (/\bpython\b/.test(text) && !candidateSkills.has('Python')) {
    addCandidate('Python', true, 'Issue requires Python code or scripting.', 'Mentioned in text');
  }
  if (/\bnode(?:\.js)?\b|\bnpm\b|\byarn\b|\bpnpm\b/.test(text) && !candidateSkills.has('Node.js')) {
    addCandidate('Node.js', false, 'Issue mentions Node.js environment or npm/yarn dependencies.', 'Mentioned in text');
  }
  if (/\bjest\b|\btest assertions?\b/.test(text)) {
    addCandidate('Jest', false, 'Test verification in this project uses Jest test runner.', 'Mentioned in test instructions');
  } else if (/\bpytest\b/.test(text)) {
    addCandidate('Pytest', false, 'Test verification in this project uses Pytest.', 'Mentioned in test instructions');
  }
  if (/\bdocker\b|\bcontainer\b/.test(text) && !candidateSkills.has('Docker')) {
    addCandidate('Docker', false, 'Container setup is referenced for reproducing or running the service.', 'Mentioned in text');
  }
  if (/\bgraphql\b/.test(text) && !candidateSkills.has('GraphQL')) {
    addCandidate('GraphQL', true, 'Task involves GraphQL schema or query mutations.', 'Mentioned in text');
  }
  if (/\bsql\b|\bdatabase\b|\bquery\b/.test(text) && !candidateSkills.has('SQL')) {
    addCandidate('SQL', false, 'Database queries or schema tables are referenced.', 'Mentioned in text');
  }
  if (/\bgithub actions\b|\bworkflow\b|\bci\/cd\b/.test(text) && !candidateSkills.has('GitHub Actions / CI')) {
    addCandidate('GitHub Actions / CI', false, 'Issue touches automation or continuous integration workflows.', 'Mentioned in text');
  }

  // Also verify user's entered skills against issue text
  userSkills.forEach((uSkill) => {
    const raw = String(uSkill || '').trim();
    if (raw && matchSkillInText(text, raw)) {
      const canonical = Object.keys(TRUSTED_LEARNING_RESOURCES).find((k) => k.toLowerCase() === raw.toLowerCase()) || raw;
      if (!candidateSkills.has(canonical)) {
        addCandidate(canonical, true, `Matches the issue focus on ${canonical}.`, 'Matched in issue content');
      }
    }
  });

  // Always suggest Git / PR Workflow as a helpful skill for open source contribution
  if (!normalizedUserSkills.has('git') && !normalizedUserSkills.has('git / pr workflow')) {
    addCandidate('Git / PR Workflow', false, 'Forking, branching, and submitting clean Pull Requests with proper commit messages.', 'Essential open-source contribution workflow');
  }

  if (candidateSkills.size === 0) {
    if (labelStr.includes('documentation') || title.toLowerCase().includes('readme') || title.toLowerCase().includes('doc')) {
      addCandidate('Markdown', true, 'Documentation issue requiring Markdown editing.', 'Issue context');
    } else {
      addCandidate('Git / PR Workflow', false, 'Creating branch and opening Pull Request following repository guidelines.', 'General contribution process');
    }
  }

  // Partition into the 3 categories
  const matchingSkills = [];
  const unconfirmedSkills = [];
  const helpfulSkills = [];

  candidateSkills.forEach((item) => {
    const normName = item.name.toLowerCase();
    const userHasSkill = Array.from(normalizedUserSkills).some((us) =>
      us === normName || normName.includes(us) || us.includes(normName)
    );

    if (userHasSkill) {
      matchingSkills.push({
        ...item,
        status: 'matched',
        category: 'matching',
        reason: item.reason || `You have entered ${item.name}, which is needed for this task.`,
      });
    } else if (item.required) {
      unconfirmedSkills.push({
        ...item,
        status: 'unconfirmed',
        category: 'unconfirmed',
        reason: item.reason || `${item.name} is required to complete this issue based on referenced files or labels.`,
      });
    } else {
      helpfulSkills.push({
        ...item,
        status: 'helpful',
        category: 'helpful',
        reason: item.reason || `${item.name} will help you test, document, or verify your contribution.`,
      });
    }
  });

  // Handle issues with insufficient descriptions or unclear requirements (Requirement 12)
  const bodyLength = body.trim().length;
  const hasAcceptanceCriteria = /acceptance criteria|tasks|to-do|\bchecklist\b/i.test(body);
  const unclearDescription = bodyLength < 60 && refFiles.length === 0 && !hasAcceptanceCriteria;
  const unclearWarning = unclearDescription
    ? 'This issue has a brief description without explicit file references or acceptance checklist. Review repository discussions or ask the maintainer for clarification before writing code.'
    : null;

  let readiness = 'ready';
  let readinessLabel = 'Ready to Start';
  let readinessSummary = 'You have entered the primary skills required for this issue.';

  if (unconfirmedSkills.length === 1) {
    readiness = 'moderate';
    readinessLabel = '1 Unconfirmed Skill Gap';
    readinessSummary = `You match most skills, but ${unconfirmedSkills[0].name} is unconfirmed in your entered profile. Review the guide below if needed.`;
  } else if (unconfirmedSkills.length > 1) {
    readiness = 'needs-prep';
    readinessLabel = `${unconfirmedSkills.length} Unconfirmed Skill Gaps`;
    readinessSummary = `The issue requires ${unconfirmedSkills.map((s) => s.name).join(', ')}. Review the official learning resources below before contributing.`;
  } else if (matchingSkills.length === 0) {
    readiness = 'unconfirmed';
    readinessLabel = 'Unconfirmed Requirements';
    readinessSummary = 'No exact match with your search skills was detected. Check the helpful guides below to see if you want to take this on.';
  }

  return {
    readiness,
    readinessLabel,
    readinessSummary,
    matchingSkills,
    unconfirmedSkills,
    helpfulSkills,
    totalRequired: matchingSkills.length + unconfirmedSkills.length,
    unclearDescription,
    unclearWarning,
  };
}

// ── Duplicate & Related Issue Detection ──────────────────────────────
const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'with', 'to', 'for', 'of',
  'as', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'beneath', 'under', 'above',
  'fix', 'fixes', 'fixing', 'fixed', 'bug', 'issue', 'issues', 'error', 'errors', 'problem', 'problems',
  'add', 'added', 'adding', 'update', 'updated', 'updating', 'create', 'created', 'creating',
  'remove', 'removed', 'removing', 'delete', 'deleted', 'please', 'help', 'needed', 'needs',
  'feature', 'support', 'improve', 'improved', 'make', 'how', 'why', 'what', 'when', 'where',
  'good', 'first', 'starter', 'easy', 'simple', 'change', 'changes', 'changing', 'new', 'some',
  'all', 'any', 'both', 'each', 'more', 'most', 'other', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'do',
  'does', 'did', 'doing', 'would', 'could', 'has', 'have', 'had', 'having', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'there', 'their', 'them', 'then'
]);

function extractMeaningfulTokens(text) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[^\w\s\-\.\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ');
  const tokens = [];
  for (const word of words) {
    const trimmed = word.trim();
    if (trimmed.length >= 3 && !STOP_WORDS.has(trimmed) && !/^\d+$/.test(trimmed)) {
      tokens.push(trimmed);
    }
  }
  return [...new Set(tokens)];
}

function extractBigrams(text) {
  if (!text || typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return [...new Set(bigrams)];
}

function extractIssueNumberFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/issues\/(\d+)/i);
  return match ? match[1] : null;
}

function extractIssueReferences(text) {
  if (!text || typeof text !== 'string') return { explicitRefs: [], dependencies: [], duplicateRefs: [] };
  const explicitRefs = [];
  const dependencies = [];
  const duplicateRefs = [];

  const refMatches = text.matchAll(/(?:#|gh-)(\d+)/gi);
  for (const m of refMatches) {
    explicitRefs.push(m[1]);
  }

  const depMatches = text.matchAll(/(?:depends\s+on|blocked\s+by|prerequisite(?:\s+for)?|requires|blocks|blocking|sub-task\s+of|parent\s+issue)\s+(?:#|gh-)?(\d+)/gi);
  for (const m of depMatches) {
    dependencies.push(m[1]);
  }

  const dupMatches = text.matchAll(/(?:duplicate\s+of|closing\s+as\s+dup(?:licate)?\s+of|dup\s+of)\s+(?:#|gh-)?(\d+)/gi);
  for (const m of dupMatches) {
    duplicateRefs.push(m[1]);
  }

  return {
    explicitRefs: [...new Set(explicitRefs)],
    dependencies: [...new Set(dependencies)],
    duplicateRefs: [...new Set(duplicateRefs)],
  };
}

const sameRepoIssuesCache = new Map();
const relatedIssuesCache = new Map();

async function fetchSameRepoIssues(repoName) {
  if (!repoName || typeof repoName !== 'string') return [];
  const cacheKey = repoName.toLowerCase();
  const cached = sameRepoIssuesCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 900000)) { // 15 min TTL
    return cached.issues;
  }

  let issues = [];
  try {
    const query = `repo:${repoName} is:issue`;
    const fetched = await queryGitHub(query, 15);
    issues = (fetched || []).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.html_url,
      repository: repoName,
      state: item.state,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      comments: item.comments || 0,
      labels: (item.labels || []).map((label) => typeof label === 'string' ? label : label.name),
      body: (item.body || '').slice(0, 1500),
    }));
    for (const issue of issues) {
      knownIssuesPool.set(issue.url, issue);
    }
  } catch {
    // If GitHub API fails or rate limited, fall back to known issues pool
    issues = [...knownIssuesPool.values(), ...BUNDLED_STARTER_ISSUES].filter(
      (item) => item.repository && item.repository.toLowerCase() === repoName.toLowerCase()
    );
  }

  sameRepoIssuesCache.set(cacheKey, { timestamp: Date.now(), issues });
  return issues;
}

/**
 * Detect potential duplicates, dependencies, same feature area, and related issues
 * for a target issue against a pool of candidate issues.
 * Strictest requirement: NEVER claim duplicate based on a single shared keyword.
 */
function detectRelatedIssues(targetIssue, candidatePool = []) {
  if (!targetIssue || !targetIssue.title) return [];

  const targetId = String(targetIssue.id || '');
  const targetUrl = targetIssue.url || '';
  const targetNum = extractIssueNumberFromUrl(targetUrl);
  const targetRepo = (targetIssue.repository || '').toLowerCase();
  const targetTitle = targetIssue.title || '';
  const targetBody = targetIssue.body || '';
  const targetCombined = `${targetTitle} ${targetBody}`;

  const targetTokens = extractMeaningfulTokens(targetTitle);
  const targetBigrams = extractBigrams(targetCombined.slice(0, 800));
  const targetRefs = extractIssueReferences(targetCombined);
  const targetFiles = detectReferencedFiles(targetBody);

  const GENERIC_LABELS = new Set(['good first issue', 'good-first-issue', 'help wanted', 'help-wanted', 'hacktoberfest']);
  const targetSpecificLabels = (targetIssue.labels || [])
    .map((l) => typeof l === 'string' ? l.toLowerCase() : (l.name || '').toLowerCase())
    .filter((l) => l && !GENERIC_LABELS.has(l));

  const seenUrls = new Set([targetUrl]);
  const matches = [];

  for (const candidate of candidatePool) {
    if (!candidate || !candidate.title) continue;
    const candUrl = candidate.url || '';
    const candId = String(candidate.id || '');
    if (seenUrls.has(candUrl) || (targetId && candId === targetId)) continue;
    seenUrls.add(candUrl);

    const candNum = extractIssueNumberFromUrl(candUrl);
    const candRepo = (candidate.repository || '').toLowerCase();
    const isSameRepo = Boolean(targetRepo && candRepo && targetRepo === candRepo);

    const candTitle = candidate.title || '';
    const candBody = candidate.body || '';
    const candCombined = `${candTitle} ${candBody}`;
    const candTokens = extractMeaningfulTokens(candTitle);
    const candBigrams = extractBigrams(candCombined.slice(0, 800));
    const candRefs = extractIssueReferences(candCombined);
    const candFiles = detectReferencedFiles(candBody);

    const candSpecificLabels = (candidate.labels || [])
      .map((l) => typeof l === 'string' ? l.toLowerCase() : (l.name || '').toLowerCase())
      .filter((l) => l && !GENERIC_LABELS.has(l));

    // Overlaps
    const sharedTokens = targetTokens.filter((t) => candTokens.includes(t));
    const unionTokens = new Set([...targetTokens, ...candTokens]);
    const titleJaccard = unionTokens.size > 0 ? (sharedTokens.length / unionTokens.size) : 0;

    const sharedBigrams = targetBigrams.filter((b) => candBigrams.includes(b));
    const sharedFiles = targetFiles.filter((f) => candFiles.includes(f));
    const sharedLabels = targetSpecificLabels.filter((l) => candSpecificLabels.includes(l));

    let relationship = null;
    let relationshipLabel = null;
    let explanation = null;
    let isExplicit = false;
    let priority = 99;
    const sharedSignals = [...new Set([...sharedFiles, ...sharedBigrams, ...sharedLabels, ...sharedTokens])].slice(0, 4);

    // ── 1. Check explicit dependencies ─────────────────────────────
    const targetHasDep = candNum && targetRefs.dependencies.includes(candNum);
    const candHasDep = targetNum && candRefs.dependencies.includes(targetNum);
    if (targetHasDep || candHasDep) {
      relationship = 'dependency';
      relationshipLabel = 'Depends on or blocks another issue';
      isExplicit = true;
      priority = 1;
      explanation = targetHasDep
        ? `Explicit dependency: The issue description references #${candNum} as a blocking prerequisite or sub-task.`
        : `Explicit dependency: Issue #${candNum} lists this issue as a prerequisite or blocking task.`;
    }

    // ── 2. Check explicit duplicate markers ────────────────────────
    if (!relationship) {
      const targetHasDup = candNum && targetRefs.duplicateRefs.includes(candNum);
      const candHasDup = targetNum && candRefs.duplicateRefs.includes(targetNum);
      const candLabelDup = (candidate.labels || []).some((l) => String(l).toLowerCase() === 'duplicate');

      if (targetHasDup || candHasDup || (candLabelDup && targetNum && candRefs.explicitRefs.includes(targetNum))) {
        relationship = 'possible_duplicate';
        relationshipLabel = 'Confirmed Duplicate (GitHub marker)';
        isExplicit = true;
        priority = 2;
        explanation = `GitHub issue records explicitly flag this as a duplicate (#${candNum || targetNum}).`;
      }
    }

    // ── 3. Content similarity: Possible Duplicate ──────────────────
    // Strictly adheres to Requirement 11: Never claim duplicate based only on a shared keyword.
    if (!relationship && isSameRepo) {
      const isHighSimilarity = titleJaccard >= 0.55 && sharedTokens.length >= 2;
      const isVeryHighJaccard = titleJaccard >= 0.70;
      const hasSharedBigramAndTokens = sharedTokens.length >= 2 && sharedBigrams.length >= 1 && titleJaccard >= 0.40;

      if (isHighSimilarity || isVeryHighJaccard || hasSharedBigramAndTokens) {
        relationship = 'possible_duplicate';
        relationshipLabel = 'Potential Duplicate';
        isExplicit = false;
        priority = 3;
        const pct = Math.round(titleJaccard * 100);
        explanation = `Potential duplicate — High phrasing overlap (${pct}% title similarity) in the same repository. Both address "${sharedTokens.slice(0, 3).join(', ')}". Verify with maintainers before starting.`;
      }
    }

    // ── 4. Same feature or bug area ────────────────────────────────
    if (!relationship && isSameRepo) {
      const hasSharedFile = sharedFiles.length > 0;
      const hasSharedSpecificLabelAndToken = sharedLabels.length >= 1 && sharedTokens.length >= 1;
      const hasSharedBigram = sharedBigrams.length >= 1;
      const hasMultipleTokens = sharedTokens.length >= 2;

      if (hasSharedFile || hasSharedSpecificLabelAndToken || hasSharedBigram || hasMultipleTokens) {
        relationship = 'same_area';
        relationshipLabel = 'Same Feature / Bug Area';
        isExplicit = false;
        priority = 4;
        const areaSignals = [...sharedFiles, ...sharedLabels, ...sharedBigrams, ...sharedTokens].slice(0, 2);
        explanation = `Touches the same feature area or code path (${areaSignals.join(', ')}). Reviewing it gives helpful context on existing conventions.`;
      }
    }

    // ── 5. Related issue ───────────────────────────────────────────
    if (!relationship) {
      const sameRepoRelated = isSameRepo && sharedTokens.length >= 1 && (candTokens.length >= 1 || sharedBigrams.length >= 1);
      const crossRepoMultipleTokens = !isSameRepo && sharedTokens.length >= 2;
      const crossRepoBigram = !isSameRepo && sharedBigrams.length >= 1;

      if (sameRepoRelated || crossRepoMultipleTokens || crossRepoBigram) {
        relationship = 'related_issue';
        relationshipLabel = 'Related Issue';
        isExplicit = false;
        priority = 5;
        const relSignals = [...sharedBigrams, ...sharedTokens].slice(0, 2);
        explanation = `Related open-source task addressing similar requirements (${relSignals.join(', ')}). Useful for architectural comparison.`;
      }
    }

    if (relationship) {
      matches.push({
        id: candidate.id || null,
        title: candidate.title,
        url: candidate.url,
        repository: candidate.repository,
        isSameRepo,
        state: candidate.state || 'open',
        relationship,
        relationshipLabel,
        isExplicit,
        explanation,
        sharedSignals,
        similarityScore: Math.round(titleJaccard * 100),
        priority,
      });
    }
  }

  // Sort: Same repository first (Requirement 6), then by relationship priority, then similarity
  matches.sort((a, b) => {
    if (a.isSameRepo !== b.isSameRepo) return b.isSameRepo ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.similarityScore - a.similarityScore;
  });

  return matches.slice(0, 4);
}

// Cache for AI & heuristic match explanations (30 min TTL)
const matchExplanationCache = new Map();

/**
 * Builds a structured, transparent match explanation grounded strictly in verified issue data.
 * Adheres to:
 * - Requirement 1: Explains match using skills, title, body, labels, repo
 * - Requirement 2: Matching skills, supporting evidence, unconfirmed requirements, suitability, limitations
 * - Requirement 3 & 4: Uses authentic excerpts; never fabricates quotes or details
 * - Requirement 5: Clearly distinguishes source-backed evidence from AI interpretation
 * - Requirement 6: Explains fit score is a relative ranking estimate, not a success probability
 */
function buildMatchExplanation(issue, userSkills = [], technologies = [], aiData = null) {
  const normSkills = (userSkills || []).map((s) => String(s || '').trim()).filter(Boolean);
  const normTech = (technologies || []).map((t) => String(t || '').trim()).filter(Boolean);
  const cacheKey = `${issue.id || issue.url}__${normSkills.slice().sort().join(',')}__${normTech.slice().sort().join(',')}`;

  if (!aiData && matchExplanationCache.has(cacheKey)) {
    const cached = matchExplanationCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 1800000) {
      return cached.data;
    }
  }

  const title = String(issue.title || '');
  const body = String(issue.body || '');
  const labels = issue.labels || [];
  const repo = String(issue.repository || '');

  // 1. Identify matching skills with explicit source attribution
  const matchingSkills = [];
  const verifiedMatched = [];

  for (const skill of normSkills) {
    const sources = [];
    if (matchSkillInText(title, skill)) sources.push('Title');
    if (matchSkillInText(body, skill)) sources.push('Description');
    if (labels.some((l) => matchSkillInText(l, skill))) sources.push('Labels');
    if (matchSkillInText(repo, skill)) sources.push('Repository');

    if (sources.length > 0) {
      verifiedMatched.push(skill);
      matchingSkills.push({
        name: skill,
        source: sources.join(', '),
        primarySource: sources[0],
        verifiedInSource: true,
      });
    } else if (aiData && Array.isArray(aiData.matchedSkills) && aiData.matchedSkills.includes(skill)) {
      // Inferred by AI but not explicitly verified by regex in source text
      matchingSkills.push({
        name: skill,
        source: 'AI-interpreted context',
        primarySource: 'AI-inferred',
        verifiedInSource: false,
      });
    }
  }

  // 2. Real Supporting Evidence Quotes (Authentic verbatim excerpts only, never fabricated)
  const supportingEvidence = extractEvidence(issue, verifiedMatched);

  // 3. Relevant requirements or skills not yet confirmed
  const unconfirmedRequirements = [];
  const skillGap = analyzeSkillGap(issue, normSkills, normTech);
  if (Array.isArray(skillGap.unconfirmedSkills)) {
    for (const gap of skillGap.unconfirmedSkills) {
      unconfirmedRequirements.push({
        name: gap.name,
        note: gap.reason || `${gap.name} appears required based on repository files or issue tags.`,
        isAiInterpreted: false,
      });
    }
  }

  // If AI specified unconfirmed requirements, validate and include them
  if (aiData && Array.isArray(aiData.unconfirmedRequirements)) {
    for (const req of aiData.unconfirmedRequirements) {
      const cleanReq = String(req || '').trim();
      if (
        cleanReq &&
        !unconfirmedRequirements.some((u) => u.name.toLowerCase() === cleanReq.toLowerCase()) &&
        !normSkills.some((s) => s.toLowerCase() === cleanReq.toLowerCase())
      ) {
        unconfirmedRequirements.push({
          name: cleanReq,
          note: 'Identified by local AI model from problem context; not yet verified in your entered skills.',
          isAiInterpreted: true,
        });
      }
    }
  }

  // 4. Short explanation of why the issue may be suitable
  let suitabilityReason = '';
  if (aiData && typeof aiData.suitabilityReason === 'string' && aiData.suitabilityReason.trim().length > 10) {
    suitabilityReason = aiData.suitabilityReason.trim();
  } else if (matchingSkills.length > 0) {
    const verifiedNames = matchingSkills.map((m) => m.name);
    if (normTech.length > 0 && normTech.some((t) => matchSkillInText(title, t) || matchSkillInText(body, t))) {
      suitabilityReason = `Directly matches your experience in ${verifiedNames.join(', ')} and aligns with your focus on ${normTech.join('/')}.`;
    } else {
      suitabilityReason = `Directly matches your skills in ${verifiedNames.slice(0, 3).join(', ')} through explicit mentions in the issue ${matchingSkills[0].source.toLowerCase()}.`;
    }
  } else if (normTech.length > 0 && normTech.some((t) => matchSkillInText(title, t) || matchSkillInText(body, t))) {
    suitabilityReason = `Aligns with your project technology focus on ${normTech.join(', ')} in an open starter repository.`;
  } else {
    suitabilityReason = `This open starter issue in ${repo || 'the repository'} provides an approachable entry point for open-source contributors.`;
  }

  // 5. Limitations and uncertainty notes (Requirement 2 & 6)
  const limitations = [];
  limitations.push('Fit score is a relative ranking estimate based on skill overlap, not a guarantee that your contribution will succeed.');
  limitations.push('Maintainer responsiveness and PR guidelines should be checked on GitHub before starting work.');

  if (!body || body.trim().length < 150) {
    limitations.push(`The issue description is brief (${body ? body.trim().length : 0} characters); setup instructions or full acceptance criteria may be omitted.`);
  }

  if (supportingEvidence.length === 0) {
    limitations.push('No exact verbatim skill phrases were quoted from the issue body; match was inferred from repository metadata or labels.');
  }

  if (aiData) {
    limitations.push(`Suitability analysis was interpreted by local AI model (${ollamaModel}); review the original discussion thread directly on GitHub.`);
    if (Array.isArray(aiData.limitations)) {
      for (const lim of aiData.limitations) {
        const cleanLim = String(lim || '').trim();
        if (cleanLim && !limitations.includes(cleanLim)) {
          limitations.push(cleanLim);
        }
      }
    }
  } else {
    limitations.push('Evaluated using deterministic keyword matching because the local AI model was not active for this search.');
  }

  const scoreDisclaimer = 'This fit score is a relative ranking estimate based on skill overlap and issue signals, not a probability that your contribution will succeed.';

  const explanation = {
    suitabilityReason,
    matchingSkills,
    supportingEvidence,
    unconfirmedRequirements: unconfirmedRequirements.slice(0, 5),
    limitations: limitations.slice(0, 5),
    scoreDisclaimer,
    sourceType: aiData ? 'ai-analyzed' : 'keyword-heuristic',
    sourceLabel: aiData ? `Local AI Model (${ollamaModel})` : 'Keyword & Issue Signal Analysis',
    timestamp: new Date().toISOString(),
  };

  matchExplanationCache.set(cacheKey, { timestamp: Date.now(), data: explanation });
  return explanation;
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

  const matchExplanation = buildMatchExplanation(issue, skills, technologies, null);

  return {
    ...issue,
    score,
    matchedSkills: matched,
    reason,
    firstStep,
    evidence,
    difficulty: estimateDifficulty(issue),
    skillGap: analyzeSkillGap(issue, skills, technologies),
    matchExplanation,
    scoreDisclaimer: matchExplanation.scoreDisclaimer,
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
  const prompt = `You help a developer choose an open-source starter issue. Rank the supplied issues for the person's skills and evaluate difficulty level (Beginner, Intermediate, Advanced, or Unknown). Use only evidence in the issue data. Do not classify an issue as Beginner solely because it has 'good first issue' if its scope involves architectural changes, security, or many files. Return ONLY a JSON array, with one object for each selected issue: {"id": number, "score": number from 0 to 100, "matchedSkills": [string], "difficulty": "Beginner" | "Intermediate" | "Advanced" | "Unknown", "difficultyReason": "short explanation of difficulty", "suitabilityReason": "one concise sentence explaining why this issue matches the developer's skills and is suitable", "unconfirmedRequirements": [string], "limitations": [string], "reason": "one short evidence-based sentence", "firstStep": "one concrete first action"}. Return at most 8 objects, ordered best fit first. Skills: ${skills.join(', ')}. Issues: ${JSON.stringify(candidates)}`;
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

      const matchExplanation = buildMatchExplanation(original, verifiedMatched, [], item);

      return {
        ...original,
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        matchedSkills: verifiedMatched,
        reason: String(item.reason || matchExplanation.suitabilityReason || 'The model found a possible skill match.'),
        firstStep: String(item.firstStep || 'Read the issue and repository contribution guide.'),
        evidence,
        difficulty,
        skillGap: analyzeSkillGap(original, skills),
        matchExplanation,
        scoreDisclaimer: matchExplanation.scoreDisclaimer,
      };
    });
  if (!ranked.length) throw new Error('The local model did not match any issue IDs.');
  return ranked;
}

const liveStreamCache = {
  timestamp: 0,
  data: [],
  rateLimited: false,
  isFallback: false,
};

async function fetchGitHubLiveStream() {
  const now = Date.now();
  if (liveStreamCache.data.length && now - liveStreamCache.timestamp < 60000) {
    return {
      events: liveStreamCache.data,
      cached: true,
      lastUpdated: new Date(liveStreamCache.timestamp).toISOString(),
      rateLimited: liveStreamCache.rateLimited,
      isFallback: Boolean(liveStreamCache.isFallback),
    };
  }

  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'IssueScout-OpenSource',
  };
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    const response = await fetch('https://api.github.com/events?per_page=30', {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 403 || response.status === 429) {
      liveStreamCache.rateLimited = true;
      if (liveStreamCache.data.length) {
        return {
          events: liveStreamCache.data,
          cached: true,
          lastUpdated: new Date(liveStreamCache.timestamp).toISOString(),
          rateLimited: true,
          isFallback: Boolean(liveStreamCache.isFallback),
          notice: 'GitHub API rate limit reached. Displaying most recent verified activity records.',
        };
      }
    }

    if (response.ok) {
      const rawEvents = await response.json();
      if (Array.isArray(rawEvents)) {
        const events = rawEvents
          .filter((ev) => ['IssuesEvent', 'PullRequestEvent', 'IssueCommentEvent', 'CreateEvent', 'PushEvent'].includes(ev.type))
          .map((ev) => {
            let actionDescription = 'Activity';
            let title = '';
            let targetUrl = `https://github.com/${ev.repo?.name}`;

            if (ev.type === 'IssuesEvent') {
              actionDescription = `${ev.payload?.action || 'updated'} issue`;
              title = ev.payload?.issue?.title || 'Issue';
              targetUrl = ev.payload?.issue?.html_url || targetUrl;
            } else if (ev.type === 'PullRequestEvent') {
              actionDescription = `${ev.payload?.action || 'updated'} pull request`;
              title = ev.payload?.pull_request?.title || 'Pull Request';
              targetUrl = ev.payload?.pull_request?.html_url || targetUrl;
            } else if (ev.type === 'IssueCommentEvent') {
              actionDescription = `commented on issue #${ev.payload?.issue?.number || ''}`;
              title = ev.payload?.issue?.title || 'Commented on issue';
              targetUrl = ev.payload?.comment?.html_url || ev.payload?.issue?.html_url || targetUrl;
            } else if (ev.type === 'PushEvent') {
              actionDescription = `pushed ${ev.payload?.size || 1} commit(s)`;
              title = `Branch ${ev.payload?.ref?.replace('refs/heads/', '') || 'main'}`;
            } else if (ev.type === 'CreateEvent') {
              actionDescription = `created ${ev.payload?.ref_type || 'branch'}`;
              title = ev.payload?.ref || ev.repo?.name;
            }

            return {
              id: String(ev.id),
              type: ev.type,
              action: actionDescription,
              repo: ev.repo?.name || 'Open Source Project',
              repoUrl: `https://github.com/${ev.repo?.name}`,
              actor: ev.actor?.display_login || ev.actor?.login || 'contributor',
              actorUrl: `https://github.com/${ev.actor?.login}`,
              actorAvatar: ev.actor?.avatar_url || '',
              title,
              url: targetUrl,
              createdAt: ev.created_at,
              isLive: true,
            };
          });

        if (events.length > 0) {
          liveStreamCache.timestamp = now;
          liveStreamCache.data = events;
          liveStreamCache.rateLimited = false;
          liveStreamCache.isFallback = false;
          return {
            events,
            cached: false,
            lastUpdated: new Date(now).toISOString(),
            rateLimited: false,
            isFallback: false,
          };
        }
      }
    }
  } catch {
    // Network / timeout error fallback
  }

  // Graceful verified fallback: construct real activity from our verified issues pool (Never fabricate data)
  const fallbackEvents = BUNDLED_STARTER_ISSUES.slice(0, 10).map((issue) => ({
    id: `starter-${issue.id}`,
    type: 'IssuesEvent',
    action: 'opened starter issue',
    repo: issue.repository,
    repoUrl: `https://github.com/${issue.repository}`,
    actor: 'maintainer',
    actorUrl: `https://github.com/${issue.repository.split('/')[0]}`,
    actorAvatar: 'https://github.com/github.png',
    title: issue.title,
    url: issue.url,
    createdAt: issue.updatedAt || new Date().toISOString(),
    isLive: false,
    fallback: true,
  }));

  liveStreamCache.timestamp = now;
  liveStreamCache.data = liveStreamCache.data.length ? liveStreamCache.data : fallbackEvents;
  liveStreamCache.rateLimited = true;
  liveStreamCache.isFallback = true;

  return {
    events: liveStreamCache.data,
    cached: true,
    lastUpdated: new Date(now).toISOString(),
    rateLimited: true,
    isFallback: true,
    notice: 'Direct GitHub stream rate-limited or temporarily unreachable. Showing recent verified repository issue activity.',
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();

    // Production Health Endpoint (Requirement 13 & 15)
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      let localModelReady = false;
      try {
        const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (resp.ok) {
          const d = await resp.json();
          localModelReady = (d.models || []).some((m) => m.name === ollamaModel || m.name.startsWith(`${ollamaModel}:`));
        }
      } catch { /* optional */ }

      return send(res, 200, {
        status: 'ok',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        nodeVersion: process.version,
        services: {
          ollama: {
            url: ollamaUrl,
            model: ollamaModel,
            ready: localModelReady,
          },
          githubApi: {
            authenticated: Boolean(githubToken),
          },
        },
      });
    }

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

    // Live Stream Activity Endpoint (Requirement 7)
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const streamRate = checkRateLimit(clientIp, 60, 60000);
      if (!streamRate.allowed) {
        return send(res, 429, { error: `Too many stream requests. Retry in ${streamRate.reset}s.` }, 'application/json', {
          'Retry-After': String(streamRate.reset),
        });
      }
      const streamData = await fetchGitHubLiveStream();
      return send(res, 200, streamData, 'application/json; charset=utf-8', {
        'Cache-Control': 'public, max-age=60',
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/find') {
      const findRate = checkRateLimit(clientIp, 60, 60000);
      if (!findRate.allowed) {
        return send(res, 429, { error: `Too many search requests. Retry in ${findRate.reset}s.` }, 'application/json', {
          'Retry-After': String(findRate.reset),
        });
      }
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
      let ranked = [];
      let rankingMode = 'local-ai';
      let aiMessage = undefined;
      try {
        ranked = await rankWithOllama(issues, skills);
      } catch (error) {
        ranked = issues.map((issue) => localScore(issue, skills, technologies)).sort((a, b) => b.score - a.score).slice(0, 8);
        rankingMode = 'keyword-fallback';
        aiMessage = error.message;
      }

      // Assess Repository Health for unique repositories in ranked candidates
      const uniqueRepos = [...new Set(ranked.map((item) => item.repository).filter(Boolean))];
      const healthMap = new Map();
      await Promise.all(
        uniqueRepos.map(async (repo) => {
          const fallbackIssue = ranked.find((item) => item.repository === repo);
          const health = await assessRepoHealth(repo, fallbackIssue);
          if (health) healthMap.set(repo, health);
        })
      );

      const candidatePool = [...ranked, ...knownIssuesPool.values(), ...BUNDLED_STARTER_ISSUES];
      const enriched = ranked.map((issue) => ({
        ...issue,
        repoHealth: healthMap.get(issue.repository) || null,
        relatedIssues: detectRelatedIssues(issue, candidatePool),
      }));

      return send(res, 200, {
        issues: enriched,
        rankingMode,
        model: ollamaModel,
        aiMessage,
        fallbackActive,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/related-issues') {
      const issueUrl = url.searchParams.get('url') || '';
      const repo = url.searchParams.get('repo') || '';
      const title = url.searchParams.get('title') || '';
      const body = url.searchParams.get('body') || '';

      let targetIssue = knownIssuesPool.get(issueUrl);
      if (targetIssue) {
        targetIssue = { ...targetIssue };
        if (title) targetIssue.title = title;
        if (body) targetIssue.body = body;
        if (repo) targetIssue.repository = repo;
      } else if (title || issueUrl) {
        targetIssue = {
          url: issueUrl,
          repository: repo,
          title,
          body,
          labels: [],
        };
      }
      if (!targetIssue) {
        return send(res, 400, { error: 'Provide url or title and repo query parameters.' });
      }

      let candidatePool = [...knownIssuesPool.values(), ...BUNDLED_STARTER_ISSUES];
      if (repo) {
        const sameRepo = await fetchSameRepoIssues(repo);
        candidatePool = [...sameRepo, ...candidatePool];
      }

      const relatedIssues = detectRelatedIssues(targetIssue, candidatePool);
      return send(res, 200, {
        issueUrl: targetIssue.url,
        repository: targetIssue.repository,
        relatedIssues,
        totalMatches: relatedIssues.length,
        analyzedCount: candidatePool.length,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/repo-health') {
      const repo = url.searchParams.get('repo');
      if (!repo) return send(res, 400, { error: 'Provide a repo parameter (e.g. ?repo=owner/repo).' });
      const health = await assessRepoHealth(repo);
      return send(res, 200, health || { error: 'Could not assess repository health.' });
    }

    // Static Assets and SPA Clean Route Handlers (Requirement 10 & 15)
    const isGetOrHead = req.method === 'GET' || req.method === 'HEAD';
    const isHead = req.method === 'HEAD';
    if (
      isGetOrHead &&
      (url.pathname === '/' ||
        url.pathname === '/find' ||
        url.pathname === '/blueprint' ||
        url.pathname === '/pr-generator' ||
        url.pathname === '/git-handbook' ||
        url.pathname === '/live-stream' ||
        url.pathname === '/picks')
    ) {
      const html = await readFile(path.join(root, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8', {}, isHead);
    }

    if (isGetOrHead && url.pathname === '/styles.css') {
      const css = await readFile(path.join(root, 'styles.css'), 'utf8');
      return send(res, 200, css, 'text/css; charset=utf-8', {}, isHead);
    }

    if (isGetOrHead && url.pathname === '/app.js') {
      const js = await readFile(path.join(root, 'app.js'), 'utf8');
      return send(res, 200, js, 'text/javascript; charset=utf-8', {}, isHead);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error.message && error.message.includes('Payload Too Large')) {
      return send(res, 413, { error: error.message });
    }
    if (error.isParseError) {
      return send(res, 400, { error: error.message || 'Invalid JSON in request body.' });
    }
    return send(res, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(port, host, () => console.log(`IssueScout ready at http://${host}:${port}`));
