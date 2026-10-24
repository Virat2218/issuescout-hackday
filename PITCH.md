# IssueScout: 8-minute pitch and demo

## 0:00–0:45 — Problem

First-time contributors want to help open-source projects, but a search for beginner issues can return stale, unassigned, or technically mismatched work. They often cannot tell which issue fits their current skills or what to do first.

## 0:45–1:15 — Product

IssueScout starts with the skills a contributor already has and returns a short list of open, unassigned starter issues. Contributors can optionally filter for a language or framework they want to work with. Each result shows why it may fit, when it was updated, and one practical first step.

## 1:15–4:30 — Live demo

1. Enter `JavaScript, React, CSS`.
2. Search GitHub and show the local model status.
3. Open one result and show the matched skill, read the reason, and compare it with the evidence excerpt from the issue text.
4. Follow the link to GitHub and confirm that the issue remains open and unassigned.
5. Mark one issue as “I’d work on this,” search again, and show similar suggestions moving higher.
6. Click “Export plan 📋” to download and copy a Markdown contribution checklist with direct issue links, contribution guides, and concrete first steps.

## 4:30–5:45 — How it works

The Node.js server queries GitHub for open issues labeled `good first issue` or `help wanted`, filters unassigned issues, and optionally narrows candidates to those mentioning a requested technology. It sends up to 20 candidates plus the skill list to Qwen2.5-1.5B-Instruct running locally with Ollama. The model ranks the candidates and returns a score, matched skills, a reason, and a first action. A visible keyword fallback is available if local inference fails.

## 5:45–6:30 — Responsible limits

The model can make a poor match or miss context. GitHub supplies the issue state, and contributors should read the issue and repository contribution guide before starting. Results are suggestions, not guarantees that maintainers will accept a contribution.

## 6:30–7:15 — Next improvements

1. **Automated Contribution Guide Checks**: Deep-link and parse each repository's `CONTRIBUTING.md` to highlight setup requirements, CLA agreements, and PR checklists upfront.
2. **Maintainer Responsiveness Signals**: Index median time-to-first-review across repositories to route newcomers toward welcoming, active maintainer teams.
3. **CI/CD & Toolchain Requirements**: Parse repository workflow files (`.github/workflows`) to warn contributors of prerequisite tools (e.g. Docker, specific Python/Node versions) before starting.

## 7:15–8:00 — Close

IssueScout helps a newcomer turn what they already know into a specific first contribution. The demo proves the full path from skills to a live issue and a concrete next action.

## Likely judge questions

- **What makes this AI-powered?** The local open-weight model compares skill context with issue descriptions and generates ranked, evidence-based reasons. GitHub remains the source of truth for issue status.
- **Why a local model?** It makes the ranking work without sending issue text or the user's skills to a hosted model provider.
- **How do you prevent stale suggestions?** GitHub search filters for open, unassigned issues and sorts by update time. IssueScout shows the last update age and warns when an issue has not changed in more than 90 days.
- **What are the current limits?** Search depends on GitHub availability and rate limits. The local model can mis-rank issues, so users should verify the issue and contribution guide.
- **How is the project licensed?** IssueScout is MIT licensed. The default model is Apache-2.0 and Ollama is MIT; see the README for the component list.
