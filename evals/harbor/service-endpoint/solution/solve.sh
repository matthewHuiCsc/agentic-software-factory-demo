#!/bin/bash
set -euo pipefail
cd /workspace
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'packages/gateway-runtime/src/index.ts';
const source = readFileSync(path, 'utf8');
const marker = "        method: 'POST',\n        path: '/api/stock/:id/adjustments',";
if (source.split(marker).length !== 2) throw new Error('Fixture seam changed');
writeFileSync(path, source.replace(marker,
  "        method: 'GET',\n        path: '/api/stock/:id/adjustments',\n" +
  "        service: 'inventory',\n        target: '/stock/:id/adjustments',\n" +
  "      },\n      {\n" + marker));
JS
