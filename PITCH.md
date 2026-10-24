# IssueScout: 8-minute pitch and demo

## 0:00–0:45 — Problem

First-time contributors want to help open-source projects, but a search for beginner issues can return stale, unassigned, or technically mismatched work. They often cannot tell which issue fits their current skills or what to do first.

## 0:45–1:15 — Product

IssueScout starts with the skills a contributor already has and returns a short list of open, unassigned starter issues. Each result shows why it may fit and one practical first step.

## 1:15–4:30 — Live demo

1. Enter `JavaScript, React, CSS`.
2. Search GitHub and show the local model status.
3. Open one result and point out its labels, skill match, reason, and first step.
4. Follow the link to GitHub and confirm that the issue remains open and unassigned.

## 4:30–5:45 — How it works

The Node.js server queries GitHub for open issues labeled `good first issue` or `help wanted`, filters unassigned issues, and sends up to 20 candidates plus the skill list to Qwen2.5-1.5B-Instruct running locally with Ollama. The model ranks the candidates and returns a score, matched skills, a reason, and a first action. A visible keyword fallback is available if local inference fails.

## 5:45–6:30 — Responsible limits

The model can make a poor match or miss context. GitHub supplies the issue state, and contributors should read the issue and repository contribution guide before starting. Results are suggestions, not guarantees that maintainers will accept a contribution.

## 6:30–7:15 — Next improvements

Prioritize fresher issues, add language and framework filters, and learn from which suggested issues contributors actually choose. Keep the local model and show evidence for every recommendation.

## 7:15–8:00 — Close

IssueScout helps a newcomer turn what they already know into a specific first contribution. The demo proves the full path from skills to a live issue and a concrete next action.

## Likely judge questions

- **What makes this AI-powered?** The local open-weight model compares skill context with issue descriptions and generates ranked, evidence-based reasons. GitHub remains the source of truth for issue status.
- **Why a local model?** It makes the ranking work without sending issue text or the user's skills to a hosted model provider.
- **How do you prevent stale suggestions?** GitHub search filters for open, unassigned issues and sorts by update time. A future improvement is a visible freshness threshold and warning.
- **What are the current limits?** Search depends on GitHub availability and rate limits. The local model can mis-rank issues, so users should verify the issue and contribution guide.
- **How is the project licensed?** IssueScout is MIT licensed. The default model is Apache-2.0 and Ollama is MIT; see the README for the component list.
