#!/bin/sh
# Runs every test: bundles each file (the worker code needs a stub for the Cloudflare runtime) and runs it with Node.
cd "$(dirname "$0")/.." || exit 1
fail=0
for j in public/app.js public/i18n-sw.js src/index.js; do node --check "$j" || { echo "SYNTAX ERROR in $j"; fail=1; }; done
for f in test/*_test.mjs; do
  n=$(basename "$f" .mjs)
  npx esbuild "$f" --bundle --platform=node --format=esm --alias:cloudflare:workers=./test/cfw-stub.js --outfile=test/dist/$n.mjs --log-level=error || { echo "BUILD FAILED $n"; fail=1; continue; }
  out=$(cd test && node dist/$n.mjs 2>&1); code=$?
  echo "== $n: $(echo "$out" | grep -cE '^(PASS|ALL PASS)') passed, $(echo "$out" | grep -cE '^(FAIL|FAILED)') failed"
  [ $code -ne 0 ] && { echo "$out" | grep '^FAIL'; fail=1; }
done
[ $fail -eq 0 ] && echo "ALL TESTS PASSED" || { echo "SOME TESTS FAILED"; exit 1; }
