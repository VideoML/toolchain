#!/bin/sh
# Run on each prepared host with explicit dependencies; never installs or downloads.
set -eu
umask 077
if [ "$#" -ne 7 ]; then
  echo 'usage: run.sh export|exercise CLI NODE FFMPEG CHROMIUM FOREIGN_DESCRIPTOR WORK_DIR' >&2; exit 2
fi
mode=$1; cli=$2; node_bin=$3; ffmpeg=$4; chromium=$5; foreign=$6; work=$7
fixture_root=$(CDPATH= cd -- "$(dirname -- "$0")/fixtures" && pwd)
mkdir -p "$work"; work=$(CDPATH= cd -- "$work" && pwd)
export VIDEOML_CHROMIUM_EXECUTABLE_PATH="$chromium"
vml() { "$node_bin" "$cli" bundle "$@"; }
if [ "$mode" = export ]; then
  [ ! -e "$work/xml.zip" ] && [ ! -e "$work/custom.zip" ] && [ ! -e "$work/xml-project" ] && [ ! -e "$work/custom-project" ] || { echo 'archives already exist' >&2; exit 1; }
  cp -R "$fixture_root/xml" "$work/xml-project"; cp -R "$fixture_root/custom" "$work/custom-project"
  vml lock --source "$work/xml-project" --entry source/main.xml --composition audio --runtime-target "$foreign" --out "$work/xml-project/dependencies.lock.json"
  vml export --source "$work/xml-project" --entry source/main.xml --script script/main.json --timing timing/main.resolved.json --audio assembled.wav --composition audio --project-id p17a-audio-font --trust local --zip --destination "$work/xml.zip"
  vml lock --source "$work/custom-project" --entry source/main.ts --source-file source/main.ts --source-file source/browser.tsx --composition custom-demo --execute-source --runtime-target "$foreign" --out "$work/custom-project/dependencies.lock.json"
  vml export --source "$work/custom-project" --entry source/main.ts --source-file source/main.ts --source-file source/browser.tsx --browser-entry source/browser.tsx --component P17Canvas@1 --script script/main.json --timing timing/main.resolved.json --audio public/videoml/custom-demo.wav --composition custom-demo --project-id p17a-custom --trust local --execute-source --zip --destination "$work/custom.zip"
elif [ "$mode" = exercise ]; then
  vml validate --source "$work/xml.zip" --zip --trust local
  vml import --source "$work/xml.zip" --zip --trust local --destination "$work/xml-imported"
  vml render --source "$work/xml.zip" --zip --trust local --frames "$work/xml-frames" --out "$work/xml.mp4" --ffmpeg "$ffmpeg"
  vml validate --source "$work/custom.zip" --zip --trust local
  vml import --source "$work/custom.zip" --zip --trust local --execute-source --destination "$work/custom-imported"
  vml render --source "$work/custom.zip" --zip --trust local --execute-source --frames "$work/custom-frames" --out "$work/custom.mp4" --ffmpeg "$ffmpeg"
else echo 'mode must be export or exercise' >&2; exit 2; fi
