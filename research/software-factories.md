# Software Factories: what they are and how they're built today

_Research date: 2026-10-31. Scope: the "software factory" half of the research. Custom agents / skills / plugins / MCP / instructions guidance is covered by a sibling session; factory-relevant notes on those primitives are in §7._

**Source-trust key:** 🟢 primary (vendor/author's own page, fetched and read) · 🟡 secondary/summary (web-search synthesis or vendor-marketing; verify before quoting) 

---

## 1. TL;DR

- A **software factory** treats delivery as a production system: standardized inputs (issues/specs), a defined assembly path, automated quality control, and evidence-backed outputs. The 2026 "agentic" variant puts AI agents in the pipeline as workers while humans define intent, set acceptance criteria, govern access, and review evidence. 🟢 [TrueFoundry guide](https://www.truefoundry.com/blog/software-factory-agentic-enterprise-guide) (vendor, but a good definition)
- The stages are durable (Plan → Build → Verify/Validate → Deploy → Observe); what changes is **where humans spend attention** and that every stage reads/writes a **shared knowledge layer**. 🟢 [Microsoft Command Line](https://commandline.microsoft.com/new-agentic-software-delivery-primitives/)
- GitHub's own framing at Universe '26: the SDLC "is no longer a linear path"; output is "completed work, not more code"; developers "set the direction, make decisions, and stay accountable"; agents "implement and verify"; automations "learn from their outcomes." 🟢 [GitHub Universe 2026 blog](https://github.blog/news-insights/company-news/github-universe-2026-evolving-every-layer-of-the-stack/)
- Real examples span a spectrum from **human-gated** (GitHub/Microsoft: agent → draft PR → human review) to **"dark factory"** (StrongDM: no human writes *or reviews* code; scenario-based validation instead) with OpenAI's "humans steer, agents execute" in between.
- The biggest recurring lessons: **the harness (context, tools, mechanical checks) matters more than the model; verification must be independent of the implementer; encode rules in lints/CI not prose; keep humans on goals, ambiguity, and acceptance.**

---

## 2. Definitions & the autonomy spectrum

| Term | Meaning | Source |
|---|---|---|
| Software factory (classic) | Industrialized, reusable-asset delivery; predates AI (Bemer 1968, SDC 1975, Microsoft's 2004 *Software Factories* book) | 🟢 [TrueFoundry history](https://www.truefoundry.com/blog/software-factory-agentic-enterprise-guide) |
| Agentic software factory (2026) | Fleets of coding agents inside a feedback loop; engineers define intent and review evidence. BCG Platinion ("Agentic Software Factory", Mar 2026) and Factory.ai ("Factory 2.0", Jun 2026) popularized it | 🟡 via TrueFoundry |
| Pipeline ≠ factory | A factory is broader than a coding assistant (it includes the system around the agent) and broader than CI/CD (it governs work *inside* stations, not only transitions) | 🟢 TrueFoundry |
| "Dark factory" | Level-5 autonomy: no human writes or reviews code (Dan Shapiro's "five levels" → StrongDM) | 🟢 [Simon Willison](https://simonwillison.net/2026/Feb/7/software-factory/) |

**Autonomy spectrum (useful for choosing our demo's posture):**

1. Assistant (human in every step) →
2. Agent produces draft PR, **human reviews every PR** (GitHub Copilot cloud agent, Universe `issue-to-pr` skill) →
3. Agent-to-agent review, humans optional/sampled (OpenAI harness-engineering team: "Humans may review pull requests, but aren't required to") →
4. Spec + scenarios drive agents, **no human code review**, validation by holdout scenarios (StrongDM).

Pick level 2 for a demo: it is credible, safe, and shows the gates clearly.

---

## 3. Reference pipeline & architecture

### 3.1 Stages, human job, artifact (Microsoft)
🟢 [Microsoft Command Line – new agentic software delivery primitives](https://commandline.microsoft.com/new-agentic-software-delivery-primitives/)

| Stage | Human job-to-be-done | Artifact that carries work forward |
|---|---|---|
| Plan | Choose problems, resolve ambiguity, decide tradeoffs | Goals & acceptance criteria |
| Build | Guide key design decisions; resolve things needing judgment | Candidate implementation (PR) + context for its choices |
| Verify | Judge "is what we built what we intended?" | Auditable evidence + release record |
| Observe | Interpret signals; decide what ships | Real outcomes → next goals |

Key ideas: a **shared knowledge layer** ("the new glue") connects goals, decisions, validation evidence, release history, production signals and agent logs; "memory needs a purpose" (test: does the agent do the job better with it than without?); **tackle each stage independently and in parallel**; "autonomy does not remove that structure" — even an unattended loop needs goals, implementation, evidence, release path, and learning.

### 3.2 Reference component list (synthesis)
Combining Microsoft, OpenAI, StrongDM, TrueFoundry:

1. **Intake** – issues, specs, tickets, telemetry as triggers.
2. **Spec/plan** – acceptance criteria written *before* implementation; plans as versioned artifacts.
3. **Context layer** – repo-local, versioned knowledge (docs, ADRs, schemas) as system of record.
4. **Agent harness** – orchestration, tools, permissions, sandboxes, model routing.
5. **Verification** – tests, linters/structural tests, security review, code review agent, scenario/holdout evals.
6. **Human gates** – plan approval, PR review/merge, release approval.
7. **Utilities** ("power & plumbing") – credentials, spend metering/budgets, telemetry/traces, policy. 🟢 TrueFoundry
8. **Feedback/learning** – outcomes → improved prompts/skills/docs/lints.

### 3.3 Diagram
See [`factory-architecture.md`](./factory-architecture.md).

---

## 4. How it's being done today — real examples

| Who | What | Key takeaways | Trust |
|---|---|---|---|
| **GitHub / Microsoft** | Copilot cloud agent takes an issue, spins up a secure Actions environment, changes code, runs validation, opens **draft PR for human review**; Copilot app + **Projects** (multi-repo parallel sessions), **automations** (trigger/schedule/event; learn from outcomes), code review (Lite/Balanced/Max), Fusion model routing | Humans own direction and merge; primitives exposed so you build your own factory | 🟢 [Universe blog](https://github.blog/news-insights/company-news/github-universe-2026-evolving-every-layer-of-the-stack/), 🟢 [Automations docs](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/about-automations) |
| **OpenAI "harness engineering"** | Internal product, ~1M LOC, ~1,500 PRs in 5 months, 0 manually-written code; 3→7 engineers | Env was underspecified, not the model; short `AGENTS.md` (~100 lines) as a *map*, `docs/` as system of record; custom lints with remediation messages; app bootable per worktree + observability exposed to agent; agent-to-agent review loops; minimal blocking merge gates because throughput ≫ human attention; "doc-gardening" agent | 🟢 [OpenAI](https://openai.com/index/harness-engineering/) |
| **StrongDM Software Factory** | Non-interactive dev: specs + scenarios drive agents; "code must not be written/reviewed by humans" | **Scenarios** stored outside the codebase as *holdouts* (agents can't game them); "satisfaction" (probabilistic) instead of "tests green"; **Digital Twin Universe** (behavioral clones of Okta/Jira/Slack/Google APIs) for high-volume testing; token spend as a metric | 🟢 [Simon Willison](https://simonwillison.net/2026/Feb/7/software-factory/) (quotes StrongDM's own [factory.strongdm.ai](https://factory.strongdm.ai)) |
| **Thoughtworks** | Enterprise platform (microservices, frontend, tests, IaC) built in ~4 weeks from natural-language requirements by one agent in an IDE | Agent behaviors that worked: read-before-write, minimal targeted changes, cross-file coherence, autonomous debugging; human provides intent and validates. Single case study (vendor-authored) | 🟢 [Thoughtworks blog](https://www.thoughtworks.com/insights/blog/generative-ai/from-specification-to-production-building-enterprise-software-with-agentic-ai) |
| **Anthropic** | Long-running agent harness: initializer agent + coding agent; state in `feature_list.json`, progress file, `init.sh`, git history; one feature per session; browser-automation E2E tests | Artifacts as handoff between context windows; structured feature list prevents premature "done" | 🟡 [Anthropic](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) (summarized via search, not fetched) |
| **Anthropic agent patterns** | Prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer; "prefer the simplest composable pattern" | Maps directly onto factory stations | 🟡 [Building effective agents](https://www.anthropic.com/research/building-effective-agents) |
| **Spotify, BCG, Factory.ai** | Spotify: >1,500 agent-generated PRs merged, 60–90% time savings on migrations; BCG: reported 3–5× | Figures are self-reported and heterogeneous, not benchmarks | 🟡 as cited by [TrueFoundry](https://www.truefoundry.com/blog/software-factory-agentic-enterprise-guide); original [Spotify](https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1), [Factory.ai](https://factory.ai/news/software-factory) not read |

---

## 5. Orchestration patterns, human gates, guardrails, metrics

### Orchestration
- **Orchestrator + workers** (coordinator session fans out to child sessions – exactly how Copilot *Projects* work) and **evaluator-optimizer** (implementer + independent reviewer loop) are the two most useful patterns. 🟡 Anthropic
- **Decompose by stage, not by monolith** (Microsoft). Keep contracts between stages explicit (artifacts).
- **Durable state outside the context window** (feature list, progress log, execution plans in repo). 🟡 Anthropic, 🟢 OpenAI
- **Automation groups** share context and propose self-improvements for human approval (GitHub). 🟢

### Human-in-the-loop gates (recommended placement)
1. **Intake/plan gate** – human approves spec + acceptance criteria (highest-leverage; "specification quality is the bottleneck").
2. **PR review/merge gate** – human merges; agents never self-merge (Universe skill rule: "Never merge, approve, or close anything").
3. **Release/deploy gate** – human approves production exposure.
4. **Exception gate** – ambiguity or failed loops escalate to a human rather than guess (Universe `issue-to-pr`: "If the fix is unclear, comment on the issue with your questions instead of guessing").
Throughput-heavy teams (OpenAI) relax gate 2 deliberately; this requires strong mechanical checks and cheap rollback.

### Guardrails
- **Least privilege**: select only needed tools; limit writes to the triggering issue; ignore events from users without write access; control whether Copilot-triggered events can re-trigger (loop prevention). 🟢 [GitHub docs](https://docs.github.com/en/copilot/how-tos/github-copilot-app/using-automations)
- **Cloud-automation visibility**: sessions/logs visible to everyone with repo read access — no secrets in prompts; automations only on private/internal repos. 🟢 GitHub docs
- **Personal vs shared** automations (identity and billing differ; can't change later). 🟢
- **Fork PRs are untrusted input**; never expose secrets to their code (Universe guide).
- **Mechanical enforcement** (lints, structural tests, dependency-direction rules) beats prose instructions. 🟢 OpenAI
- **Credential custody, budgets/spend limits, traces** as factory "utilities"; set AI-credit limits per automation. 🟢 TrueFoundry/GitHub docs
- **Maintainer controls** for agent-PR volume: limit open PRs for non-writers, archive PRs, participation boundaries (Universe Section 1).

### Evaluation & metrics
- Goal metric = **completed work** (merged, verified features/fixes), not lines of code (GitHub).
- Quality: review-bench style precision/recall for code review (Copilot review Max, ReviewBench F1) 🟢; **satisfaction rate** across scenarios (StrongDM) 🟢; escaped defects; rework/revert rate (suggested).
- Flow: PRs per engineer per day (OpenAI 3.5), cycle time issue→merge, human-review minutes per PR (the scarce resource), agent first-pass acceptance rate (suggested).
- Cost: tokens/AI credits per merged PR (StrongDM treats spend as a signal; Fusion advertises cost/time efficiency).
- Learning: does a skill/memory change improve outcomes vs. without? (Microsoft's "engineering test" for memory.)
- Caution: reported multipliers (3–5×, 60–90%) are self-reported; measure your own baseline.

---

## 6. Pitfalls

1. **Underspecified environment, not weak model** – when agents fail, ask "what capability/context is missing and how do I make it legible and enforceable?" 🟢 OpenAI
2. **Giant instruction files** – crowd out context, rot, unverifiable; use a short map + progressive disclosure. 🟢 OpenAI
3. **Agents grading their own homework** – agent-written tests can `assert true`; use independent/holdout validation. 🟢 Willison/StrongDM
4. **Transforming the whole SDLC at once** – can't see what works; improve stage by stage. 🟢 Microsoft
5. **Review bottleneck / PR flood** – more code → more PRs; need stacked small PRs, agent review, volume limits. 🟢 GitHub
6. **Context loss across sessions** – externalize state to files/git. 🟡 Anthropic
7. **Trigger loops** – automations reacting to Copilot's own events; use "Only people" trigger. 🟢 GitHub docs
8. **Knowledge outside the repo is invisible** (Slack, docs, heads). 🟢 OpenAI
9. **Accountability gap with unreviewed code** – the "dark factory" shifts audit/regulatory burden; see [Stanford CodeX commentary](https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/) 🟡 (not read).
10. **Hype/metrics inflation** – treat vendor numbers skeptically; case studies (Thoughtworks "zero human lines") are single-project and vendor-authored.
11. **Throwing away structure** – "autonomy does not remove" the need for goals/evidence/learning. 🟢 Microsoft
12. **Cost runaway** – no budgets per automation/session.

---

## 7. Lessons from the GitHub Universe project (`octodemo/virtual-universe-26`)

Local read-only checkout: `~/.copilot/repos/virtual-universe-26`. It is a **workshop** (cookbooks + a Copilot app extension), not a factory implementation, but it deliberately teaches the factory building blocks and shows how GitHub frames them. Its recap page says Section 2 is "Build your own software factory with skills, tools, security review, and automations", and highlights `/factory-creator` ("Turn a skill into a software factory that runs on a trigger").

### 7.1 What the project teaches (the factory "ladder")
| Step | Guide | Factory role |
|---|---|---|
| 1. Skill | `.github/skills/issue-to-pr/SKILL.md` | The **repeatable job**: read issue → branch → smallest change → run tests → draft PR that closes the issue |
| 2. Tools/connectors | Context7 MCP + custom agent via `/agentfinder` | **Fresh context** for the worker (current docs); "doesn't certify the PR is correct" |
| 3. Security review | `/security-review` agent (high-confidence only, >80%, skip style) and add as a step in the skill | An **independent quality gate** before PR |
| 4. Automation | Automations → New → trigger (manual first), select skill + project, prompt "oldest open issue with no linked PR… notify me when PR is ready" | **Trigger + scheduling**; "Manual" first, add schedule later |
| 5. Factory | `/factory-creator` turns the skill into a factory on a trigger (e.g., issue opened) | The factory itself; bound to the **app project**, not a Git remote; "Keep initial factory creation paused" |

Plus Section 1: **stacked PRs** (small layered PRs, easier review), **attach images/artifacts to issues**, **agentic workflows (gh-aw)** gallery with a safe "manual run first" outline, and **maintainer controls** for AI PR volume.

### 7.2 Concrete lessons / patterns observed
1. **Skill = unit of factory work; compose by editing it.** Progressive hardening: base skill → + docs lookup → + security review → + "How to test" in PR body → automate. Each addition is a small diff to one `SKILL.md`.
2. **Human gates are explicit in the skill text**: "Never merge, approve, or close anything. A person reviews the pull request"; draft PRs only; "obtain approval before committing, pushing…"; "Stage only the files you changed"; ask before commenting on the issue.
3. **Escalate instead of guess**: unclear fix → comment on the issue with questions.
4. **Target verification before write actions**: the instructions repeatedly require verifying the *fork/repo target* (`gh repo view --json nameWithOwner,parent`, `GH_REPO=…`, never push implicitly to `origin`, never file in the event repo). A factory must pin its blast radius.
5. **Start paused/manual, then schedule**: "Keep initial factory creation paused"; automation trigger = Manual first. Matches GitHub's guidance to understand a manual flow before PR-update triggers.
6. **Selection of the project ≠ git remote**: automation/factory binds to the app *project*; ensure that project contains the updated skill.
7. **Don't substitute silently**: "If the agent or connector isn't available, tell me; don't substitute web search"; "report unavailable tools instead of pretending a lookup succeeded." Honest failure reporting is a factory property.
8. **Privacy discipline with connectors**: send only public doc queries, not repo contents; "connector discovery is not installation or authorization"; never auto-install a search result.
9. **Treat untrusted input as untrusted**: fork PRs, no secrets exposed; check workflow permissions/auth before enabling gh-aw workflows; verify findings against code before acting ("verify any reported finding").
10. **`copilot-instructions.md` as session-level choreography** (≈7 KB): startup rules (open canvas, stop), "keep the current session," when to introduce a fork, approval checkpoints, synthetic examples only, no destructive cleanup. It encodes *when to ask for approval* more than coding style — a good model for factory-level policy. (Caution per OpenAI: keep such files short; push detail into skills/docs.)
11. **Skills are packageable**: `.github/plugin/plugin.json` (+ `marketplace.json`) bundles `universe-cheatsheet` as an installable plugin; skills must resolve their own asset path (`skill=<folder containing SKILL.md>`) so they work both in-repo and as a plugin.
12. **Extensions/canvases for the human surface**: `.github/extensions/*` (welcome canvas, badge simulator, cheatsheet artifact) provide UI for guided steps and artifacts — relevant for visualizing factory state to humans.
13. **Artifacts on issues** carry agent-generated evidence (images/files) back to the work item — a lightweight "evidence" channel for the Verify stage.
14. **Tests guard the instructions themselves** (`tests/universe-welcome.test.mjs` asserts instruction text such as "factory is bound to the app project") — instructions are treated as testable contract.
15. **Be honest about unverified content**: the recap page states "not yet a verified recap… details should be linked to published release notes, not inferred."

### 7.3 Factory-relevant notes on the other primitives (for the sibling session to reconcile)
- **Skill** → the repeatable station; description controls *when* it loads; body = steps + rules. 
- **Custom agent** (e.g., security-review, Context7 Expert) → a focused *role* with its own prompt/tools; good for independent reviewer stations.
- **MCP/connector** → access to external tools/info; keep scoped; automations can only use MCP tools configured by a repo admin.
- **Plugin** → distribution wrapper for skills (plugin.json).
- **Instructions** → always-on policy/approval rules; keep short.
- Microsoft: "the Copilot harness packages instructions, scripts, and supporting resources into reusable skills, [so] successful ways of working become reusable production assets." 🟢

---

## 8. Implications for our demo

1. **Posture: human-gated factory (autonomy level 2).** Agents implement and verify; humans approve spec and merge. Show the gates visibly.
2. **Pick a thin, end-to-end slice** rather than all stages: *issue (spec + acceptance criteria) → plan → implement (draft PR, tests) → independent review + security review → human merge → (optional) deploy/observe note*. Microsoft's advice: define input/jobs/output/success criteria per stage and improve stages independently.
3. **Build on the Universe ladder**: one `factory` skill (or small set: `spec`, `implement`, `review`) → add review/security stations → wrap in an **automation** (manual trigger first, then issue-opened trigger) → optionally `/factory-creator`. Keep initial creation paused.
4. **Use the coordinator/child-session model** (Copilot Projects/orchestrator) to demonstrate orchestrator-workers and evaluator-optimizer: implementer session vs. separate reviewer session.
5. **Make verification independent**: acceptance criteria/scenarios written at the spec stage (ideally not editable by the implementer, StrongDM-style holdout lite), plus tests, lints, `/security-review`, Copilot code review.
6. **Repo as system of record**: short `copilot-instructions.md`/`AGENTS.md` as a map; `docs/` for specs, plans, ADRs; plans as versioned artifacts; skills hold the procedures; mechanical checks (lint/CI) hold the rules.
7. **Guardrails to demo**: least-privilege tools, "only the triggering issue" write scope, "Only people" trigger (avoid loops), write-access requirement, private repo, no secrets in prompts, AI-credit limit, verify target repo before any write.
8. **Show metrics on a dashboard/artifact**: cycle time issue→merged PR, human review minutes, first-pass acceptance, defects found by review stage, tokens/credits per PR. Compare against a manual baseline; avoid unverified multipliers.
9. **Feedback loop**: after each run, a "retro" step proposes skill/instruction edits for human approval (mirrors automations that learn from outcomes).
10. **Stacked PRs** for larger features to keep human review cheap.
11. **Be explicit about what we don't claim**: no "dark factory"; vendor numbers are indicative only.

### Suggested open questions
- Which target app/repo is the demo factory producing? (needs a small but realistic codebase with tests)
- Local vs cloud automations (cloud requires private/internal repo + cloud agent enablement)?
- Deploy stage in scope or simulated?

---

## 9. Source list

Primary / high-trust (read):
- GitHub Blog, *GitHub Universe 2026: Evolving every layer of the stack* — https://github.blog/news-insights/company-news/github-universe-2026-evolving-every-layer-of-the-stack/
- GitHub Docs, *Copilot automations* — https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/about-automations
- GitHub Docs, *Using automations in the GitHub Copilot app* — https://docs.github.com/en/copilot/how-tos/github-copilot-app/using-automations
- Microsoft Command Line, *New agentic software delivery primitives* — https://commandline.microsoft.com/new-agentic-software-delivery-primitives/
- OpenAI, *Harness engineering* — https://openai.com/index/harness-engineering/
- Simon Willison, *How StrongDM's AI team build serious software without even looking at the code* — https://simonwillison.net/2026/Feb/7/software-factory/ (quotes https://factory.strongdm.ai)
- Thoughtworks, *From specification to production* — https://www.thoughtworks.com/insights/blog/generative-ai/from-specification-to-production-building-enterprise-software-with-agentic-ai
- TrueFoundry, *Software factory guide* (vendor; definition/history/utilities) — https://www.truefoundry.com/blog/software-factory-agentic-enterprise-guide

Secondary / not fully verified (surfaced by search; check before quoting):
- Anthropic, *Effective harnesses for long-running agents* — https://www.anthropic.com/research/effective-harnesses-for-long-running-agents
- Anthropic, *Building effective agents* — https://www.anthropic.com/research/building-effective-agents
- Factory.ai — https://factory.ai/news/software-factory ; BCG Platinion — https://www.bcgplatinion.com/insights/the-agentic-software-factory ; Spotify — https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1
- Dan Shapiro, *The five levels* — https://www.danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/
- Stanford CodeX — https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/
- Third-party Universe 2026 summaries (not authoritative): https://globalai.community/blog/github-universe-2026-day-1 , https://github.blog/changelog/2026-10-28-github-copilot-app-universe-releases/ (changelog not fetched)

Local: `/Users/matthew_hui/.copilot/repos/virtual-universe-26` (README.md, `.github/copilot-instructions.md`, `.github/skills/*`, `.github/plugin/*`, `02-github-copilot-latest-features/*`, `01-github-latest-features/*`).

_Note: `/factory-creator` is referenced in the Universe recap but its behavior is not documented in that repo; confirm in the Copilot app docs before relying on specifics._
