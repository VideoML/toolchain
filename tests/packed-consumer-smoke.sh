#!/bin/sh
# Workspace-only integration check. Pass a new, empty scratch directory and cached Chromium.
set -eu
scratch=${1:?usage: packed-consumer-smoke.sh SCRATCH_DIR CHROMIUM_EXECUTABLE}
chromium=${2:?usage: packed-consumer-smoke.sh SCRATCH_DIR CHROMIUM_EXECUTABLE}
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
if [ -e "$scratch" ]; then
  echo "Scratch path already exists: $scratch" >&2
  exit 1
fi
mkdir -p "$scratch"
scratch=$(CDPATH= cd -- "$scratch" && pwd)
if [ -n "${VIDEOML_SMOKE_CONSUMER:-}" ]; then
  cd "$VIDEOML_SMOKE_CONSUMER"
else
  mkdir -p "$scratch/packs" "$scratch/consumer"
for package in toolchain toolchain/packages/shared toolchain/packages/renderer cli player stdlib; do
  (cd "$root/$package" && npm pack --pack-destination "$scratch/packs" --silent)
done
cd "$scratch/consumer"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund "$scratch"/packs/*.tgz playwright@1.56.1 react@18 react-dom@18
fi
./node_modules/.bin/vml --help
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as direct from '@videoml/renderer/context';
import * as legacy from '@videoml/toolchain/renderer/context';
import * as registry from '@videoml/renderer/components/registry';
import * as legacyRegistry from '@videoml/toolchain/renderer/components/registry';
assert.equal(legacy.RendererProvider, direct.RendererProvider);
for (const key of Object.keys(registry)) assert.equal(legacyRegistry[key], registry[key]);
await Promise.all(['@videoml/toolchain','@videoml/renderer','@videoml/shared/dsl-to-script','@videoml/player','@videoml/stdlib'].map(name => import(name)));
JS
cat > script.json <<'JSON'
{"meta":{"fps":30,"width":320,"height":180,"durationSeconds":0.034},"scenes":[{"id":"scene","startSec":0,"endSec":0.034,"components":[{"id":"background","type":"Background","props":{"color":"#204060"}}]}]}
JSON
VIDEOML_CHROMIUM_EXECUTABLE_PATH="$chromium" ./node_modules/.bin/vml render --script script.json --frames "$scratch/frames" --out "$scratch/output.mp4" --end 0 --workers 1
test -s "$scratch/frames/frame-000000.png"
# Compare a decoded pixel, so a blank or stale PNG cannot satisfy the smoke test.
pixel=$(ffmpeg -v error -i "$scratch/frames/frame-000000.png" -vf 'crop=1:1:100:100,format=rgb24' -f rawvideo - | od -An -tu1 | xargs)
[ "$pixel" = "32 64 96" ] || { echo "Unexpected PNG pixel: $pixel" >&2; exit 1; }
for kind in current legacy; do
  case "$kind" in current) suffix=videoml ;; legacy) suffix=babulus ;; esac
  mkdir -p "$scratch/$kind" "$scratch/$kind-out/env/development/segments"
  cat > "$scratch/$kind/example.$suffix.xml" <<XML
<vml id="$kind" fps="30" width="320" height="180"><scene id="scene" start="0s" end="1s"><cue id="cue"><voice>Hello world</voice><pause seconds="0.1s" /></cue></scene></vml>
XML
  env -u OPENAI_API_KEY -u ELEVENLABS_API_KEY -u AWS_ACCESS_KEY_ID -u AWS_PROFILE -u AWS_WEB_IDENTITY_TOKEN_FILE -u AZURE_SPEECH_KEY -u AZURE_SPEECH_REGION ./node_modules/.bin/vml generate "$scratch/$kind" --provider dry-run --no-usage --script-out "$scratch/$kind.json" --timeline-out "$scratch/$kind-timeline.json" --audio-out "$scratch/$kind.wav" --out-dir "$scratch/$kind-out" --quiet
  test -s "$scratch/$kind.json"
  test -s "$scratch/$kind-timeline.json"
  test -s "$scratch/$kind.wav"
done
