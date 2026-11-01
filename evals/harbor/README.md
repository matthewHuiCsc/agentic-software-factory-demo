# Harbor skill evaluation pilot

This is a single-task, advisory pilot, not a custom evaluation service. Harbor
owns the trial execution, container lifecycle, trajectories and rewards. The
repository owns the reviewed task, source fixture and deterministic acceptance
tests. Agent Skills `evals.json` and trigger queries remain versioned authoring
data; Harbor does not automatically execute those files.

## Run locally

Prerequisites: Docker with a working Linux-container daemon, Git, Bash and
[uv](https://docs.astral.sh/uv/getting-started/installation/) **0.13.5** on the
host. The launcher obtains Harbor **0.25.0** and managed Python **3.12.15**.
Task images pin Node **24.13.0** by multi-platform digest and pnpm **10.28.2**.
Harbor installs Copilot CLI **1.0.105** for model trials. Versions are explicit;
the container disables CLI auto-update with `COPILOT_AUTO_UPDATE=false`.
The model is deliberately not inherited from a chat or chosen by this pilot.

From the repository root:

```bash
# Builds disposable fixtures and runs six oracle controls. No model/token needed.
bash scripts/eval-skills.sh check

# Only after separately approving spend and the execution boundary:
# provide COPILOT_GITHUB_TOKEN securely in this process's environment.
bash scripts/eval-skills.sh run <native-copilot-model-catalog-name>
```

Do not put credentials in command arguments or committed files. The launcher
requires `COPILOT_GITHUB_TOKEN` for `run`, clears `GH_TOKEN`/`GITHUB_TOKEN` fallback
paths, and clears all three for `check`. It starts Harbor from a newly generated
directory, not a developer `.env` directory, and clears Copilot BYOK/provider
and effort overrides rather than inheriting them. A GitHub account token needs actual
Copilot entitlement and the authorization required by the installed CLI;
ordinary Actions `GITHUB_TOKEN` is **not** a Copilot credential. No secret is
provisioned by this repository.

Each invocation creates an ignored `harbor-workspace/<timestamp>-<pid>-<mode>/`.
It contains source-parity manifests, resolved job input, `harbor.log` and Harbor's
`jobs/<mode>/` results. It never edits the working checkout. Source is from
**tracked HEAD**, not uncommitted application changes; task definitions/glue are
read from the checkout. Commit/review both before a trusted model evaluation.
Keep failed-job diagnostics when investigating; delete only that invocation's
named directory when finished.

## Task, comparison and acceptance

The implementation task is the **gateway-only** slice of the existing
service-endpoint staff-history outcome case (`evals.json`, id `1`). Staging reads
that versioned prompt from the same source commit and prepends it to the task's
explicit implementation/scope adaptation; expected outputs stay outside the
agent image. Inventory already provides
`GET /stock/:id/adjustments`; the task adds its staff gateway allowlist entry.
It does not grade a plan, build a UI, query a real database or run Compose.

Both arms get the same tracked source, prompt, repository instructions, other
skills, fresh home, tools and explicit model. Candidate retains
`.github/skills/service-endpoint/`; baseline removes only that directory.
Repository-relative skill links stay in their original hierarchy. No personal
skills, developer-home mount, generic Harbor `--skill` injection, secret `.env`,
Git checkout credentials or Docker socket is supplied to the task container.
Eval answers, trigger labels, this pilot's oracle and independent acceptance
tests are excluded from the agent's source snapshot.

Harbor runs a **separate, fresh verifier container**. Only the declared
`packages/gateway-runtime/src/index.ts` artifact is carried over; agent changes
to dependencies, tests, build output and other source cannot rewrite the
verifier. Tests are uploaded after the agent phase. The verifier rebuilds the
locked packages and checks actual Fastify gateway behavior against a fictional
loopback Inventory fixture:

- Staff-only GET, correct owner/path, unchanged history and pagination.
- Invalid UUID rejection, preserved empty/400/404/503 bodies and status codes.
- Honest 502 on connection failure and continued POST adjustment behavior.

`check` uses Harbor's built-in **oracle**, not Copilot: good solutions must earn
`1` in both arms; missing-route and public-exposure controls must earn `0` in
both arms. Infrastructure exceptions and missing rewards fail the control run.
No LLM-as-judge, paid grading step or custom results platform is involved.
Reward measures this task's HTTP acceptance only, **not** triggering or overall
skill quality. A baseline may readily solve this small task; one pair is not
evidence of significant uplift. Model task failures remain advisory, while
infrastructure exceptions and missing/invalid rewards make the command fail
explicitly rather than reporting a successful measurement.

## Runtime evidence is a separate question

The `*-snapshot.json` manifests demonstrate **filesystem** source/skill parity,
not runtime discovery. Inspect Harbor's raw `copilot-cli.jsonl` and saved Copilot
session events under each trial's `agent/` directory. Its pinned adapter also
produces `trajectory.json`; prefer raw events because trajectory conversion may
omit inventory/invocation events. For example:

```bash
find harbor-workspace -type f \( -name 'copilot-cli.jsonl' -o -name 'events.jsonl' \)
# For each candidate/baseline stream, using jq if available:
jq -c 'select(.type == "session.skills_loaded" or .type == "skill.invoked"
  or .type == "system.message")' <path-to-one-jsonl-file>
```

Require actual inventory evidence that candidate has `service-endpoint` and
baseline does not, with other skills unchanged. Grade invocation only from an
observed `skill.invoked` event (name/source/trigger), not model prose. An empty
search, malformed stream or client version without those events means
**not measured**, not a successful negative or a trigger miss. Keep the
manifest's initial runtime `not measured` status until inspecting real evidence;
the HTTP reward does not override it. This pilot is an outcome task, not an
automated executor for the twenty description probes or the reviewer agent.

## Manual GitHub Actions and cost/permission boundary

[Skill evaluation pilot](../../.github/workflows/skill-evals.yml) has only
`workflow_dispatch`, runs only when dispatched on the repository default branch,
checks out the triggering SHA without persisted credentials, and gives GitHub
permissions only `contents: read`. It uses the same local command/task/pins,
first runs no-model controls, then one candidate/baseline pair with the explicit
`model` input and separately configured `COPILOT_GITHUB_TOKEN` secret. The token
is scoped to the metered step. It is never an ordinary pull-request CI job.

There is no schedule. A maintainer dispatch is a spend/permission decision.
Each model invocation has a five-minute agent timeout, a three-minute setup
limit and no retries; there are two model trials, serialized. The workflow has
a forty-minute overall timeout, one concurrency group and seven-day artifact
retention, including failure diagnostics. These bound time/concurrency, **not**
billable credits: Harbor/CLI do not supply a certified hard credit cap here.
Use an account with an appropriate externally enforced budget before dispatch.
Unknown token/cost data must not be reported as zero.

Harbor's v0.25.0 adapter runs Copilot with **`--yolo`** inside the task container.
The evaluated agent has broad shell/file permissions as a non-root `agent`
user. The verifier is fresh and token-free, but the evaluated process receives
the Copilot token: it is **not** proven inaccessible to agent shell code.
Containers use public networking for installation/inference; this pilot does
not certify egress restriction, hostile-code containment or token redaction.
Run only reviewed fictional fixtures on a dedicated/trusted Docker host.
Harbor controls its task resources; never substitute a live-demo Compose file
or mount developer homes, production data or the daemon socket into trials.

Artifacts can contain source, generated code, prompts and trajectories. Treat
them as sensitive diagnostics; review/redact before sharing and do not upload
raw logs to public services. Repository permissions do not constrain the
separately entitled Copilot account. Workflow pinning also does not freeze apt
repositories, transitive Harbor dependencies, its downloaded installer or a
server-side model revision; changes there require renewed calibration.

## What is and is not verified

Authoring validation passed: Harbor's six no-model controls (both good solutions
accepted; both missing-route and public-exposure solutions rejected for their
intended assertions), task/native-pair dry runs, separate-verifier execution,
source/skill parity and relative-resource checks, an install-only Copilot adapter
smoke in both images with token variables unset, actionlint 1.7.7, YAML/TOML/JSON
and shell/Python syntax checks, existing lint/typecheck and all 27 unit/API tests.
The install smoke did not submit a prompt or run a verifier; its displayed Harbor
mean is not a model result. The Actions workflow itself has not run.

