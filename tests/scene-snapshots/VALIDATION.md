# Authored scene snapshot validation

This packet adds the `videoml/scene-snapshot@1` frame effect and the shared provider, graph, and capture plumbing. A source scene is browser-painted at a fixed composition-absolute frame. The selected scene visibility override does not alter child timing. A preview requires an injected native-pixel provider; its effect receives an owned `{bitmap, close()}` handle. Trusted custom effect declarations are data-only `customEffects` manifest entries, and browser registration must match them. Hosted execution does not execute custom source.

Scoped source tests:

```sh
# From stdlib
npm run test:xml-effects
# From toolchain; use a task-owned tsconfig alias to resolve the sibling stdlib source
TSX_TSCONFIG_PATH=/path/to/source-alias-tsconfig.json node --import tsx --test \
  tests/scene-snapshots/plan.test.mjs tests/scene-snapshots/store.test.mjs \
  tests/scene-snapshots/provider.test.mjs tests/scene-snapshots/budget.test.mjs
# From specification, with jsonschema installed
python3 tests/validate_contracts.py
```

The source browser fixtures use the existing Chromium and the same source aliases. Set `VIDEOML_CHROMIUM_EXECUTABLE_PATH` and optionally `P03B_KEEP_ARTIFACTS=1`, then run `node --import tsx --test tests/scene-snapshots/browser.test.mjs` and `tests/scene-snapshots/shader-1080.browser.mjs`. The first exercises authored DOM text, a font asset and canvas with a fixed frame outside the selected scene's authored interval; the second checks a low-entropy 1080p P07 path. These are source-alias tests, not packed-package tests.

For packed tests, set `P03B_CONSUMER` to a consumer containing packed VideoML packages, `P03B_PROJECT` to the generated copied-XML fixture project, `P03B_FRAMES` to its CLI frame directory, `P03B_OUTPUT` to an output directory, and `VIDEOML_CHROMIUM_EXECUTABLE_PATH` to Chromium. The checked-in `packed-xml.browser.mjs`, `packed-negative.browser.mjs`, and `packed-p07.browser.mjs` are run using `node --import tsx` from that consumer. They respectively compare copied-XML player and CLI frames with independent partitions, check cycle/missing-provider failures before capture, and compare two snapshot-consuming P07 sources at start, midpoint, end and repeated/reverse seeks. The fixture source is `fixtures/copied-scene.xml`; generate, lock, export and render it with the standard CLI before comparing. The trusted TS fixture and declarative metadata are in `fixtures/custom-*.{ts,json}`; it requires `--execute-source`, a browser entry, and `--effect-metadata`.

## Conservative resource reservations

Each PNG is bounded to 16 MiB and its IHDR dimensions are checked before decode. Preparation serializes pages and holds completed data only as per-composition encoded strings. It reserves 24 times retained PNG bytes for the Node base64 string and protocol, page-string, `atob`, and byte-array copies across up to two source pages, including headroom; it also reserves 8 MiB for one provider's in-flight encoded decode copies and 16 MiB for the new screenshot. Before converting a measured screenshot to base64 it requires 16 times that actual size within the remaining encoded budget. The 16× allowance covers the Node buffer, UTF-16 base64 and protocol/page string copies, `atob` string, Uint8Array and Blob, with headroom. P07 reserves both 16 MiB screenshot buffers and two 8 MiB provider copy allowances before capture; after measurement it checks the actual two PNG sizes at 16× before conversion. These bounds are conservative: large but otherwise valid PNGs can be rejected.

Each provider reserves up to 8 MiB for concurrent encoded decode input copies before Blob creation. Each owned snapshot handle reserves eight bytes per composition pixel: one decoded bitmap and one canvas copy. The built-in holds the handle until its canvas is disposed; trusted custom consumers must follow the same ownership rule and close it only after discarding their drawn copy. Preparation limits dependency handles to 48 MiB while reserving up to 16 MiB for the verification bitmap. P07 reserves 16 bytes per composition pixel for two transient compositor bitmaps and two retained WebGL textures, then divides the remainder of 64 MiB equally between its two source-page providers. Each preparation request's ten-second deadline covers queueing, capture, PNG transfer, verification decode and cleanup. A later cached acquisition has a fresh ten-second decode deadline. Failed cleanup reports uncertainty.

These are explicit reservations for snapshot and transition copies, not a bound on total browser, GPU or process memory. In particular, arbitrary trusted custom code is not sandboxed and can make additional copies outside the provider contract. The conservative texture allowance does not prove the memory use of browser canvas backing stores or graphics-driver internals. Cross-platform pinned-Linux reproducibility remains a separate release gate.

## Local evidence from the final package snapshot

