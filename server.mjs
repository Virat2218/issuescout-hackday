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

async function searchGitHub() {
  const searches = ['good first issue', 'help wanted'];
  const results = await Promise.all(searches.map(async (label) => {
    const query = `is:issue is:open no:assignee label:"${label}"`;
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', query);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '30');
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
  }));

  const unique = new Map();
  for (const item of results.flat()) {
    unique.set(item.html_url, {
      id: item.id,
      title: item.title,
      url: item.html_url,
      repository: item.repository_url.split('/').slice(-2).join('/'),
      state: item.state,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      comments: item.comments,
      labels: (item.labels || []).map((label) => label.name),
      body: (item.body || '').slice(0, 1800),
    });
  }
  return [...unique.values()].slice(0, 50);
}

function localScore(issue, skills) {
  const haystack = `${issue.title} ${issue.body} ${issue.repository} ${issue.labels.join(' ')}`.toLowerCase();
  const matched = skills.filter((skill) => haystack.includes(skill.toLowerCase()));
  const starter = issue.labels.some((label) => /good first issue|beginner|easy/i.test(label));
  return {
    ...issue,
    score: Math.min(98, 48 + matched.length * 12 + (starter ? 8 : 0)),
    matchedSkills: matched,
    reason: matched.length
      ? `The issue mentions ${matched.slice(0, 3).join(', ')} and is still open.`
      : `This is an open, unassigned starter issue. Read the contribution guide before starting.`,
    firstStep: `Open the issue and check its acceptance criteria and repository contribution guide.`,
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
    .map((item) => ({
      ...byId.get(String(item.id)),
      score: Math.max(0, Math.min(100, Number(item.score) || 0)),
      matchedSkills: Array.isArray(item.matchedSkills) ? item.matchedSkills : [],
      reason: String(item.reason || 'The model found a possible skill match.'),
      firstStep: String(item.firstStep || 'Read the issue and repository contribution guide.'),
    }));
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
      let issues = await searchGitHub();
      if (technologies.length) {
        issues = issues.filter((issue) => {
          const searchable = `${issue.title} ${issue.body} ${issue.repository} ${issue.labels.join(' ')}`.toLowerCase();
          return technologies.some((technology) => searchable.includes(technology.toLowerCase()));
        });
      }
      if (!issues.length) return send(res, 200, { issues: [], rankingMode: 'none' });
      try {
        const ranked = await rankWithOllama(issues, skills);
        return send(res, 200, { issues: ranked, rankingMode: 'local-ai', model: ollamaModel });
      } catch (error) {
        const ranked = issues.map((issue) => localScore(issue, skills)).sort((a, b) => b.score - a.score).slice(0, 8);
        return send(res, 200, { issues: ranked, rankingMode: 'keyword-fallback', model: ollamaModel, aiMessage: error.message });
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
