#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist-tarballs"
mkdir -p "$OUT"
rm -f "$OUT"/*.tgz

pack_one() {
  local dir="$1"
  local expected="$2"
  (
    cd "$ROOT/$dir"
    pnpm pack --pack-destination "$OUT"
  )
  local tarball
  tarball="$(ls -1 "$OUT"/"$expected" 2>/dev/null | head -n 1)"
  if [[ -z "$tarball" ]]; then
    echo "missing tarball matching $expected" >&2
    ls -1 "$OUT"
    exit 1
  fi
  echo "packed $tarball"
  local listing
  listing="$(tar tzf "$tarball")"
  if [[ "$dir" == "packages/cli" || "$dir" == "packages/mcp" ]]; then
    local first
    first="$(tar xOf "$tarball" package/dist/index.js | head -n 1)"
    if [[ "$first" != "#!/usr/bin/env node" ]]; then
      echo "$dir dist/index.js is missing the node shebang" >&2
      exit 1
    fi
    if grep -q '^package/src/' <<<"$listing"; then
      echo "$dir tarball must not contain src/" >&2
      exit 1
    fi
  else
    if ! grep -qx 'package/dist/index.d.ts' <<<"$listing"; then
      echo "$dir tarball missing package/dist/index.d.ts" >&2
      exit 1
    fi
    if grep -q '^package/src/' <<<"$listing"; then
      echo "$dir tarball must not contain src/" >&2
      exit 1
    fi
  fi
}

pack_one packages/shared visboard-shared-0.1.0.tgz
pack_one packages/sdk visboard-sdk-0.1.0.tgz
pack_one packages/agent-sdk visboard-agent-sdk-0.1.0.tgz
pack_one packages/cli visboard-cli-0.1.0.tgz
pack_one packages/mcp visboard-mcp-0.1.0.tgz

test -f "$OUT/visboard-sdk-0.1.0.tgz"
echo "pack-sdks: wrote tarballs to $OUT"