No paid trial or scheduled execution is approved by adding this pilot.
Do not claim runtime inventory, invocation, real permissions, measured uplift,
cost, or real model results until a separately authorized run supplies evidence.
Model quality remains advisory; expand tasks/repeats and calibrate against human
review before considering a regression gate or a schedule.

## Primary references

- [Agent Skills evaluation guide](https://agentskills.io/skill-creation/evaluating-skills)
  and [description optimization](https://agentskills.io/skill-creation/optimizing-descriptions):
  cases, with/without sessions and trigger queries, not a standalone runner.
- [Harbor task format](https://docs.harborframework.com/tasks/overview) and
  [verifier](https://docs.harborframework.com/tasks/verifier): task environment,
  post-agent acceptance and numeric reward. Current docs can exceed the release.
- [Pinned Harbor Copilot adapter](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/agents/installed/copilot_cli.py):
  CLI installation/version, `--yolo`, JSONL/session capture and personal-path
  generic skill injection (deliberately unused here).
- [Pinned task config](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/models/task/config.py)
  and [job config](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/models/job/config.py):
  separate verifier/artifacts, timeout/concurrency/retry controls.
- [Harbor v0.25.0 package](https://github.com/harbor-framework/harbor/blob/v0.25.0/pyproject.toml):
  Apache-2.0, Python requirement and dependency ranges.
