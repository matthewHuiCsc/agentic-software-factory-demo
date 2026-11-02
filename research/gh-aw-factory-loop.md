# gh-aw: configuring an issue → human-merged-PR loop with the Copilot engine

_Research date: 2026-11-01. Scope: authoritative docs (`https://github.github.com/gh-aw/`) and source
(`github/gh-aw`, indexed commit `c0f5373763bac4939c9c909fa0a5dfcc34fe71c4`) for wiring an
issue-labeled trigger → Copilot engine (with a custom `architecture-reviewer` agent) → safe-output
draft PR / comments → human merge. Docs-research only; no workflow was run, no model/AI-credit spend
incurred, no secrets touched. `gh aw` CLI **v1.0.1** is installed locally in this repo's environment
and was used only for `--help`/`version` (no compile/run against real triggers)._

**Source-trust key:** 🟢 primary (official docs page or `github/gh-aw` source, fetched/read) · 🟡 secondary (web search synthesis; verify before quoting)

---

## 1. TL;DR

- gh-aw workflows are Markdown files with YAML frontmatter, compiled by `gh aw compile` into hardened
  `.lock.yml` GitHub Actions workflows. The agent never gets write permissions directly — it requests
  actions via **safe outputs**, a separate permission-scoped job executes only the declared, validated
  operations (e.g. `create-pull-request`). 🟢 [Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs/)
