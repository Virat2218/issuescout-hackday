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
 * Estimate difficulty level of a GitHub issue using heuristics.
 * Returns { level: 'beginner'|'intermediate'|'advanced'|'unknown', explanation: string, confidence: 'label'|'heuristic'|'low' }
 * Does NOT call the AI model — runs cheaply on every issue synchronously.
 */
function estimateDifficulty(issue) {
  const labelStr = (issue.labels || []).join(' ').toLowerCase();
  const titleStr = (issue.title || '').toLowerCase();
  const bodyStr  = (issue.body  || '').toLowerCase();
  const combined = `${titleStr} ${bodyStr} ${labelStr}`;

  // ── 1. Explicit label signals (highest confidence) ──────────────────
  const BEGINNER_LABELS = /\b(good[- ]first[- ]issue|beginner|first[- ]timer|easy|starter|hacktoberfest|introductory|newbie)\b/;
  const INTERMEDIATE_LABELS = /\b(difficulty[:-]medium|skill[:-]intermediate|moderate|help[- ]wanted)\b/;
  const ADVANCED_LABELS = /\b(difficulty[:-]hard|difficulty[:-]advanced|complexity[:-]high|senior|expert|complex|performance|security|architecture)\b/;

  if (ADVANCED_LABELS.test(labelStr)) {
    return { level: 'advanced', explanation: 'Issue labels indicate advanced complexity.', confidence: 'label' };
  }
  if (INTERMEDIATE_LABELS.test(labelStr)) {
    return { level: 'intermediate', explanation: 'Issue labels indicate intermediate difficulty.', confidence: 'label' };
  }
  if (BEGINNER_LABELS.test(labelStr)) {
    // Even with a beginner label, scope signals can upgrade it
    const upgradeSignals = [
      /refactor|architecture|redesign|migration|security|performance|optimize|scale/i.test(combined),
      /\b(database|auth|oauth|jwt|redis|kubernetes|docker|ci\/cd|pipeline)\b/i.test(combined),
      (combined.match(/\bfile\b/gi) || []).length > 4, // many file references
    ].filter(Boolean).length;
    if (upgradeSignals >= 2) {
      return { level: 'intermediate', explanation: 'Labelled as beginner-friendly but scope hints at moderate complexity (refactor/architecture/infrastructure).', confidence: 'heuristic' };
    }
    return { level: 'beginner', explanation: 'Issue is explicitly labelled for first-time contributors.', confidence: 'label' };
  }

  // ── 2. Advanced heuristic signals ───────────────────────────────────
  const advancedSignals = [
    /\b(refactor|redesign|rewrite|overhaul)\b/i.test(titleStr),
    /\b(security|auth|encryption|vulnerability|cve)\b/i.test(combined),
    /\b(performance|benchm|optimize|profile|memory leak|race condition)\b/i.test(combined),
    /\b(breaking change|api design|schema|migration|upgrade)\b/i.test(combined),
    /\b(concurrency|thread|async queue|deadlock|websocket)\b/i.test(combined),
    (issue.comments || 0) > 15,
    (bodyStr.match(/\b(file|class|module|function|component|hook)\b/gi) || []).length > 8,
  ].filter(Boolean).length;

  if (advancedSignals >= 3) {
    return { level: 'advanced', explanation: 'Multiple complexity signals detected: broad scope, security/performance concerns, or heavy discussion.', confidence: 'heuristic' };
  }

  // ── 3. Intermediate heuristic signals ───────────────────────────────
  const intermediateSignals = [
    /\b(add|implement|create|build|integrate)\b/i.test(titleStr),
    /\b(unit test|integration test|e2e|coverage|mock)\b/i.test(combined),
    /\b(api|endpoint|route|middleware|hook|plugin)\b/i.test(combined),
    /\b(configuration|environment|settings|feature flag)\b/i.test(combined),
    advancedSignals >= 1,
    (bodyStr.length > 600),
  ].filter(Boolean).length;

  if (intermediateSignals >= 3) {
    return { level: 'intermediate', explanation: 'Issue involves building or integrating functionality — more than a small fix but manageable.', confidence: 'heuristic' };
  }

  // ── 4. Beginner heuristic signals ───────────────────────────────────
  const beginnerSignals = [
    /\b(typo|spelling|grammar|comment|rename|missing|broken link|lint|format)\b/i.test(combined),
    /\b(fix|update|correct|remove|add \w+ to)\b/i.test(titleStr),
    /\b(documentation|readme|contributing|changelog|doc[s]?)\b/i.test(combined),
    (bodyStr.length < 250 && titleStr.length < 80),
    detectReferencedFiles(issue.body).length === 1,
  ].filter(Boolean).length;

  if (beginnerSignals >= 2) {
    return { level: 'beginner', explanation: 'Small, well-scoped change (typo, docs, minor fix) — good for first contributions.', confidence: 'heuristic' };
  }

  // ── 5. Not enough signal ─────────────────────────────────────────────
  return { level: 'unknown', explanation: 'Not enough evidence in labels or description to estimate difficulty reliably.', confidence: 'low' };
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
  const prompt = `You help a beginner choose an open-source issue. Rank the supplied issues for the person's skills. Use only evidence in the issue data. Do not claim an issue is easy unless its text or labels support that. Return ONLY a JSON array, with one object for each selected issue: {"id": number, "score": number from 0 to 100, "matchedSkills": [string], "reason": "one short evidence-based sentence", "firstStep": "one concrete first action"}. Return at most 8 objects, ordered best fit first. Skills: ${skills.join(', ')}. Issues: ${JSON.stringify(candidates)}`;
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
      return {
        ...original,
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        matchedSkills: verifiedMatched,
        reason: String(item.reason || 'The model found a possible skill match.'),
        firstStep: String(item.firstStep || 'Read the issue and repository contribution guide.'),
        evidence,
        difficulty: estimateDifficulty(original),
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