All runs below used macOS arm64 and the existing Chromium at `/Users/home/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`. The packed consumer at `/private/tmp/p03b-packed/consumer` contains the five tarballs listed below and other previously packed VideoML dependencies. Existing third-party dependencies were copied from the P17 consumer. There were no VideoML source links and this was not a fresh npm install. The separate P17a task owns the cross-platform packed-consumer gap.

Final tarball SHA256:

| Package | SHA256 |
| --- | --- |
| CLI | `374049d3a7e2fcf9257f277192c1f4d53123c3cfe1d987397b33cb444dfda100` |
| player | `ce4fb91c6b807e33d3da0753c4d78e8d114e1c69dd655f2ad6ad1fe049cb031d` |
| renderer | `8a6e7cf4d1bd0d9ad6d9edd7b55bbd5f169595164719f39ffd634582b6108498` |
| stdlib | `cb9e6730c4c5dddb1bf3dfdc14ec2bf8e75f3b72902a787e71174e7fd5a90a05` |
| toolchain | `da993bb38f09176084de03771fca24db2a776b11ddf493f86167415cb7b7b240` |

The task-owned source test configuration `/private/tmp/p03b-tsconfig.json` was:

```json
{"compilerOptions":{"baseUrl":"/Users/home/Projects/VideoML/toolchain","paths":{"@videoml/stdlib/effects":["../stdlib/src/effects/index.ts"],"@videoml/stdlib/effects/xml":["../stdlib/src/effects/xml.ts"]}}}
```

The full typecheck used `/private/tmp/p03b-tsconfig-check.json`, extending toolchain `tsconfig.json` and adding those two paths and `typeRoots: ["/Users/home/Projects/VideoML/toolchain/node_modules/@types"]`. `node node_modules/typescript/bin/tsc --noEmit -p /private/tmp/p03b-tsconfig-check.json` passed. Source tests passed: stdlib XML effects 16/16, particles 11/11, echo smear 25/25; snapshot graph/store/provider/budget plus manifest 25/25; toolchain `TSX_TSCONFIG_PATH=/private/tmp/p03b-tsconfig.json npm run test:bundle` 91 passed and one platform skip; specification 14 positive and 36 negative. Logs include `/private/tmp/p03b-bundle-final.log`, `/private/tmp/p03b-typecheck-final.log`, and `/private/tmp/p03b-spec-final.log`.

The final source browser run `/private/tmp/p03b-final-browser.log` passed both fixtures. Retained images are `/var/folders/h8/bff490w93nl9c87021k92f0m0000gp/T/p03b-browser-Ybmzqu/captured.png`, `captured-30.png`, and `/var/folders/h8/bff490w93nl9c87021k92f0m0000gp/T/p03b-1080-LJ1vWs/frame-000000-000015.png`. The 1080p frame is intentionally low-entropy and demonstrates the bounded P07 path, not visual catalog parity.

Packed XML outputs and comparison logs are `/private/tmp/p03b-packed/snapshot-accept.mp4`, `snapshot24-accept.mp4`, and `snapshot{,24}-accept-parity.log`. Each parity run compares a whole-order sequence and two fresh-player partitions to the packed CLI frames at its frame rate. The packed P07 two-provider run `/private/tmp/p03b-packed/p07-accept.log` records endpoint/midpoint RGBA and repeated/reverse hashes; its frames are in `p07-accept/`. `/private/tmp/p03b-packed/negative-accept.log` records missing-provider and cycle rejection before provider calls. Packed trusted TS metadata export/render is `/private/tmp/p03b-packed/custom-accept.zip`, `custom-accept.mp4`, and `custom-accept-{export,render}.log`. The intentionally mismatched declaration was rejected with `SCENE_CAPTURE_UNDECLARED` before output (`custom-mismatch-accept-render.log`). Earlier inert/hosted validation evidence is `custom-inert.log` and `custom-hosted.log`.

To repeat the final packed browser checks from the toolchain root, with the same local prerequisites:

```sh
export P03B_CONSUMER=/private/tmp/p03b-packed/consumer
export P03B_OUTPUT=/private/tmp/p03b-packed
export VIDEOML_CHROMIUM_EXECUTABLE_PATH=/Users/home/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell
P03B_PROJECT=$P03B_CONSUMER/snapshot-project P03B_FRAMES=$P03B_OUTPUT/snapshot-accept-frames node --import tsx tests/scene-snapshots/packed-xml.browser.mjs
P03B_PROJECT=$P03B_CONSUMER/snapshot24-project P03B_FRAMES=$P03B_OUTPUT/snapshot24-accept-frames node --import tsx tests/scene-snapshots/packed-xml.browser.mjs
P03B_OUTPUT=/private/tmp/p03b-packed/p07-rerun node --import tsx tests/scene-snapshots/packed-p07.browser.mjs
node --import tsx tests/scene-snapshots/packed-negative.browser.mjs
```

These checks do not establish pinned Linux or cross-host pixel and encoded-video equivalence; that release evidence and the P17a packaging portability work remain separate.
