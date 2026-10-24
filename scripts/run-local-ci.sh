#!/usr/bin/env bash
# Klavierhaus authoritative local CI gate: Mac, Node 20.18.0/npm 10.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
if [[ -x "$HOME/.klavierhaus-runtime/node_modules/node/bin/node" ]]; then
  export PATH="$HOME/.klavierhaus-runtime/node_modules/node/bin:$HOME/.klavierhaus-runtime/node_modules/.bin:$PATH"
fi
if [[ "$(node --version)" != "v20.18.0" ]]; then
  echo "ERROR: Klavierhaus requires Node.js 20.18.0 (found $(node --version))." >&2
  exit 1
fi
if [[ "$(npm --version)" != 10.* ]]; then
  echo "ERROR: Klavierhaus requires npm 10.x (found $(npm --version))." >&2
  exit 1
fi
echo "[LOCAL-CI] Runtime: $(node --version), npm $(npm --version)"
git diff --check
npm run check:manifests
npm ci --no-audit --no-fund
npm run check:assets
npm run check:assets:http
npm run check:migration
npm run check
repeats="$(printenv CI_RUNS || true)"
if [[ -z "$repeats" ]]; then repeats=5; fi
if ! [[ "$repeats" =~ ^[1-9][0-9]*$ ]] || (( repeats > 10 )); then
  echo "ERROR: CI_RUNS must be an integer between 1 and 10." >&2
  exit 1
fi
for (( i=1; i<=repeats; i++ )); do
  echo "[LOCAL-CI] ERP acceptance run $i/$repeats"
  npm test
done
echo "[LOCAL-CI] Website dependency install and checks"
(
  cd website
  npm ci --no-audit --no-fund
  npm run check
  npm test
)
npm audit --omit=dev --audit-level=high
(
  cd website
  npm audit --omit=dev --audit-level=high
)
echo "[LOCAL-CI] All mandatory checks passed on Mac."
