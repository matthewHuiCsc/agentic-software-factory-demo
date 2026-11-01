#!/bin/bash
set -euo pipefail
mkdir -p /logs/verifier
cd /workspace
# This is a fresh verifier image: only the declared source artifact is inherited.
if {
  pnpm --filter './packages/*' build &&
  pnpm --filter @boba/gateway-runtime typecheck &&
  node /tests/acceptance.mjs
} > /logs/verifier/acceptance.log 2>&1; then
  printf '1\n' > /logs/verifier/reward.txt
else
  cat /logs/verifier/acceptance.log
  printf '0\n' > /logs/verifier/reward.txt
fi
