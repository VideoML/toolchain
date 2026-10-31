# P17a cross-platform fixture

These are the exact source, script, resolved-timing, font, and frozen-audio bytes used in the P17a acceptance run. The XML WAV and segment were produced by the dry-run provider. The XML effect loads `source/fonts/Geist.woff2`; its SHA-256 is `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1`. Geist is from the [Geist font project](https://github.com/vercel/geist-font) and distributed under the included `fixtures/xml/notices/Geist-OFL.txt`. The generated audio is a test fixture, not a voice model output.

Use two separately installed, offline VideoML consumers with the same six VideoML package contents and their actual platform-native dependencies. Supply existing Node, ffmpeg and Chromium paths; nothing in these scripts installs dependencies or downloads a browser. Runtime descriptors are generated from each actual consumer:

```sh
NODE CLI bundle runtime-lock --out TARGET.json
```

On the export host, provide the other host's descriptor and an empty private work directory:

```sh
./tests/bundle/p17a/run.sh export CLI NODE FFMPEG CHROMIUM FOREIGN_TARGET.json WORK
./tests/bundle/p17a/run.sh exercise CLI NODE FFMPEG CHROMIUM FOREIGN_TARGET.json WORK
```

Copy `WORK/xml.zip` and `WORK/custom.zip` byte-for-byte into an empty private work directory on the other host, then run the `exercise` command there with that host's paths. `FOREIGN_TARGET.json` is unused during exercise but remains a required positional argument. The two imports must have absent destinations. For Linux use a suitably bounded, network-disabled container and expose only the prepared runtime and task-owned work directory. The tested image and exact local run evidence are recorded in [P17A-VALIDATION.md](../P17A-VALIDATION.md).

After bringing the two work directories into the same environment, verify ZIP identity, imported source/script/timing/audio/font hashes, XML PCM samples, and actual ffprobe stream counts and durations:

```sh
python3 tests/bundle/p17a/compare.py MAC_WORK LINUX_WORK FFPROBE
```

Compare decoded image pixels separately: browser, operating-system and font rasterization can differ even when bundle bytes and timing match. The script does not assert pixel equivalence, provision runtimes, or establish a production isolation boundary.