- An issue-labeled trigger is `on.issues.types: [labeled]` + `on.issues.names: [<label>]` (or the shorthand
  `on: issue labeled <label>`), combined with a **trusted-actor guard** `on.roles:` (exact-match allowlist,
  default `[admin, maintain, write]` — **confirmed from the compiler-generated rejection message**, see
  §2.2; `maintainer` was an incorrect spelling in an earlier draft of this note). 🟢
  [Triggers](https://github.github.com/gh-aw/reference/triggers/)
- Copilot is the default engine; for a **personal repository** (no org-billed Copilot), auth is a
  fine-grained PAT in the `COPILOT_GITHUB_TOKEN` secret, not `permissions.copilot-requests: write`
  (that's the org-billed path and it *ignores* `COPILOT_GITHUB_TOKEN` when both are set). 🟢 [Auth](https://github.github.com/gh-aw/reference/auth/)
- A custom reviewer persona (e.g. this repo's `architecture-reviewer`) is wired in via
  `engine.agent: architecture-reviewer` (Copilot-only native feature) pointing at
  `.github/agents/architecture-reviewer.agent.md`, **or** via `imports:` for use with any engine. 🟢 [Copilot engine ref](https://github.github.com/gh-aw/reference/engines/copilot/), 🟢 [Copilot Agent Files](https://github.github.com/gh-aw/reference/copilot-custom-agents/)
- The human-merge gate is structural, not a prompt instruction: `create-pull-request` is a safe output
  with **`draft: true` enforced as policy (default: true)** — the agent cannot open a non-draft PR or merge
  anything; a separate, experimental `merge-pull-request` safe output exists but is opt-in and policy-gated. 🟢 [Safe Outputs (PRs)](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/)
- Budget guards are real compiled fields, not advisory: top-level `max-turns` (default `500`), `max-ai-credits`
  (default `1000` AIC, $0.01/AIC), `timeout-minutes` (default `20`, whole agent job), and
  `on.cooldown` (rate-limit re-trigger). 🟢 [Engines](https://github.github.com/gh-aw/reference/engines/), 🟢 [Cost management](https://github.github.com/gh-aw/reference/cost-management/)
- **PRs/pushes authored with the default `GITHUB_TOKEN` do not trigger downstream CI** (`pull_request`/`push`
  workflows) — this is a hard GitHub Actions anti-recursion rule, not a gh-aw limitation, and gh-aw's only
  documented fixes require an *additional* credential (PAT, GitHub App, or an empty-commit push using one of
  those). There is no documented safe-outputs-only way around it. 🟢 [Triggering CI](https://github.github.com/gh-aw/reference/triggering-ci/)
- `gh aw compile`, `gh aw validate` (= compile + zizmor + actionlint + poutine, no file output), and
  `gh aw lint` (AST rules, actionlint on YAML only) are the authoritative local gates; all three were run
  with `--help` in this environment (v1.0.1) to confirm exact flags, see §7.

---

## 2. Issue-labeled trigger + trusted-actor guard

### 2.1 Exact trigger syntax

🟢 [Triggers reference](https://github.github.com/gh-aw/reference/triggers/) (`github/gh-aw:docs/src/content/docs/reference/triggers.md`)

```yaml
on:
  issues:
    types: [labeled]
    names: [architecture-review]   # only fires when this exact label is applied
  roles: [admin, maintain, write]  # trusted-actor guard — this is the DEFAULT, shown explicit
```

Shorthand form (compiles to the same thing, also adds `workflow_dispatch` automatically):

```yaml
on: issue labeled architecture-review
```

- `names:` filters `issues`/`pull_request`/`discussion` triggers by label; **the label is not removed**
  after the run (unlike `label_command:`, a related one-shot-command trigger that auto-removes the label —
  use that instead if you want "label = command, not persistent state").
- `label_command:` is the one-shot alternative: `on: label_command: deploy` fires on `issues`,
  `pull_request`, and `discussion` by default, auto-removes the label (`remove_label: true` default), and
  exposes the matched label as `needs.activation.outputs.label_command`. Prefer `names:` for a
  "state marker" label like `architecture-review`, `label_command:` for a "do this now" trigger.

### 2.2 Trusted-actor guard: `on.roles` / `on.skip-roles`

🟢 Same source as above.

- **`roles:` is an exact-match allowlist**, not a privilege floor: `roles: [write]` *rejects* admins and
  maintain-level users because `admin !== write`. To admit all typical contributors you must list every
  role: `[admin, maintain, write]` (this is also the **default**, applied automatically — "unsafe"
  triggers (`push`, `issues`, `pull_request`) enforce this check even if you don't write `roles:` at all).
- **Correction**: the accurate GitHub permission-level spelling is **`maintain`**, not `maintainer`. This
  matches GitHub's own repository permission levels (`read`, `triage`, `write`, `maintain`, `admin`) and
  is what the compiler actually generates/checks against — confirmed directly against the compiled
  rejection message (see citation below), which earlier draft text in this note misquoted as
  `"...admin, maintainer"`. Treat every other `maintainer` spelling in this document (e.g. in the §9
  sketch) as the same typo — the field value to write in frontmatter is `maintain`.
- Available values: `admin`, `maintain`, `write`, `triage`, `read`, `all` (⚠️ `all` disables the check —
  "use with caution").
- `skip-roles:` is the inverse: exempt your own team from a check that should only gate external
  contributors.
- Admission is a **live repository-permission-API check** at runtime (`checkActorPermission` /
  `queryActorRole`, cached 1h), not merely the webhook payload's `author_association`. 🟢
  `github/gh-aw:pkg/cli/mcp_permissions.go:1-67` (role query + `hasWriteAccess` helper),
  `github/gh-aw:actions/setup/js/check_permissions.test.cjs:104-116` (compiled rejection message uses
  `"User permission 'write' does not meet requirements: admin, maintain"`).
- Failed checks **cancel the workflow with a warning**; they do not silently no-op the agent step.
- This guard is explicitly *not* a content-safety boundary: "a trusted actor can label an
  attacker-controlled PR, and disabling checkout does not prevent an agent from reading malicious content
  with privileged capabilities" — treat label/payload-selected content as untrusted even from an
  authorized actor. 🟢 Triggers reference (fork-filtering section).

### 2.3 Issue locking (optional, useful for a review loop)

```yaml
on:
  issues:
    types: [labeled]
    names: [architecture-review]
    lock-for-agent: true
```

Locks the issue at workflow start, unlocks with `always()` after completion/safe-output processing —
prevents a second label/comment race while the reviewer agent is running. 🟢 Triggers reference.

---

## 3. Copilot engine + custom `architecture-reviewer` agent

### 3.1 Minimal engine block

```yaml
engine:
  id: copilot          # default; can be omitted entirely
  agent: architecture-reviewer   # .github/agents/architecture-reviewer.agent.md, extension omitted
```

🟢 [Copilot engine reference](https://github.github.com/gh-aw/reference/engines/copilot/): *"Use `agent`
to reference a custom agent file in `.github/agents/` (omit the `.agent.md` extension)."* **This is a
Copilot-only native feature** — the engine-feature-comparison table marks "Native `engine.agent`
selection" as `Yes` for Copilot and `No` for every other engine (Claude/Codex/Gemini/Pi/Agy). 🟢
[Engines reference](https://github.github.com/gh-aw/reference/engines/).

This repo already has `.github/agents/architecture-reviewer.agent.md` (frontmatter `name:
architecture-reviewer`, `tools: ['read', 'search']`, read-only review persona) — so `engine.agent:
architecture-reviewer` would load it as-is for a gh-aw Copilot workflow. Verified locally:
`architecture-reviewer.agent.md` (repo-local file, read directly; not a gh-aw doc).

### 3.2 Portable alternative: `imports:`

If you want the same persona usable with non-Copilot engines too, import the agent file as Markdown
instead of using `engine.agent`:

```yaml
engine: copilot      # or claude / codex — any engine accepts imported Markdown as prompt text
imports:
  - .github/agents/architecture-reviewer.agent.md
```

🟢 [Copilot Agent Files](https://github.github.com/gh-aw/reference/copilot-custom-agents/): *"Copilot
supports these files natively; other engines such as Claude and Codex receive the Markdown body as prompt
text."* Remote imports use `owner/repo/path@ref` and are cached by commit SHA under
`.github/aw/imports/`.

### 3.3 Capabilities/limitations specific to Copilot

🟢 [Copilot engine reference](https://github.github.com/gh-aw/reference/engines/copilot/):

- Supports `engine.agent`, custom harnesses, `max-continuations`, bare mode, per-command bash allowlists.
- **Compilation rejects** native `tools.web-search` and CLI-mode `tools.web-fetch` — use MCP instead (SDK
  mode gets a proxy-aware `web-fetch` tool).
- Default CLI pin is `1.0.103`; the compiler embeds this version + a reviewed SHA-256 checksum-manifest
  digest. `engine.version` overrides it; a custom pin also needs `engine.checksums-sha256` (64 lowercase
  hex chars from an independently trusted channel — fetching the checksum from the same origin as the
  binary "is not independent authentication").
- `engine.dynamic-workflows: true` + `args: ["--experimental"]` is required (and still experimental) for
  Copilot's native dynamic-workflow/extension feature; off by default.

---

## 4. Copilot auth: `COPILOT_GITHUB_TOKEN` for a personal repo

🟢 [Auth reference](https://github.github.com/gh-aw/reference/auth/)

Two inference-auth paths for Copilot, and **they are mutually exclusive in effect**:

| Path | When to use | Frontmatter/secret |
|---|---|---|
| `permissions.copilot-requests: write` | Org-billed Copilot, org/enterprise repos — **recommended when available** | `permissions: { contents: read, copilot-requests: write }`; uses the ephemeral Actions `${{ github.token }}`, no PAT, billed to the org's Copilot subscription |
| `COPILOT_GITHUB_TOKEN` | **Personal repos** or anywhere centralized org billing isn't available — this is the path for this demo | Repo secret holding a **fine-grained PAT** |

Key exact behavior: *"When `permissions: copilot-requests: write` is set in your workflow, `COPILOT_GITHUB_TOKEN`
is ignored for inference."* So for a personal repo with no `copilot-requests: write` permission granted,
set the secret:

```bash
gh aw secrets set COPILOT_GITHUB_TOKEN --value "<your-fine-grained-PAT>"
```

PAT creation requirements (verify **before** generating):
1. **Resource owner = your user account**, not an organization.
2. Permissions → Account permissions → **Copilot Requests: Read**.
3. GitHub Apps and OAuth tokens are **not supported** for this secret — must be a fine-grained PAT.
4. Runtime validates token shape: if `COPILOT_GITHUB_TOKEN` (or `GH_AW_GITHUB_TOKEN`) starts with the OAuth
   prefix `gho_`, activation **fails early** with guidance to swap in a fine-grained PAT.
5. The PAT owner's account needs an **active Copilot license**, or the inference step fails even with the
   secret correctly set.

A convenience pre-filled PAT-creation link is given in the docs (name/description/Copilot-Requests-Read
pre-filled): `https://github.com/settings/personal-access-tokens/new?name=COPILOT_GITHUB_TOKEN&description=GitHub+Agentic+Workflows+-+Copilot+engine+authentication&user_copilot_requests=read`.

Separate from inference auth: `GH_AW_GITHUB_TOKEN` is the optional fallback token for GitHub *operations*
(safe outputs writing cross-repo, triggering CI, `github-app.ignore-if-missing` fallback) — fallback chain
is `custom github-token → secrets.GH_AW_GITHUB_TOKEN → secrets.GITHUB_TOKEN`. It is a separate concern from
Copilot inference auth.

---

## 5. Safe outputs for the loop: comments, draft PR, review comments

Safe outputs are declared in a `safe-outputs:` frontmatter block. The agent calls an MCP-exposed tool
(e.g. `create_pull_request`); a **separate job with its own, minimal permissions** executes only the
declared, validated operation after the agent run ends. 🟢 [Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs/)

### 5.1 Defaults you get for free

If `safe-outputs:` is omitted entirely (or only contains the always-available system types `noop`,
`report-missing-tool`, `report-missing-data`), **`create-issue` is auto-enabled** with `max: 1` and
labels/title-prefix set to the workflow ID. Setting `create-issue: false` disables it explicitly while
leaving the system types active.

### 5.2 Issue comment (`add-comment:`)

Key from the output table: `add-comment` → max **1** by default (listed in "Labels, Assignments & Reviews").
Configure a higher cap and a specific target explicitly, e.g.:

```yaml
safe-outputs:
  add-comment:
    max: 3
    target: "triggering"   # or "*", or a specific issue/PR number
```

(Shape confirmed from the summary table and from `pkg/workflow/safe_outputs_max_test.go:114-144`, which
shows a compiled test fixture using `"add-comment": {"max": 3, "target": "*"}`.) 🟢
`github/gh-aw:pkg/workflow/safe_outputs_max_test.go:114-144`

### 5.3 Draft pull request (`create-pull-request:`)

🟢 [Safe Outputs — Pull Requests](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/)

```yaml
safe-outputs:
  create-pull-request:
    title-prefix: "[ai] "
    labels: [automation]
    reviewers: [user1, copilot]        # 'copilot' requests Copilot code review as a bot reviewer
    assignees: [user1]
    draft: true                        # enforced as policy; default true — the agent cannot un-draft itself
    max: 1                              # per-workflow-run quota shared by ALL agents/sub-agents, default 1
    if-no-changes: "warn"               # warn (default) | error | ignore
    base-branch: "main"                 # defaults to github.base_ref || github.ref_name
    fallback-as-issue: true             # default true: falls back to an issue if PR creation is blocked
    auto-close-issue: true              # default true: PR body gets "Fixes #N" back to the triggering issue
    max-patch-files: 100                 # default 100
    max-patch-size: 4096                 # KB, default 4096
    signed-commits: true                 # default true: signs via GraphQL API rather than raw git push
```

Important exact facts:
- **`draft: true` is "enforced as policy"** — i.e. this is not merely a default the agent can override; it's
  the structural human-merge gate for this safe output.
- `max` here is a **per-workflow-run quota shared across all agents/sub-agents**, not per-agent — raise it
  deliberately for parallel/stacked-PR patterns.
- Falls back to opening an **issue** instead of a PR if PR creation is blocked by org/repo settings (e.g.
  forks disallowed, PR limits) — set `fallback-as-issue: false` to disable that fallback and fail loudly
  instead.
- Stacked PRs are supported (`max > 1`, `base`/`stack_position`/`stack_root`/`dependencies` fields per
  output item) but `stacked: false` should be set explicitly on GitHub Enterprise Server where the feature
  may be unavailable.

### 5.4 Review comments on code lines (`create-pull-request-review-comment:`)

From the output table: max **10**. (Full dedicated field reference lives at the same Pull-Requests safe-
outputs page, anchor `#pr-review-comments-create-pull-request-review-comment`; the table entry is
authoritative for the cap.) Related: `reply-to-pull-request-review-comment` (max 10),
`resolve-pull-request-review-thread` (max 10), `submit-pull-request-review`.

### 5.5 Full max-count reference table (from the docs summary tables)

🟢 [Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs/) and
[Safe Outputs (PRs)](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/):

| Safe output | Default max |
|---|---|
| `create-issue` | 1 (auto-enabled when nothing else is configured) |
| `add-comment` | 1 |
| `hide-comment` | 5 |
| `add-labels` | 5 calls (×10 labels/call via `max-labels`) |
| `remove-labels` | 3 |
| `create-pull-request` | 1 (configurable; shared per-run quota) |
| `update-pull-request` | 1 |
| `close-pull-request` | 10 |
| `create-pull-request-review-comment` | 10 |
| `reply-to-pull-request-review-comment` | 10 |
| `resolve-pull-request-review-thread` | 10 |
| `add-reviewer` | 3 |
| `push-to-pull-request-branch` | 1 (configurable) |
| `merge-pull-request` | 1 (**experimental**) |
| `approve-workflow-run` | 1 |
| `create-check-run` | 1 (default) |
| `noop` / `report-missing-tool` / `report-missing-data` | unlimited (same-repo only) |

Enforcement is at two points: the MCP tool-call boundary (agent-visible rejection) and apply time in the
safe-outputs job — see `github/gh-aw:pkg/workflow/safe_outputs_max_validation.go:191-216` for the Go
validator that checks every configured `*.Max` field, and
`github/gh-aw:actions/setup/js/comment_limit_helpers.cjs:1-30` for the comment-specific constants
(`MAX_COMMENT_LENGTH = 65536`, `MAX_MENTIONS = 10`, `MAX_LINKS = 50`) shared between the MCP tool schema and
the executing processor so both layers agree.

### 5.6 Preview everything before it writes (`staged: true`)

🟢 [Staged Mode](https://github.github.com/gh-aw/gh-aw) doc (`reference/staged-mode/`) and
`reference/safe-outputs/` §"Staged Mode":

```yaml
safe-outputs:
  staged: true          # global: every safe output becomes a 🎭 preview in the Actions step summary
  create-pull-request:
    staged: true        # or scope it to just one output type, leaving others live
  add-comment:           # (executes normally if staged isn't also set here)
```

Staged handlers can still *read* target data to validate `required-labels`/`required-title-prefix` filters
(read-only permissions are granted even for GitHub App tokens) but **every write is skipped**. Recommended
first run for a new issue→PR loop before trusting it unattended.

---

## 6. Budget, turn, and time limits

🟢 [Engines reference](https://github.github.com/gh-aw/reference/engines/) and
[Cost management](https://github.github.com/gh-aw/reference/cost-management/)

| Setting | Default | Scope | Notes |
|---|---|---|---|
| `max-turns` (top-level, **not** `engine.max-turns`) | `500` | AWF invocation cap | Legacy alias `max-runs`. Supported by **all** engines including Copilot per the engine-feature table (⚠️ a scratchpad dev note in the repo claims Copilot doesn't support it — the published reference page is more current/authoritative and lists Copilot = `Yes`; verify against your installed CLI version if this matters). `engine.max-turns` is a **deprecated Claude-only** iteration limit — don't use it for Copilot. |
| `max-ai-credits` (top-level) | `1000` AIC | Whole run | 1 AIC = $0.01. Stops a runaway run. |
| `max-daily-ai-credits` | `5000` AIC | 24h, per workflow | Over budget ⇒ the agent is **skipped** (not failed). |
| `timeout-minutes` | `20` | Entire agent job | Standard GitHub Actions job timeout. |
| `engine.max-continuations` | unset | Copilot-only autopilot continuation budget | Copilot-specific; no equivalent on other engines. |
| `on.cooldown` | — | Minimum spacing between agent-job runs | e.g. `cooldown: 4h` on an hourly schedule so the *agent* only actually runs every 4h even though the check runs hourly. Go duration syntax, minimum 5m, GitHub Actions expressions not supported. Cooldown starts when the previous run's `agent` job **finished** (success or failure); a run where `agent` was *skipped* doesn't reset it. |

Monitoring: `gh aw logs` (per-run duration/tokens/AIC/turns table; `--json` for scripting), `gh aw audit
<run-id>` (single-run deep dive: tokens, tool calls, AIC, estimated cost). Each `.runs[]` JSON record
includes `aic`; `.episodes[]` aggregates correlated runs when `context.episode_id` propagates (orchestrator
→ worker chains). 🟢 Cost management reference.

---

## 7. Security model and the CI-triggering limitation

### 7.1 The six layers (compile-time → runtime)

🟢 [Architecture](https://github.github.com/gh-aw/introduction/architecture/) and the marketing site's
["Six layers of defence"](https://github.github.com/gh-aw/) summary:

1. **Compile-time validation** — schema validation, expression allowlisting, pinned actions, all "checked
   before a workflow can ever run."
2. **Sandboxed agent** — read-only by default; Docker container isolation by default, optional
   Cloud-Hypervisor microVM for stronger isolation on eligible GitHub-hosted runners.
3. **Credential isolation** — an API proxy holds model-inference tokens; "the agent never sees them and
   cannot leak them."
4. **Integrity filtering** — untrusted GitHub content (issue/PR bodies, comments) is sanitized before the
   agent sees it.
5. **Threat detection** — a separate job AI-scans proposed safe-output artifacts and blocks suspicious ones
   before they're applied.
6. **Safe outputs** — "only the writes you declared are applied, by a separate job with its own
   permissions" (this is the mechanism in §5 above).

The architecture page's own three-tier trust model is worth internalizing for review:
- **Layer 1 (substrate)**: runner/container/kernel/firewall/API-proxy/MCP-gateway — trusted even against a
  fully compromised user-level component.
- **Layer 2 (configuration)**: Action steps, firewall policy, MCP server configs, and *tokens as imported
  capabilities* — "authored pre-activation, setup/post-steps, custom jobs, detection steps, and
  safe-output steps/actions are trusted executable code, not automatically confined to the agent sandbox."
  Explicit warning: `strict: false`, broader roles/bot admission, disabled sandbox/firewall/detection are
  all "changes to the trust model," not mere warnings to acknowledge.
- **Layer 3 (plan)**: the compiler-generated stage plan — SafeOutputs is the concrete instantiation;
  buffered artifacts pass through configured filters (structural limits, policy, sanitization) before
  externalization.

### 7.2 Why a Copilot-created draft PR won't auto-run your CI — and the zero-secret fix that was actually implemented

🟢 [Triggering CI](https://github.github.com/gh-aw/reference/triggering-ci/)

> "By default, pull requests created using the default `GITHUB_TOKEN` in GitHub Actions **do not trigger
> CI workflow runs**. This is a GitHub Actions feature to prevent event cascades."

This applies to both `create-pull-request` and `push-to-pull-request-branch` safe outputs. The precise
platform rule, straight from GitHub's own docs (🟢 [Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)),
is narrower than "GITHUB_TOKEN PRs never trigger CI":

> "When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the `GITHUB_TOKEN`
> will not create a new workflow run, with the following exceptions: `workflow_dispatch` and
> `repository_dispatch` events **always** create workflow runs. `pull_request` events with the `opened`,
> `synchronize`, or `reopened` activity types... create workflow runs in an **approval-required** state...
> Other `pull_request` activity types (such as `labeled`, `edited`, or `closed`) do not create workflow
> runs."

The restriction is keyed to **who/what performed the triggering action**, not to the PR's provenance.
gh-aw's docs separately offer three *credentialed* fixes for the `opened`/`synchronize` case specifically
(unchanged from the original research pass, kept below for completeness), but **the implemented, zero-secret
path for this project sidesteps the restriction entirely** by moving the triggering action to a human:

1. **PAT-based trigger token** (credentialed): `safe-outputs.create-pull-request.github-token-for-extra-empty-commit: ${{ secrets.MY_CI_TRIGGER_PAT }}`.
2. **GitHub App** (credentialed): `github-token-for-extra-empty-commit: app`.
3. **Magic secret** `GH_AW_CI_TRIGGER_TOKEN` (credentialed): same PAT, reserved name; set to `"none"` to
   drop the reference from the compiled lock file.
4. **Full token override** (credentialed, broadest trust): `github-token: ${{ secrets.CI_USER_PAT }}`.

**Implemented alternative — no extra PAT/App write secret required:**
- The agentic workflow still opens the PR as a **draft** (policy-enforced default), authored by
  `GITHUB_TOKEN` — CI correctly does *not* auto-run on `opened`/`synchronize` from that bot identity (or,
  per the GitHub text above, it may appear in an approval-required state that nobody needs to act on).
- A **human** reviewer marks the PR **"Ready for review"** in the GitHub UI. This is a `pull_request`
  event with activity type `ready_for_review` performed under the **human's own account**, not
  `GITHUB_TOKEN` — it is not "an event triggered by the GITHUB_TOKEN" at all, so none of the anti-recursion
  exceptions/approval-gating above apply to it; it is a completely ordinary, unrestricted trigger.
  Configure CI/CodeQL with `on.pull_request.types: [..., ready_for_review]` so this human action is what
  actually fires the checks.
- As a **fallback** for workflows that don't key off `ready_for_review` (or need a manual re-run), the
  human can manually dispatch the CI workflow against the PR's branch via `workflow_dispatch` in the
  Actions UI (`gh workflow run ci.yml --ref <branch>` or the "Run workflow" button) — per the GitHub quote
  above, `workflow_dispatch` **always** creates a workflow run regardless of token identity, so this
  requires no additional credential either; it's a deliberate manual human action, not an automated
  `GITHUB_TOKEN` dispatch.

This means **running verification inside the agentic workflow (left of the safe-output boundary) is a
useful *defense-in-depth* belt-and-suspenders step, but it is not the only compliant, zero-secret option**,
as an earlier draft of this note implied. The `ready_for_review`-gated CI/CodeQL trigger plus a manual
`workflow_dispatch` fallback is the implemented, zero-extra-secret design, and it also doubles as the
human-merge gate itself: the same UI action ("mark ready for review") that fires real CI is the
reviewer's explicit signal that the draft is worth taking seriously.

Two notes on scope here: (a) I have not re-verified the exact `ready_for_review` approval-state behavior
against gh-aw's own docs — the quoted mechanism is standard GitHub Actions behavior (🟢 primary GitHub
docs), not a gh-aw-specific feature, so gh-aw's `reference/triggering-ci/` page does not mention it as a
fix and nothing here contradicts that page, it simply describes a different, human-mediated trigger path
that the page doesn't need to cover; (b) the previously-noted community workaround of closing/reopening a
PR as a human (`pull_request: reopened`) remains valid for the same reason (human-performed action, not
GITHUB_TOKEN) but is superseded by the cleaner `ready_for_review` design above for this project.

### 7.3 Compiler-level checks you get even without extra config

🟢 Architecture page component-overview diagram + [Compilation Commands](https://github.github.com/gh-aw/reference/compilation-process/) table (confirmed live via local CLI, see §8):
`SCAN["Security Scanners (actionlint, zizmor, poutine)"]` runs at compile/validate time;
`PRE["Pre-Activation Role & Permission Checks"]` and `ACT["Activation Content Sanitization"]` run at
workflow-start time, before the agent step.

---

## 8. CLI: init / compile / validate / lint / actionlint

All output below was captured **live from this repo's installed `gh aw` CLI v1.0.1** (`gh aw version` →
`v1.0.1`) via `--help`; this is authoritative for the installed version and matches the published docs.
🟢 local CLI output + 🟢 [CLI reference](https://github.github.com/gh-aw/setup/cli/) and
[Compilation Commands](https://github.github.com/gh-aw/reference/compilation-process/) for cross-check.

### `gh aw init`
Non-interactive repo setup (no engine/secret prompts): configures `.gitattributes` to mark `.lock.yml` as
generated, creates the dispatcher skill at `.github/skills/agentic-workflows/SKILL.md`, configures VS Code
settings. With `--engine copilot` (default engine): also creates `.github/agents/agentic-workflows.md`
custom agent, `.github/workflows/copilot-setup-steps.yml` (gh-aw install steps), and `.github/mcp.json`
(gh-aw MCP server config) — unless `--no-mcp`/`--no-skill`/`--no-agent` suppress those pieces respectively.
This repo has **not** run `gh aw init` — none of those generated files are present yet.

### `gh aw compile`
```bash
gh aw compile                          # compile all .github/workflows/*.md
gh aw compile <workflow-id>            # compile one (basename without .md)
gh aw compile --dry-run                # stage + mandatory validation/shellcheck/model checks;
                                        #   rejects existing/added actionable scanner findings
gh aw compile --actionlint --zizmor --poutine   # run security scanners explicitly
gh aw compile --strict                 # enhanced security validation (see below)
gh aw compile --no-emit                # validate only, no file output
gh aw compile --purge                  # remove orphaned .lock.yml files
```
`--strict` / strict-by-default: workflows default to strict mode unless frontmatter sets `strict: false`
— strict mode "enforces action pinning, network config, safe-outputs, disallows write permissions and
deprecated fields" (from `gh aw validate --help`, flag description, confirmed locally).

### `gh aw validate`
Exactly `gh aw compile --validate --no-emit --zizmor --actionlint --poutine` (confirmed from both the
docs and the local `--help` text verbatim). Useful flags captured live:
```
--allow-action-refs   Allow unresolved action refs (warn instead of fail)
--fail-fast           Stop at first validation error
--json                Structured output
--strict              Force strict mode for all workflows regardless of frontmatter
--validate-images     Require Docker for container-image validation (otherwise silently skipped)
```

### `gh aw lint`
AST-rule linter over `.md`/`.yml`/`.yaml` — **never recompiles**; Markdown is linted as-authored (imports
not resolved), lock files get a full Actions AST. Actionlint runs only against YAML files from this
command; zizmor/poutine are **not** run by `lint` (only by `compile`/`validate`). Confirmed live:
```
gh aw lint                               # lint default directory
gh aw lint .github/workflows/foo.lock.yml
gh aw lint .github/workflows/foo.md       # lint authored AW AST without compiling
gh aw lint --list-rules                   # list built-in AST rules
gh aw lint --rules secret-leak --json     # run just the built-in taint checker
gh aw lint --shellcheck --pyflakes        # opt-in to those actionlint integrations (off by default)
```

### actionlint integration specifically
`gh aw compile --actionlint` runs actionlint via Docker against the compiled lock file (see the repo's own
`Makefile:953-975` — `validate-workflows`/`actionlint` targets both resolve to `./gh-aw compile
--actionlint`) 🟢 `github/gh-aw:Makefile:953-975`. The CI self-check job in gh-aw's own repo runs the
combined gate as `compile --validate --no-emit --zizmor --actionlint --poutine --verbose` and files an
issue on any finding 🟢 `github/gh-aw:actions/setup/js/run_validate_workflows.cjs:36-59`.

**Correction from implementation**: do not run a stock/standalone `actionlint` binary against gh-aw's
*generated* `.lock.yml` files as an additional CI gate. Local testing in this project found that a
stock `actionlint` v1.7.12 install fails on the compiler-generated lock file's `job.workflow_ref` and
`concurrency.queue` fields, while `gh aw compile --actionlint` (which runs gh-aw's own bundled actionlint,
also labeled v1.7.12 but carrying gh-aw-specific schema patches/extensions for those generated fields)
accepts the same file cleanly. The two "v1.7.12"s are not identical binaries. Scope stock actionlint to
the **authored** CI/CodeQL workflow YAML only (the hand-written `ci.yml`/`codeql.yml`, not any `.lock.yml`);
rely exclusively on gh-aw's own bundled actionlint (via `gh aw compile --actionlint` / `gh aw validate`)
for the compiled agentic workflow files.

Recommended local gate sequence for this project, mirroring gh-aw's own CI:
```bash
gh aw compile --no-emit                 # fast syntax/schema check
gh aw validate --strict                 # full compile + zizmor + actionlint + poutine, strict mode
gh aw lint --list-rules                 # sanity-check which AST rules are active
```

---

## 9. End-to-end sketch (annotated, not yet run)

This stitches together §2–§6 into one workflow shape. Every field below is cited above; nothing here is
speculative syntax.

```yaml
---
on:
  issues:
    types: [labeled]
    names: [architecture-review]
  roles: [admin, maintain, write]   # trusted-actor guard (this IS the default; shown explicitly)

permissions:
  contents: read
  # copilot-requests: write   # omit for a personal repo — use COPILOT_GITHUB_TOKEN secret instead

engine:
  id: copilot
  agent: architecture-reviewer        # .github/agents/architecture-reviewer.agent.md

max-turns: 60            # tighten the 500 default for a scoped review task
max-ai-credits: 150       # tighten the 1000 default
timeout-minutes: 15       # tighten the 20 default

safe-outputs:
  staged: true            # first-run preview; flip to false once trusted
  add-comment:
    max: 1
    target: "triggering"
  create-pull-request:
    title-prefix: "[architecture-review] "
    draft: true           # policy-enforced regardless
    max: 1
    fallback-as-issue: true
---

Review the triggering issue's referenced change for the architecture concerns in
`.github/agents/architecture-reviewer.agent.md`. Comment findings on the issue. If a
corrective patch is small and safe, open a draft pull request; never merge or approve
anything — a human reviews and merges.
```

Before any real run: `gh aw compile <name> --no-emit`, then `gh aw validate <name> --strict`, then (only
once satisfied) compile for real and keep `safe-outputs.staged: true` for the first live trigger.

---

## 10. Caveats, gaps, and things to verify before relying on them

1. **`max-turns` + Copilot conflicting signals**: the published [Engines](https://github.github.com/gh-aw/reference/engines/)
   feature table lists Copilot = `Yes` for top-level `max-turns`, but an in-repo scratchpad note
   (`github/gh-aw:scratchpad/token-budget-guidelines.md:20-49`, **not** a published docs page) says
   *"`max-turns` is only supported by Claude and Custom engines, not Copilot."* Scratchpad files are
   internal dev notes, not the published reference, so the reference page should be treated as current —
   but verify empirically against the exact CLI/compiler version before depending on this for a budget
   guardrail; prefer `max-ai-credits` + `timeout-minutes` as the primary stop for Copilot regardless.
2. **`merge-pull-request` safe output exists but is explicitly experimental** and policy-gated; it was out
   of scope here by design (the loop in this task stops at a human-merged draft PR) — do not wire it in
   without separately re-reading its policy-gate documentation.
3. **CI-auto-trigger: resolved** (§7.2, corrected) — gh-aw's own `github-token-for-extra-empty-commit`
   knobs all require an extra credential, but the platform-level fact that `workflow_dispatch` always
   creates a run and that human-performed `pull_request` activity types (e.g. `ready_for_review`) are not
   "events triggered by GITHUB_TOKEN" gives a genuine zero-extra-secret design: gate CI/CodeQL on
   `ready_for_review` (fired when a human marks the draft PR ready) with manual `workflow_dispatch` as a
   fallback. This is standard GitHub Actions behavior, not a gh-aw feature, which is why `reference/triggering-ci/`
   doesn't mention it. Treat "verify inside the agentic workflow before the PR exists" as optional
   defense-in-depth, not the only compliant option.
4. **`gh aw init` was not run in this repo** — none of its generated artifacts (`.github/skills/agentic-workflows/SKILL.md`,
   `.github/workflows/copilot-setup-steps.yml`, `.github/mcp.json`, `.github/agents/agentic-workflows.md`)
   exist yet; running it is a prerequisite the parent agent should do deliberately (it can create a PR via
   `--create-pull-request`), not assume already present.
5. **`on.roles` default is implicit** — if you don't write `roles:` at all, gh-aw still enforces
   `[admin, maintain, write]` for "unsafe" triggers including `issues`; writing it explicitly (as in §9)
   is for clarity/auditability, not because it changes behavior from the unwritten default.
6. **`reference/roles/` does not exist** as a standalone docs page (404) — role-filtering documentation
   lives inside `reference/triggers/` and `reference/glossary/`, not a dedicated page; don't link to a
   `/reference/roles/` URL.
7. Not independently re-verified in this pass: the exact MCP tool JSON schema for `create_pull_request`
   (field names/types) and the full `create-pull-request-review-comment` configuration block (only the
   max-count and the general PR-safe-outputs pattern were directly read); fetch
   `reference/safe-outputs-pull-requests/` anchors `#pr-review-comments-create-pull-request-review-comment`
   and `#merge-pull-request-merge-pull-request` directly before implementing those specific fields.
8. Threat-detection and the AWF (Agent Workflow Firewall)/network-allowlist configuration were read only at
   the architecture-overview level (§7.1); implementing `network.allowed` domain rules or
   `safe-outputs.threat-detection.engine` overrides needs a direct read of
   `reference/threat-detection/` and `reference/network/` before use.

---

## 11. Source list

Primary (read directly, this session):
- Marketing/overview — https://github.github.com/gh-aw/
- Security architecture — https://github.github.com/gh-aw/introduction/architecture/
- Triggers — https://github.github.com/gh-aw/reference/triggers/
- Frontmatter overview — https://github.github.com/gh-aw/reference/frontmatter/
- Auth — https://github.github.com/gh-aw/reference/auth/
- Engines (shared) — https://github.github.com/gh-aw/reference/engines/
- Copilot engine — https://github.github.com/gh-aw/reference/engines/copilot/
- Copilot Agent Files (custom agents) — https://github.github.com/gh-aw/reference/copilot-custom-agents/
- Safe Outputs — https://github.github.com/gh-aw/reference/safe-outputs/
- Safe Outputs (Pull Requests) — https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/
- Staged Mode (referenced section inside Safe Outputs; dedicated page `reference/staged-mode/`)
- Cost management — https://github.github.com/gh-aw/reference/cost-management/
- Triggering CI — https://github.github.com/gh-aw/reference/triggering-ci/
- GitHub Actions — Triggering a workflow from a workflow (primary source for the `workflow_dispatch`/
  `ready_for_review` exceptions in §7.2) — https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- CLI reference — https://github.github.com/gh-aw/setup/cli/
- Compilation process / commands table — https://github.github.com/gh-aw/reference/compilation-process/
- Glossary — https://github.github.com/gh-aw/reference/glossary/
- `github/gh-aw` source (via code search, indexed commit `c0f5373763bac4939c9c909fa0a5dfcc34fe71c4`):
  `pkg/workflow/safe_outputs_max_validation.go`, `pkg/workflow/safe_outputs_max_test.go`,
  `pkg/workflow/engine.go`, `pkg/workflow/engine_helpers.go`, `pkg/workflow/compiler_webhook_triggers.go`,
  `pkg/cli/mcp_permissions.go`, `actions/setup/js/comment_limit_helpers.cjs`,
  `actions/setup/js/check_permissions.test.cjs`, `actions/setup/js/run_validate_workflows.cjs`, `Makefile`,
  `docs/src/content/docs/reference/engines.md`, `docs/src/content/docs/reference/safe-outputs.md`,
  `docs/src/content/docs/reference/staged-mode.md`, `docs/src/content/docs/reference/compilation-process.md`.
- Local, repo-resident (not a gh-aw doc, read directly): `.github/agents/architecture-reviewer.agent.md`.
- Local CLI output (not a doc page; captured live this session): `gh aw version` → `v1.0.1`;
  `gh aw init --help`, `gh aw compile --help`, `gh aw validate --help`, `gh aw lint --help`.

Secondary / not fully verified:
- 🟡 General GitHub Actions community knowledge that a bot-authored (`GITHUB_TOKEN`) PR doesn't trigger
  `pull_request` workflows and that a human closing/reopening a PR does (web search synthesis in §7.2,
  cross-checked against GitHub Community Discussions and dev.to explainer, not GitHub's own docs page on
  this specific point — GitHub's own "Triggering a workflow" doc covers the general anti-recursion rule but
  wasn't fetched directly this session).
- 🟡 `github/gh-aw:scratchpad/token-budget-guidelines.md` and `scratchpad/engine-architecture-review.md` —
  internal dev scratch notes, not published docs; used only to flag the `max-turns`/Copilot discrepancy in
  §10, not as a primary citation for behavior.
