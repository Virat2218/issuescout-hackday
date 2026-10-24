# 🔭 IssueScout

**Discover your first open-source contribution.** IssueScout helps beginners find starter GitHub issues matched to their skills using local AI and verified public signals — no API key required.

[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-339933?logo=nodedotjs)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-10%2F10-22c55e)](#testing)

---

## Features

| Feature | Description |
|---|---|
| **🔍 Find Issues** | Search GitHub for good-first-issue candidates matching your skills. AI-powered ranking with Qwen/Ollama. |
| **🎯 Skill-Gap Analysis** | Compare your skills vs. issue requirements. Shows matched, missing, and optional skills with learning resources. |
| **🏥 Repo Health** | Assess repository maintenance signals (commits, PRs, releases, archival status). Never uses stars/forks as quality proxies. |
| **🔗 Related Issues** | Detect potential duplicates and related issues using keyword + text similarity. |
| **🤖 AI Match Explanation** | Transparent, source-backed match reasoning. Distinguishes inferred vs. evidence-backed claims. |
| **🗺️ Fix Blueprint** | Step-by-step verified contribution plan: claim → fork → reproduce → test → PR. Progress saved across refreshes. |
| **📝 PR Generator** | Generate structured, maintainer-friendly PR descriptions. 4 templates, live Markdown preview, copy & download. |
| **📖 Git Handbook** | 12 Git reference topics (basics → danger zone). Searchable, filterable, with copyable commands. |
| **🟢 Live Stream** | Real GitHub public event feed. 60s cache, pause/resume, NEW badges for fresh events. |
| **⭐ My Picks** | Save issues locally. Open Blueprint or PR Gen from saved picks. Export contribution plan as Markdown. |
| **🌗 Light/Dark Theme** | Persisted theme preference. Respects OS `prefers-color-scheme`. Zero flash on load. |

---

## Architecture

```
issuescout/
├── server.mjs         # Node.js HTTP server (no framework dependencies)
├── app.js             # Full frontend logic (vanilla JS, ~3500 lines)
├── styles.css         # Design system + all view styles (~5200 lines)
├── index.html         # Single-page app shell with all 6 view panels
├── test/
│   └── issuescout.test.mjs  # 10-test automated suite (node:test)
├── Dockerfile         # Node 20 Alpine, non-root user, HEALTHCHECK
├── docker-compose.yml # issuescout + optional Ollama services
├── .env.example       # All supported environment variables
└── package.json       # Scripts: start, dev, test
```

**No npm dependencies.** The entire project uses built-in Node.js APIs only.

---

## Local Development

### Prerequisites
- Node.js ≥ 20.0.0
- (Optional) [Ollama](https://ollama.ai) with `qwen2.5:1.5b-instruct` for AI ranking

### 1. Clone & Start

```bash
git clone https://github.com/YOUR_USERNAME/issuescout.git
cd issuescout
cp .env.example .env
node server.mjs          # or: npm start
```

Open **http://localhost:4173** in your browser.

### 2. Enable AI Ranking (Optional)

```bash
# Install Ollama (https://ollama.ai), then:
ollama pull qwen2.5:1.5b-instruct
```

IssueScout detects Ollama automatically. Without it, skill-match scoring uses keyword matching.

### 3. GitHub Token (Optional, Recommended)

A GitHub personal access token raises the API rate limit from 60 to 5,000 requests/hour:

```bash
# .env
GITHUB_TOKEN=ghp_your_token_here
```

Generate one at: Settings → Developer Settings → Personal Access Tokens → Fine-grained → No repository access needed.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4173` | HTTP port to listen on |
| `HOST` | `0.0.0.0` | Bind address (use `127.0.0.1` for local-only) |
| `GITHUB_TOKEN` | _(none)_ | Optional GitHub PAT for higher API rate limits |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama service URL |
| `OLLAMA_MODEL` | `qwen2.5:1.5b-instruct` | Ollama model to use for AI ranking |
| `NODE_ENV` | `production` | Environment name |

---

## Testing

```bash
# Requires server running on port 4173
node server.mjs &
npm test
```

**10/10 tests pass**, covering:

1. Health check endpoints (`/health`, `/api/health`)
2. Live stream endpoint (`/api/stream`) — shape, cache headers, fallback flag
3. SPA route fallbacks for all 6 views
4. Security headers (CSP, nosniff, X-Frame-Options)
5. Request body size enforcement (413 on >64KB)
6. Input validation and JSON parse error handling (400)
7. PR Generator Markdown synthesis
8. Difficulty classification logic
9. Skill-gap categorization
10. Blueprint command generation integrity

---

## Docker Deployment

### Build & Run

```bash
docker build -t issuescout .
docker run -p 4173:4173 -e GITHUB_TOKEN=your_token issuescout
```

### Docker Compose (with Ollama)

```bash
docker compose up -d
```

This starts:
- `issuescout` on port 4173
- `ollama` on port 11434 (optional, for AI ranking)

---

## Production Deployment

### Render.com (Free Tier)

1. Connect your GitHub repository
2. Set Build Command: _(none, no build step needed)_
3. Set Start Command: `node server.mjs`
4. Add Environment Variables: `GITHUB_TOKEN`, `PORT` (Render sets `PORT` automatically)

### Railway

```bash
railway init
railway add --service issuescout
railway deploy
```

Set `GITHUB_TOKEN` in Railway environment variables.

### VPS / Ubuntu

```bash
git clone https://github.com/YOUR_USERNAME/issuescout.git
cd issuescout
cp .env.example .env && nano .env
# Install pm2: npm install -g pm2
pm2 start server.mjs --name issuescout
pm2 save && pm2 startup
```

---

## Security Notes

- **No external runtime dependencies** — only Node.js built-ins.
- **In-memory IP rate limiter** — 60 req/60s per IP, sliding window.
- **64KB body limit** — prevents memory exhaustion on POST endpoints.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`, CSP, `Referrer-Policy`.
- **Local AI only** — Ollama runs 100% locally; no user data sent to external AI services.
- **Browser localStorage only** — No user accounts, no database, no tracking.
- **GitHub token** — Never exposed to the frontend; used server-side only.
- **`.gitignore`** — Prevents committing `.env`, `node_modules`, or `.agents/` config.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (uptime, services readiness) |
| `GET` | `/api/health` | Alias for `/health` |
| `GET` | `/api/stream` | GitHub public event feed (60s cache) |
| `GET` | `/api/status` | Ollama + GitHub API status |
| `GET` | `/api/repo-health` | Repository health assessment |
| `GET` | `/api/related-issues` | Related/duplicate issue detection |
| `POST` | `/api/find` | Issue search + AI ranking |

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

1. Fork this repository
2. `git checkout -b feat/your-feature`
3. Run tests: `npm test`
4. Open a pull request

Built with ❤️ using zero external dependencies.
