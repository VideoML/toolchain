# Portable bundles

A bundle contains one selected composition, its generated script and frozen timing, its required assets and the runtime dependency and font lock. Generate the script and resolved timing before export. Bundle paths in the following examples are relative to the project directory. The selected composition ID must match the source, script and timing; specify `--composition` when the source contains multiple compositions.

Use an installed VideoML CLI and its matching runtime packages, Python 3.9 or later, and, for rendering, an installed Chromium and FFmpeg. Python performs secure staging: the destination parent and ancestors must be trusted, and the destination parent must be private to the current user or supervisor. The staging boundary does not protect against hostile processes with the same UID or root. `--python` selects an explicit Python executable; nothing is downloaded automatically. Set `VIDEOML_CHROMIUM_EXECUTABLE_PATH` if Chromium cannot be found, and pass `--ffmpeg` if needed.

## Declarative XML

For a project with `source/main.xml`, `script/main.json` and `timing/main.resolved.json`:

```sh
vml bundle lock --source ./project --entry source/main.xml \
  --composition demo --out ./project/dependencies.lock.json
vml bundle export --source ./project --entry source/main.xml \
  --script script/main.json --timing timing/main.resolved.json \
  --composition demo --project-id my-project --trust local \
  --zip --destination ./demo.zip
vml bundle validate --source ./demo.zip --zip --trust local
vml bundle import --source ./demo.zip --zip --trust local --destination ./imported-demo
vml bundle render --source ./demo.zip --zip --trust local \
  --frames ./frames --out ./demo.mp4 --ffmpeg /path/to/ffmpeg
```

Lock output and destinations must not already exist. Add `--audio` for the assembled frozen WAV and repeat `--notice` for included license notices. Export selects the composition's referenced closure, not all files in the project. A directory bundle can be used instead of ZIP by omitting `--zip`. Validation can also use `--trust hosted` to evaluate the fixed hosted policy; its eligibility report is computed at validation time. Unsupported hosted content can still be portable for trusted local use.

## Trusted TypeScript and custom browser components

TypeScript execution is explicit local trust, not a sandbox. Include every source file in its static closure, and include the browser entry and its imports in that closure. Browser components register canonical IDs and versions through `registerComponents(host)`; each descriptor supplies a React `Component` and either `synchronous: true` or a per-instance `createController` with awaitable `settle` and `dispose`. The host provides its React and renderer context, so custom code shares the renderer's instances. IDs must be unique and cannot replace built-ins. The browser entry may also export `registerEffects` for the existing frame-effect registry.

```sh
vml bundle lock --source ./project --entry source/main.ts \
  --source-file source/main.ts --source-file source/browser.ts \
  --composition demo --execute-source --out ./project/dependencies.lock.json
vml bundle export --source ./project --entry source/main.ts \
  --source-file source/main.ts --source-file source/browser.ts \
  --browser-entry source/browser.ts --component MyComponent@1 \
  --script script/main.json --timing timing/main.resolved.json \
  --composition demo --project-id my-project --trust local --execute-source \
  --zip --destination ./custom.zip
vml bundle validate --source ./custom.zip --zip --trust local
vml bundle validate --source ./custom.zip --zip --trust local --execute-source
vml bundle import --source ./custom.zip --zip --trust local --execute-source --destination ./imported-custom
vml bundle render --source ./custom.zip --zip --trust local --execute-source \
  --frames ./custom-frames --out ./custom.mp4 --ffmpeg /path/to/ffmpeg
```

Without `--execute-source`, validation is inert and reports pending trusted execution; it does not establish that source and frozen artifacts agree. Import and render require execution and recheck that agreement. Hosted mode rejects custom TypeScript and browser code before execution. Static closure and dependency checks support portability but do not contain malicious trusted code. Bundle pins do not promise identical pixels or encoded video across different browsers, FFmpeg builds or system fonts; those environments require their own release validation.

To register a trusted custom effect that consumes authored-scene snapshots, pass `--effect-metadata ./effects.json` to export. The bounded JSON file is an array such as:

```json
[{"id":"custom/snapshot","version":"1","sceneInputs":[{"sceneIdParameter":"sourceSceneId","frameParameter":"sourceFrame"}]}]
```

The declarations are bound into the bundle manifest and must match the browser effect registrations. A snapshot-aware effect holds its owned `{bitmap, close()}` handle while its one derived canvas copy is live, then closes the handle. The public built-in `videoml/scene-snapshot@1` provides this behavior to ordinary XML using `props='{"parameters":{"sourceSceneId":"source","sourceFrame":75}}'`; it captures that authored scene once at the fixed absolute frame. Preview hosts supply a native-pixel provider explicitly. Missing providers and invalid or cyclic references fail rather than using a synthetic image.

## Runtime targets in version 2

Version 2 records a complete package-content closure for each supported runtime target, plus the declared font pins. Current supported targets are `darwin-arm64` and `linux-arm64-glibc`; Linux glibc is identified from Node's runtime report. Other architectures and musl fail explicitly. Collect a descriptor on each prepared runtime with `vml bundle runtime-lock --out ./target.json`. This reads and hashes the installed closure and checks the target's native esbuild executable; it does not install packages or access the network. Copy the collected foreign descriptor to the exporter, then add `--runtime-target ./foreign-target.json` to `vml bundle lock`; repeat for multiple targets. The exporter always collects its own target as well. Descriptors are bounded data files, not evidence by themselves that a runtime was actually inspected: retain the collector command, package provenance and runtime evidence.

All target maps must contain identical VideoML package identities and content hashes; non-VideoML payloads may differ only where explicitly pinned. Inert validation checks all maps and does not execute foreign binaries. Import requires the current target to be present; actual rendering and trusted TypeScript execution verify the entire selected installed closure and native executable before execution. Version 1 archives keep their original exact host-closure validation. They are not made cross-platform by reading them; create a new version 2 lock and explicitly re-export to migrate.
