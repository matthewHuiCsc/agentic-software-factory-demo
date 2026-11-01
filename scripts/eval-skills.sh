#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source evals/harbor/pins.env

mode="${1:-check}"
if [[ "$mode" != check && "$mode" != run ]]; then
  echo 'Usage: bash scripts/eval-skills.sh check | run <explicit-copilot-model>' >&2
  exit 2
fi
if [[ "$mode" == run ]]; then
  if [[ $# -ne 2 ]]; then
    echo 'run requires exactly one explicit model argument.' >&2
    exit 2
  fi
  model="${2:-}"
  if [[ ! "$model" =~ ^[a-z0-9][a-z0-9.-]+$ ]]; then
    echo 'Supply an explicit native Copilot model catalog name (no provider/BYOK route).' >&2
    exit 2
  fi
  if [[ -z "${COPILOT_GITHUB_TOKEN:-}" ]]; then
    echo 'COPILOT_GITHUB_TOKEN with Copilot entitlement is required; no credential fallback.' >&2
    exit 2
  fi
elif [[ $# -gt 1 ]]; then
  echo 'check accepts no model; it runs only oracle controls.' >&2
  exit 2
fi
command -v uv >/dev/null || { echo 'Install uv 0.13.5; see evals/harbor/README.md.' >&2; exit 1; }
docker version --format '{{.Server.Version}}' >/dev/null
output="$PWD/harbor-workspace/$(date -u +%Y%m%dT%H%M%SZ)-$$-$mode"
mkdir -p harbor-workspace

# Do not read a developer .env file or allow Harbor's GitHub-token fallbacks.
unset GH_TOKEN GITHUB_TOKEN
unset COPILOT_PROVIDER_API_KEY COPILOT_PROVIDER_BEARER_TOKEN COPILOT_PROVIDER_BASE_URL
unset COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_WIRE_API COPILOT_API_URL COPILOT_CLI_EFFORT
if [[ "$mode" == check ]]; then unset COPILOT_GITHUB_TOKEN; fi
uv tool run --python "$HARBOR_PYTHON" --from "harbor==$HARBOR_VERSION" \
  python evals/harbor/prepare.py "$output" "$mode" "${model:-}"
(
  cd "$output"
  uv tool run --python "$HARBOR_PYTHON" --from "harbor==$HARBOR_VERSION" \
    harbor run --config job.json --dry-run --skip-credential-checks
  uv tool run --python "$HARBOR_PYTHON" --from "harbor==$HARBOR_VERSION" \
    harbor run --config job.json --yes
) 2>&1 | tee "$output/harbor.log"
uv tool run --python "$HARBOR_PYTHON" --from "harbor==$HARBOR_VERSION" python - "$output" "$mode" <<'PY'
import json
import sys
from pathlib import Path
mode = sys.argv[2]
paths = list((Path(sys.argv[1]) / f"jobs/{mode}").glob("*/result.json"))
count = 6 if mode == "check" else 2
if len(paths) != count:
    raise SystemExit(f"Expected {count} trial results, got {len(paths)}")
for path in paths:
    result = json.loads(path.read_text())
    if result.get("exception_info"):
        raise SystemExit(f"Trial infrastructure failed: {result['exception_info']}")
    actual = (result.get("verifier_result") or {}).get("rewards")
    if actual not in ({"reward": 0}, {"reward": 1}):
        raise SystemExit(f"Missing/invalid acceptance reward: {result['task_name']}: {actual}")
    if mode == "run":
        print(f"{result['task_name']}: advisory HTTP acceptance {actual['reward']}; "
              "runtime inventory/invocation not measured by this verifier")
        continue
    expected = 1 if result["task_name"].startswith("good-") else 0
    if actual != {"reward": expected}:
        raise SystemExit(f"Unexpected {result['task_name']} control reward: {actual}")
    reason = (
        "staff history is forwarded" if result["task_name"].startswith("missing-")
        else "customer must not expose history"
    )
    if expected == 0 and reason not in (path.parent / "verifier/acceptance.log").read_text():
        raise SystemExit(f"Control failed for the wrong reason: {result['task_name']}")
if mode == "check":
    print("PASS: both good controls accepted; missing/public-route controls rejected.")
PY
printf 'Harbor results and diagnostics: %s\n' "$output"
