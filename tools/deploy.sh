#!/bin/sh
# Safe deploy: refuses to run unless wrangler is logged in as the LearnImpact account, runs the tests first, and never deploys during field hours without --live-fix.
# usage: sh tools/deploy.sh            (or: npm run deploy)
#        sh tools/deploy.sh --live-fix  (a change that fixes a live problem, allowed during 07:00-17:00 EAT)
cd "$(dirname "$0")/.." || exit 1
WHO=$(npx wrangler whoami 2>&1)
echo "$WHO" | grep -q "mkamukulu@learnimpact.org" || { echo "STOP: wrangler is not logged in as mkamukulu@learnimpact.org (LearnImpact). Run: npx wrangler logout, then npx wrangler login --browser=false, and open the link in a private window."; exit 1; }
echo "$WHO" | grep -q "LearnImpact" || { echo "STOP: the LearnImpact account is not listed for this login."; exit 1; }
H=$(TZ=Africa/Dar_es_Salaam date +%H)
if [ "$H" -ge 7 ] && [ "$H" -lt 17 ] && [ "$1" != "--live-fix" ]; then echo "STOP: it is field hours (07:00-17:00 EAT). Deploy before 07:00 or after 17:00, or use --live-fix for a live problem."; exit 1; fi
npm test 2>&1 | tail -3 | grep -q "ALL TESTS PASSED" || { echo "STOP: the tests did not all pass."; exit 1; }
npx wrangler deploy
