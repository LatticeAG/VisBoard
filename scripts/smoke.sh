#!/usr/bin/env bash
# VisBoard OSS smoke test — requires API on localhost:8080
set -euo pipefail

export VISBOARD_ENDPOINT="${VISBOARD_ENDPOINT:-http://localhost:8080/v1}"
CLI="pnpm --filter @visboard/cli exec visboard --"

echo "==> Bootstrap workspace"
OUT=$($CLI auth bootstrap --name "Smoke Test" --slug smoke --json)
TOKEN=$(echo "$OUT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(d.token||'')")
test -n "$TOKEN"
$CLI auth set-token "$TOKEN"

echo "==> Create project"
$CLI project create --name "Demo" --slug demo

echo "==> Create note"
$CLI note create --project demo --title "Purpose" --slug purpose --body "# Purpose\nShip VisBoard."

echo "==> Create checklist"
CHK=$($CLI checklist create --project demo --title "Launch" --json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).id)")
ITEM=$($CLI checklist add --project demo "$CHK" --text "Item 1" --json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).id)")

echo "==> Create agent"
AGENT_TOKEN=$($CLI agent create --name "Bot" --scopes read,write:checklists,write:events --project demo --json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).token)")
$CLI auth set-token "$AGENT_TOKEN"

echo "==> Agent reads context"
$CLI agents-md --project demo | grep -q "AGENTS.md"
$CLI context --project demo --json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.project.slug!=='demo') process.exit(1)"

echo "==> Agent checks item"
$CLI checklist check --project demo "$CHK" "$ITEM"
$CLI auth set-token "$TOKEN"

echo "==> Verify checklist state"
$CLI context --project demo --json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.checklists[0].items[0].done) process.exit(1)"

echo "==> Upload file"
echo '{"ok":true}' > /tmp/visboard-smoke.json
$CLI file upload --project demo /tmp/visboard-smoke.json

echo "==> Export workspace"
$CLI export --workspace smoke --out /tmp/visboard-smoke-export.zip
test -f /tmp/visboard-smoke-export.zip

echo "SMOKE TEST PASSED"
