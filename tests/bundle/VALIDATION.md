# Portable bundle validation evidence

The P17 local checks used Node 26.7.0, Python 3.12.2, Chromium headless shell 153.0.8010.12 and FFmpeg 7.0.1 on macOS arm64. They are not the pinned Linux release proof; P28/D14 retains that gate. Browser SHA256: `a0bfe7b4da4787b66058477d696cd1d09065d25f06a548947722b9af77ee8282`; FFmpeg SHA256: `f2ad57d815f526bbd7aea2442ace95658928bff91fd445cb048eb6ef08115bff`. The full FFmpeg build information is in `/private/tmp/p17-packed/ffmpeg-version.log` on the validation machine.

The test consumer contained unpacked npm tarballs for all six VideoML packages, without links to VideoML source checkouts. Existing third-party packages were reused; this was not a fresh npm install. The final CLI tarball was repacked for signal handling after the earlier custom-render evidence, so that earlier custom bundle lock refers to the preceding CLI package content. The cancellation test used a freshly locked custom bundle against the final CLI package. The font lock, export and render were repeated against that final package.

Final package tarball SHA256 values:

| Package | SHA256 |
| --- | --- |
| CLI | `91790475f7e186417a8b2058a32151c37155761776046a3a7c3fbe92361ec379` |
| player | `e021f4f9d0ee6c411e58269d5c3c83b0dc3ec6e7a3ca192400def5d9b6d56bc4` |
| renderer | `25d2ea0164338342552a4df80bf49c8ec5b6f87d99976ecfd87874fb74c3ed77` |
| shared | `f6a916cf34d009fd6706997dd23813735a08ee09f7c1bc633421bd9800816147` |
| stdlib | `eb88291569386eae798dd0dc207256950ac84f60a41744a13f9007c9aea57379` |
| toolchain | `7abb83f3c6d32a67a6ad6e700dbb670ed2c3f8285b259beb2a2b2088904179a9` |

Scoped source checks run from the toolchain root:

```sh
npm run test:bundle
npx tsc --noEmit
node --import tsx --test tests/timing/generation.test.ts tests/timing/normalization.test.ts
```

These produced 90 passing bundle tests and one platform skip, a clean typecheck, and 20 passing timing tests. From the specification root, `/Users/home/miniconda3/bin/python3.12 tests/validate_contracts.py` passed 13 positive and 30 negative cases. Use a suitable local Python 3 interpreter in other environments.

Browser harnesses require an existing Chromium executable, compatible installed dependencies, and the indicated fixture directories. They do not download a browser:

```sh
export VIDEOML_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome-headless-shell
export P17_CONSUMER_DIR=/path/to/packed-consumer
export P17_ARTIFACT_DIR=/path/to/artifacts
export P17_BUNDLE_DIR=/path/to/imported-custom-bundle
node --import tsx tests/bundle/packed-custom-conformance.browser.mjs
node --import tsx tests/bundle/framer.browser.mjs
node --import tsx tests/bundle/portable-lifecycle.browser.mjs
node --import tsx tests/bundle/shader-policy.browser.mjs
export P17_BUNDLE_PATH=/path/to/freshly-locked-custom.zip
export P17_FFMPEG=/path/to/ffmpeg
node tests/bundle/cli-cancellation.browser.mjs
```

The packed custom fixture exercised an async canvas, GSAP and a two-scene domain warp: random and repeated seeks, reverse order and two partitions matched sequential frame hashes. `/private/tmp/p17-packed/custom-conformance-release.log` and `custom-frames-release/` contain the local evidence. The packed Framer fixture exercised the actual motion component, shared React context, a portal and controller-owned nested root (`framer-packed.log`). The licensed bundled Geist font fixture rendered the particle text (`font-frames-release/`), and the audio fixture preserved the 17,455 PCM samples of the simulated source. These artifacts are local evidence and are not checked into the repository.

The final CLI signal check waited for an actual captured frame and Chromium processes before SIGINT. It exited 130, preserved the existing output, and found none of the eight observed owned processes remaining (`/private/tmp/p17-packed/cli-cancellation.log`). The shader policy check separately observed zero external HTTP connections and WebSocket upgrades, and aborted after a scene seek began.

Portable TypeScript and custom browser code require explicit local trust and are not sandboxed. Hosted eligibility is recomputed, and hosted execution rejects custom code. Bundle pins cover project content, runtime packages and declared font bytes; they do not establish identical pixels or encoded bytes across host browsers, FFmpeg builds or system fonts. The refreshed font bundle has content digest `ebfb4d16bc10234eafc682f0780c0fe880e8715cf1bd887ad74f7948a65be989`; its local artifacts are `font-signal.zip`, `font-signal.mp4`, `font-frames-signal/` and `font-render-signal.log` under `/private/tmp/p17-packed/`. Frame 83 has the same SHA256 as the previously reviewed frame.
