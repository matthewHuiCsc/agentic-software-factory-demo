"""Stage Harbor tasks from one tracked snapshot; no agent execution or grading."""

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
mode = sys.argv[2]
model = sys.argv[3] if len(sys.argv) == 4 else None
if mode not in {"check", "run"}:
    raise ValueError("Expected check or run")
if output.exists():
    raise ValueError("Output must be a new directory")
output.mkdir(parents=True)
template = root / "evals/harbor/service-endpoint"
revision = subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=root, text=True
).strip()
case_path = ".github/skills/service-endpoint/evals/evals.json"
cases = json.loads(subprocess.check_output(
    ["git", "show", f"{revision}:{case_path}"], cwd=root, text=True
))
case = next(case for case in cases["evals"] if case["id"] == 1)
tracked = subprocess.check_output(
    ["git", "ls-tree", "-r", "--name-only", revision], cwd=root, text=True
).splitlines()
prefixes = ("apps/", "gateways/", "packages/", "services/", "tests/")
names = {
    "README.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "eslint.config.mjs", ".prettierignore", ".gitignore", "Dockerfile",
    "docker-compose.yml", "docker-compose.test.yml",
}
paths = [
    path for path in tracked
    if path.startswith(prefixes)
    or path in names
    or ("/" not in path and ("config." in path or path.startswith("tsconfig.")))
    or path == ".github/copilot-instructions.md"
    or path == ".github/workflows/ci.yml"
    or path.startswith(".github/agents/")
    or (path.startswith(".github/skills/") and "/evals/" not in path)
]
archive = subprocess.check_output(
    ["git", "archive", revision, "--", *paths], cwd=root
)
source = output / "source"
source.mkdir()
with tarfile.open(fileobj=io.BytesIO(archive)) as snapshot:
    snapshot.extractall(source, filter="data")
target = ".github/skills/service-endpoint"
candidate = {
    str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in sorted(source.rglob("*")) if path.is_file()
}
if f"{target}/SKILL.md" not in candidate:
    raise ValueError("Snapshot is missing the target skill")

tasks = []
controls = ("good", "missing", "public") if mode == "check" else ("outcome",)
for control in controls:
    for arm in ("candidate", "baseline"):
        task = output / "tasks" / f"{control}-{arm}"
        shutil.copytree(template, task)
        (task / "instruction.md").write_text(
            "Source Agent Skills case service-endpoint:1 "
            "(original plan-only authoring context):\n\n> "
            + case["prompt"] + "\n\n"
            + (template / "instruction.md").read_text()
        )
        shutil.copytree(source, task / "environment/repo")
        if arm == "baseline":
            shutil.rmtree(task / "environment/repo" / target)
        if control == "missing":
            (task / "solution/solve.sh").write_text("#!/bin/bash\nset -euo pipefail\ntrue\n")
        elif control == "public":
            with (task / "solution/solve.sh").open("a") as script:
                script.write("""
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const path = '/workspace/packages/gateway-runtime/src/index.ts';
writeFileSync(path, readFileSync(path, 'utf8').replace('if (staff)', 'if (true)'));
JS
""")
        manifest = {
            str(path.relative_to(task / "environment/repo")):
                hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((task / "environment/repo").rglob("*")) if path.is_file()
        }
        expected = candidate if arm == "candidate" else {
            path: digest for path, digest in candidate.items()
            if not path.startswith(target + "/")
        }
        if manifest != expected:
            raise ValueError("Candidate/baseline source parity failed")
        (output / f"{control}-{arm}-snapshot.json").write_text(json.dumps({
            "revision": revision,
            "source_case": {"file": case_path, "id": case["id"]},
            "arm": arm,
            "filesystem_skills": [
                path for path in manifest if path.endswith("/SKILL.md")
            ],
            "files": manifest,
            "runtime_inventory": "not measured",
            "runtime_invocation": "not measured",
        }, indent=2) + "\n")
        tasks.append({"path": str(task)})

pins = dict(
    line.split("=", 1)
    for line in (root / "evals/harbor/pins.env").read_text().splitlines()
)
agent = {"name": "oracle"} if mode == "check" else {
    "name": "copilot-cli",
    "model_name": model,
    "skip_model_parsing": True,
    "override_setup_timeout_sec": 180,
    "kwargs": {
        "version": pins["COPILOT_VERSION"],
        "disable_web_search": True,
    },
}
(output / "job.json").write_text(json.dumps({
    "job_name": mode,
    "jobs_dir": str(output / "jobs"),
    "n_attempts": 1,
    "n_concurrent_trials": 1,
    "retry": {"max_retries": 0},
    "environment": {"type": "docker", "delete": True},
    "agents": [agent],
    "tasks": tasks,
}, indent=2) + "\n")
print(output)
