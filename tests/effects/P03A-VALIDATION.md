# P03a placement validation

`mountEffect` copies the validated half-open bounds and supplies a fresh frozen `context.timing`. Seek stays absolute. This packet includes three compatibility corrections: the renderer and player now gate frame effects at the same floor/ceil frame boundaries, and the DOM fallback registry reserves the frame-effect host so its placeholder cannot shift the canvas. Ordinary components and version 1 effect interpolation retain their previous behavior. Fractional boundary frames that were previously omitted intentionally change.

Failure-first checks caught caller timing override, renderer and player fractional boundary culling, and the fallback placeholder. The stdlib `npm run test:xml-effects`, `npm run test:particles`, and `npm run test:echo-smear` passed 4, 11, and 25 tests respectively. The placement suite compares whole-order sampling against two independently mounted partitions at 24 and 30 fps, including config mutation and direct-mount failure when timing is unavailable. Toolchain `npx tsc --noEmit` passed. The following browser test passed both player and renderer cases at 24 and 30 fps, including inherited computed visibility and repeated/reverse seeks:

```sh
VIDEOML_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome-headless-shell \
  node --import tsx --test tests/effects/placement.browser.test.mjs
```

The existing P09 browser tests passed 5/5. All 24 particle PNGs matched the prior P09 baseline byte for byte. A freshly packed CLI rendered a zero-offset XML font effect: its 90 frames matched the previous P17 reference byte for byte.

For fractional placement, the packed CLI rendered a copied XML particle effect at 0.31s for 0.23s, separately at 24 and 30 fps. A packed player rendered the same XML, seed and font on a normalized 320×240 host. At nine forward, repeated and reverse seeks per frame rate, full-frame PNG hashes matched the CLI output; the check also asserted computed visibility across ancestors, no fallback placeholder, and a visible canvas rectangle of `[0,0,320,240]`. Local evidence is in `/private/tmp/p03a-packed/compare-24.log`, `compare-30.log`, `offset24-frames/`, `offset-final-frames/`, and `player-{24,30}-*.png`.

The checked-in `packed-placement.browser.mjs` passed against the same 24 and 30 fps frames. It loads Playwright and esbuild from the packed consumer; using another Playwright version changed rendered pixels in the local check. Given the generated project and CLI frames, run it from the packed consumer so its browser bundle resolves the packed player and its dependencies:

```sh
cd /path/to/packed-consumer
export VIDEOML_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome-headless-shell
P03_FPS=24 P03_PROJECT=/path/to/offset24-project \
  P03_FRAMES=/path/to/offset24-frames P03_OUTPUT=/path/to/output \
  node /path/to/toolchain/tests/effects/packed-placement.browser.mjs
P03_FPS=30 P03_PROJECT=/path/to/offset30-project \
  P03_FRAMES=/path/to/offset30-frames P03_OUTPUT=/path/to/output \
  node /path/to/toolchain/tests/effects/packed-placement.browser.mjs
```

The consumer contained freshly packed stdlib, player, renderer and toolchain, with other VideoML packages from the prior P17 pack and copied existing third-party dependencies. It was not a fresh npm install and used no VideoML source links. Package tarball SHA256 values:

- stdlib: `e83cbe4f6ab929c5bbbe9765234be7abeb534d5f2efe95344cc631351b09dd43`
- player: `c72c3bb19c788756133fbd364e1fe05fe82024533697f525b03f315d76e32db7`
- renderer: `82bd4ef36d42b6c477b75318907fe5e7be6c45ec95d4e2d7f6435625541c34d3`
- toolchain: `7abb83f3c6d32a67a6ad6e700dbb670ed2c3f8285b259beb2a2b2088904179a9`

Tests used the existing macOS arm64 Chromium and FFmpeg. The separately scoped pinned Linux release parity gate remains outstanding. The offset CLI comparison uses the existing version 1 particle effect; the separate synthetic test effect verifies the new relative timing context and frozen copies.
