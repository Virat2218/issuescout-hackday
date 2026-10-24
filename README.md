# IssueScout

IssueScout helps first-time open-source contributors find an open, unassigned starter issue that fits the skills they already have. It is our entry for the HackDay **Best Open-Source AI Project** track.

## Models, tools, and licenses

| Component | Use | License |
| --- | --- | --- |
| IssueScout source code | Search, ranking integration, and web interface | MIT; see [`LICENSE`](LICENSE) |
| Qwen2.5-1.5B-Instruct (`qwen2.5:1.5b-instruct`) | Local AI issue ranking and evidence-based explanations | Apache-2.0 |
| Ollama | Runs the model locally and exposes its local HTTP API | MIT |
| Node.js built-in modules | Local web server and HTTP requests | MIT; no third-party Node packages are used |
| GitHub REST API | Retrieves public open issues and their labels/status | GitHub-hosted public API; no issue text is sent to the AI provider |
| Codex (GPT-6) | AI coding assistant used to scaffold this MVP | Proprietary service; development only, not included in the app |
| Google Fonts (DM Sans, DM Mono, Space Grotesk) | Interface typography | SIL Open Font License 1.1 |

The model and runtime are separate downloads; IssueScout does not redistribute their weights or binaries. Verify third-party terms before redistributing or using the project outside the hackathon.

## What the MVP does

1. Searches GitHub for open, unassigned issues tagged `good first issue` or `help wanted`.
2. Optionally filters candidates to issues that mention at least one chosen language or framework in the title, description, labels, or repository.
3. Sends the remaining issue text and the contributor's skills to a local Ollama model for ranking and evidence-based explanations.
4. Shows matched skills, freshness, a first action, and a direct link to each issue.
5. Lets contributors mark issues they would work on and moves later issues with similar labels or matched skills higher in the list.

A pick stores only the GitHub issue ID, labels, and matched skills in this browser. The pick history is never sent to the server, and personalization only reorders the returned shortlist; it does not change the model fit score.

The model does not decide whether an issue is open. GitHub's live search results supply that state. Issue titles and descriptions are sent only to the local Ollama service; the GitHub search itself is public and goes to GitHub.

## Run it

Requirements: Node.js 20+ and internet access for GitHub issue search. A GitHub token is optional; set `GITHUB_TOKEN` to avoid the tighter anonymous search limit during a live demo.

1. Install [Ollama](https://ollama.com/) and load the Apache-2.0 instruct model:

   ```sh
   ollama pull qwen2.5:1.5b-instruct
   ollama serve
   ```

   If `ollama serve` is already running on your computer, skip that command.

2. In a terminal in this folder, start IssueScout:

   ```sh
   node server.mjs
   ```

3. Open [http://localhost:4173](http://localhost:4173).

To change the model or port, set `OLLAMA_MODEL` or `PORT` before starting the server. If Ollama is unavailable, the app still shows a transparent keyword-based fallback, but the hackathon demo should use local AI ranking.

## How the AI is used

The server searches GitHub for issues marked `good first issue` or `help wanted`. An optional technology focus filters the candidates by their title, description, labels, or repository before the local model ranks up to 20 issues against the user's skills. The model returns a score, matched skills, a short reason, and a first action. GitHub supplies the open and unassigned filters; the model does not decide whether an issue is still available. The fallback uses keyword overlap only and is clearly labeled, so it should not be presented as an AI result.
When someone marks an issue as a pick, the browser stores its GitHub issue ID, labels, and matched skills in local storage. Later results with overlapping labels or matched skills move higher; no pick history is included in the search request.

## 12-hour build plan

- Hours 1–2: confirm the issue search and agree on a tight MVP.
- Hours 3–5: build the search UI and connect GitHub's issue search.
- Hours 6–8: connect local AI ranking and show evidence for each match.
- Hours 9–10: handle empty results, rate limits, and model errors; polish the demo.
- Hours 11–12: rehearse a two-minute demo and prepare the README and repository.

## Demo flow

Enter `JavaScript, React, CSS`, search, open a result, and explain the model's match against the actual issue text. Point out the issue's update age and any stale warning, then show it on GitHub to verify that it is still open and unassigned.

## Judging focus

- **Technology and open-source AI use (25%)**: show the local Qwen model ranking real GitHub issues and explain why it selected each one.
- **Completion and working demo (20%)**: complete a search live, open an issue, and verify its current status on GitHub.
- **Idea clarity, impact, and originality (20%)**: help beginners move from a skill list to a concrete contribution they can start.
- **Understanding of implementation (15%)**: explain the GitHub search, local model request, ranking fields, and keyword fallback.
- **Design and usability (10%)**: demonstrate the responsive interface and clear next step on each result.
- **Presentation and Q&A (10%)**: use the pitch outline in [`PITCH.md`](PITCH.md); deck timing is 8 minutes for the pitch and 4 minutes for Q&A.
