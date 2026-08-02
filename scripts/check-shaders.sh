#!/usr/bin/env bash
# Compile every shader, for real, by loading the built page in a browser.
#
# This exists because a GLSL bug ships silently. `half` is a reserved word in
# GLSL ES; using it as a variable name typechecks, lints, passes every unit test
# and builds a perfectly good bundle, because the shader is just a string until
# a GPU driver sees it. That one went live.
#
# Chrome's SwiftShader gives a real WebGL2 implementation with no GPU, so every
# program in the app is genuinely compiled and linked here. Note what is *not*
# being asserted: SwiftShader's float blending does not accumulate, so the
# histogram draws wrong under it. That is a software-renderer limitation, and
# this check deliberately looks only for compile and link failures rather than
# trying to judge what was drawn.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/dist"
[ -d "$dist" ] || { echo "no dist/ — run 'npm run static:build' first" >&2; exit 1; }

chrome="${CHROME:-}"
if [ -z "$chrome" ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome-stable || true)" \
    "$(command -v google-chrome || true)" \
    "$(command -v chromium || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && chrome="$candidate" && break
  done
fi
[ -n "$chrome" ] || { echo "no Chrome found; set CHROME=/path/to/chrome" >&2; exit 1; }

port="${PORT:-8731}"
python3 -m http.server "$port" --directory "$dist" --bind 127.0.0.1 >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sSf "http://127.0.0.1:$port/" >/dev/null 2>&1 && break
  sleep 0.25
done

# ?demo=1 so a source is actually assigned to every tile — a program that is
# never used is a program that is never compiled.
dom="$("$chrome" --headless=new --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --virtual-time-budget=10000 --dump-dom \
  "http://127.0.0.1:$port/?demo=1" 2>/dev/null)"

if grep -qE 'failed to compile|failed to link' <<<"$dom"; then
  echo "::error::A shader failed to compile or link"
  grep -oE '(vertex|fragment) shader failed to compile[^<]*|program failed to link[^<]*' <<<"$dom" | head -5
  exit 1
fi

if ! grep -q 'wall__grid' <<<"$dom"; then
  echo "::error::The wall did not render at all — the page may have thrown before mounting"
  exit 1
fi

echo "shaders compiled and linked"
