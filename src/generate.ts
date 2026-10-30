import { GenerationSession } from "./providers/tts/auritus.js";
import { writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { CompileError } from "./errors.js";
import { getDefaultMusicProvider, getDefaultProvider, getDefaultSfxProvider, type Config } from "./config.js";
import { getEnvironment, resolveEnvCacheDir } from "./env.js";
import { loadManifest, getManifestDuration, resolveCachedSegment, resolveCachedSfx, resolveCachedMusic } from "./cache-resolver.js";
import { hashKey, safePrefix, ensureDir } from "./util.js";
import { makeBullet, type Script, type TransitionTimelineItem, scriptToJson } from "./models.js";
import { getProviderConfig } from "./config.js";
import { getTtsProvider } from "./providers/tts/registry.js";
import { estimateDurationSec } from "./providers/tts/dry-run.js";
import { getSfxProvider } from "./providers/sfx/registry.js";
import { getMusicProvider } from "./providers/music/registry.js";
import {
  type CompositionSpec,
  type PauseSpec,
  type SceneSpec,
  type VoiceSegmentSpec,
  type AudioClipSpec,
  type TimelineItemSpec,
  type TransitionSpec,
  type MarkSpec,
  type AudioElementSpec,
  type AudioPlan,
  type NarrationSpec,
  type ComponentSpec,
  type LayerSpec,
} from "./dsl/types.js";
import { pause as pauseHelper } from "./dsl/pause.js";
import { concatAudioFiles, estimateTrailingSilenceSec, probeDurationSec, trimAudioToDuration } from "./media.js";
import { writeSilenceWav } from "./audio/wav.js";
import { loadSelections, selectionPath } from "./sfx-workflow.js";
import { ensureDictionaryFromRules, rulesHash, type PronunciationRule } from "./elevenlabs-pronunciation.js";
import { ElevenLabsTTSProvider } from "./providers/tts/elevenlabs.js";
import { createUsageLedger, recordUsage, summarizeUsageFile, summarizeUsageFileDetailed, type UsageEntry } from "./telemetry.js";
import { estimateUsageCost, getRateCard } from "./pricing.js";
import { writeRunArtifacts } from "./artifacts.js";

export type GeneratedArtifact = {
  script: Script;
  audioPath: string | null;
  timelinePath: string;
  didSynthesize: boolean;
  runId?: string;
  runPath?: string;
};

export type GenerateOptions = {
  generationSession?: GenerationSession;
  composition: CompositionSpec;
  dslPath: string;
  scriptOut: string;
  audioOut?: string | null;
  timelineOut: string;
  outDir: string;
  config: Config;
  providerOverride?: string | null;
  sfxProviderOverride?: string | null;
  musicProviderOverride?: string | null;
  seedOverride?: number | null;
  fresh?: boolean;
  usagePath?: string | null;
  log?: (msg: string) => void;
  verboseLogs?: boolean;
};

export async function generateComposition(options: GenerateOptions): Promise<GeneratedArtifact> {
  const session = options.generationSession ?? new GenerationSession();
  let primaryError: unknown;
  try { return await generateWithSession(options, session); }
  catch (error) { primaryError = error; throw error; }
  finally {
    if (!options.generationSession) {
      try { await session.dispose(); } catch (error) { if (!primaryError) throw error; }
    }
  }
}

async function generateWithSession(options: GenerateOptions, session: GenerationSession): Promise<GeneratedArtifact> {
  const {
    composition,
    dslPath,
    scriptOut,
    audioOut,
    timelineOut,
    outDir,
    config,
    providerOverride,
    sfxProviderOverride,
    musicProviderOverride,
    seedOverride,
    fresh = false,
    log,
    verboseLogs = true,
  } = options;

  const _log = (msg: string) => {
    if (log) {
      log(msg);
    }
  };

  const voiceover = composition.voiceover ?? {};
  const selectedProvider = providerOverride ?? voiceover.provider ?? getDefaultProvider(config);
  const providerName = selectedProvider ?? "none";
  const sampleRateHz = voiceover.sampleRateHz ?? (["openai", "auritus"].includes(providerName ?? "") ? 24000 : 44100);
  const leadInSec = voiceover.leadInSeconds ?? 0;
  const defaultTrimEnd = voiceover.trimEndSeconds ?? 0;
  const hasNarration = composition.timeline.some(item => "items" in item && item.items.some(i => i.kind === "cue" && i.segments.some(s => s.kind === "text" && s.text.trim())));
  if (!selectedProvider && hasNarration) {
    throw new CompileError(
      "No TTS provider configured. Set tts.default_provider or pass --provider.",
    );
  }
  const provider = selectedProvider && hasNarration ? getTtsProvider(providerName, config, session) : { name: "none", async synthesize(): Promise<never> { throw new CompileError("No TTS provider configured"); } };
  const auritusConfig = providerName === "auritus" ? getProviderConfig(config, "auritus") : {};
  const selectedVoice = voiceover.voice ?? (typeof auritusConfig.voice === "string" ? auritusConfig.voice : null);
  if (hasNarration && auritusConfig.speed !== undefined && typeof auritusConfig.speed !== "number") throw new CompileError("providers.auritus.speed must be a positive finite number");
  const selectedSpeed = voiceover.speed ?? (typeof auritusConfig.speed === "number" ? auritusConfig.speed : 1);
  if (hasNarration && (!Number.isFinite(selectedSpeed) || selectedSpeed <= 0)) throw new CompileError("voiceover speed must be a positive finite number");
  const selectedSeed = seedOverride ?? voiceover.seed ?? (typeof auritusConfig.seed === "number" ? auritusConfig.seed : 0);
  const dryRunMode = providerName === "dry-run";
  const resolvedModel = voiceover.model ?? (provider as { defaultModel?: string }).defaultModel ?? null;
  const resolvedVoice = selectedVoice ?? (provider as { defaultVoice?: string }).defaultVoice ?? null;

  if (verboseLogs) {
    const modelInfo = `model=${resolvedModel ?? ""}`;
    const voiceInfo = `voice=${resolvedVoice ?? ""}`;
    _log(`voice: provider=${providerName} ${modelInfo} ${voiceInfo} fresh=${Boolean(fresh)}`);
    _log(`meta: fps=${composition.meta?.fps ?? "undefined"} width=${composition.meta?.width ?? "undefined"} height=${composition.meta?.height ?? "undefined"}`);
  }

  const rng = makeRng(seedOverride ?? voiceover.seed ?? (providerName === "auritus" ? selectedSeed : null));

  const currentEnv = getEnvironment();
  const envCacheDir = resolveEnvCacheDir(outDir, currentEnv);
  const segmentsDir = join(envCacheDir, "segments");
  if (!dryRunMode) {
    ensureDir(segmentsDir);
  }
  const usagePath = options.usagePath === undefined ? join(envCacheDir, "usage.jsonl") : options.usagePath;
  const usageLedger = usagePath ? createUsageLedger(usagePath) : null;
  const rateCard = getRateCard(config);
  const manifestPath = join(envCacheDir, "manifest.json");
  const baseManifest = fresh ? {} : loadManifest(manifestPath);
  const manifest = normalizeManifest(baseManifest);

  if (verboseLogs) {
    _log(`cache: env=${currentEnv} provider=${providerName}`);
  }

  const pronunciations = voiceover.pronunciations ?? [];
  if (providerName !== "elevenlabs" && pronunciations.some(rule => rule.phoneme)) throw new CompileError(`TTS provider "${providerName}" does not advertise phoneme support`);
  const expandText = (text: string) => providerName === "elevenlabs" ? text : pronunciations.reduce((value, rule) => rule.alias ? value.split(rule.grapheme).join(rule.alias) : value, text);

  let didSynthesize = false;
  let pronunciationRulesHash: string | null = null;
  let effectivePronunciationLocators: Array<Record<string, unknown>> | null = null;

  if (providerName === "elevenlabs" && voiceover.pronunciations && voiceover.pronunciations.length > 0) {
    const rules: PronunciationRule[] = voiceover.pronunciations.map((lex) => {
      if (lex.alias) {
        return { stringToReplace: lex.grapheme, type: "alias", alias: lex.alias };
      }
      if (!lex.phoneme) {
        throw new CompileError(`Pronunciation lexeme for "${lex.grapheme}" must provide phoneme or alias`);
      }
      return {
        stringToReplace: lex.grapheme,
        type: "phoneme",
        phoneme: lex.phoneme,
        alphabet: lex.alphabet ?? "ipa",
      };
    });

    if (!(provider instanceof ElevenLabsTTSProvider)) {
      throw new CompileError("ElevenLabs pronunciation rules require the elevenlabs provider");
    }

    if (!provider.apiKey) {
      throw new CompileError("ElevenLabs pronunciation dictionaries require providers.elevenlabs.api_key in config");
    }

    pronunciationRulesHash = rulesHash(rules);
    const dictName = voiceover.pronunciationDictionary?.name ?? `babulus-${composition.id}`;
    const { id: dictId } = await ensureDictionaryFromRules({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      name: dictName,
      rules,
      manifest,
      workspaceAccess: voiceover.pronunciationDictionary?.workspaceAccess ?? null,
      description: voiceover.pronunciationDictionary?.description ?? null,
    });

    const merged: Array<Record<string, unknown>> = [
      { pronunciation_dictionary_id: dictId, version_id: null },
    ];

    if (voiceover.pronunciationDictionaryLocators) {
      for (const loc of voiceover.pronunciationDictionaryLocators) {
        if (loc.pronunciationDictionaryId === dictId) {
          continue;
        }
        merged.push({
          pronunciation_dictionary_id: loc.pronunciationDictionaryId,
          version_id: loc.versionId ?? null,
        });
      }
    }
    if (merged.length > 3) {
      throw new CompileError("ElevenLabs supports up to 3 pronunciation dictionaries per request");
    }
    effectivePronunciationLocators = merged;
  }

  const ttsContext = {
    voice: selectedVoice,
    model: voiceover.model ?? null,
    format: voiceover.format ?? "wav",
    sample_rate_hz: sampleRateHz,
    provider_ctx: providerCacheContext(providerName, provider),
    pronunciation_dictionary_locators: effectivePronunciationLocators,
    pronunciation_rules_hash: pronunciationRulesHash,
  };

  const legacyScenes = (composition as { scenes?: SceneSpec[] }).scenes ?? [];
  const timelineSpec: TimelineItemSpec[] = composition.timeline ?? legacyScenes;
  const sceneItems = timelineSpec.filter((item): item is SceneSpec => !("kind" in item));

  let now = 0;
  const timelineItems: Array<Record<string, unknown>> = [];
  const outScenes: Script["scenes"] = [];
  const segmentKeyCounts: Record<string, number> = {};
  const segmentPathsForConcat: string[] = [];
  const narrationSegmentClips: Array<Record<string, unknown>> = [];
  const cueStartIndex: Record<string, number> = {};
  const cueSceneIndex: Record<string, string> = {};
  const sceneStartIndex: Record<string, number> = {};

  const audioOutPath = audioOut ? resolve(audioOut) : null;
  const publicSegmentsDir = audioOutPath && audioOutPath.split(sep).includes("public")
    ? join(dirname(audioOutPath), composition.id, "env", currentEnv, "segments")
    : null;
  if (publicSegmentsDir) {
    ensureDir(publicSegmentsDir);
  }

  if (leadInSec > 0) {
    if (sceneItems.some((scene) => scene.time)) {
      throw new CompileError("voiceover.leadInSeconds is only supported when scene times are omitted");
    }
    now = leadInSec;
    timelineItems.push({ type: "lead_in", startSec: 0, endSec: now, seconds: now });

    if (!dryRunMode) {
      // Generate silence audio file for lead-in
      const silenceKey = hashKey({ kind: "silence", durationSec: leadInSec, sampleRateHz });
      const silencePath = join(segmentsDir, `silence-${safePrefix(silenceKey)}.wav`);
      if (!existsSync(silencePath)) {
        writeSilenceWav(silencePath, leadInSec, sampleRateHz);
      }
      segmentPathsForConcat.push(silencePath);
    }
  }

  const recordUsageEvent = (entry: Omit<UsageEntry, "timestamp">) => {
    if (!usageLedger) {
      return;
    }
    const estimatedCost = estimateUsageCost(entry, rateCard);
    recordUsage(usageLedger, { ...entry, estimatedCost });
  };

  for (const scene of sceneItems) {
    if (scene.time?.start != null && scene.time.end == null) {
      throw new CompileError(
        `Scene "${scene.id}" has an open-ended duration. Live mode only: export requires an explicit end or duration.`,
      );
    }
    const sceneStart = scene.time
      ? scene.time.startIsRelative
        ? now + (scene.time.start ?? 0)
        : scene.time.start
      : now;
    if (scene.time?.start != null && !scene.time.startIsRelative && sceneStart > now) {
      now = sceneStart;
    }
    const cuesOut: Script["scenes"][number]["cues"] = [];

    for (let idx = 0; idx < scene.items.length; idx += 1) {
      const item = scene.items[idx];
      if (idx > 0) {
        const pauseSpec = normalizePauseSpec(voiceover.pauseBetweenItems);
        if (pauseSpec) {
          const pause = samplePause(pauseSpec, rng);
          if (pause > 0) {
            const start = now;
            now += pause;
            timelineItems.push({ type: "pause", sceneId: scene.id, startSec: start, endSec: now, seconds: pause });

            if (!dryRunMode) {
              // Generate silence audio file for this pause
              const silenceKey = hashKey({ kind: "silence", durationSec: pause, sampleRateHz });
              const silencePath = join(segmentsDir, `silence-${safePrefix(silenceKey)}.wav`);
              if (!existsSync(silencePath)) {
                writeSilenceWav(silencePath, pause, sampleRateHz);
              }
              segmentPathsForConcat.push(silencePath);
            }
          }
        }
      }

      if (item.kind === "pause") {
        const pauseSec = samplePause(item, rng);
        const start = now;
        now += pauseSec;
        timelineItems.push({ type: "pause", sceneId: scene.id, startSec: start, endSec: now, seconds: pauseSec });

        if (!dryRunMode) {
          if (!dryRunMode) {
            // Generate silence audio file for this pause
            const silenceKey = hashKey({ kind: "silence", durationSec: pauseSec, sampleRateHz });
            const silencePath = join(segmentsDir, `silence-${safePrefix(silenceKey)}.wav`);
            if (!existsSync(silencePath)) {
              writeSilenceWav(silencePath, pauseSec, sampleRateHz);
            }
            segmentPathsForConcat.push(silencePath);
          }
        }

        continue;
      }

      const cue = item;
      const start = now;
      const cueSegments: Array<Record<string, unknown>> = [];

      for (let segIndex = 0; segIndex < cue.segments.length; segIndex += 1) {
        const segSpec = cue.segments[segIndex];
        if (segSpec.kind === "pause") {
          const pauseSec = samplePause(segSpec.pause, rng);
          const segStart = now;
          now += pauseSec;
          cueSegments.push({ type: "pause", startSec: segStart, endSec: now, seconds: pauseSec });

          // Generate silence audio file for this pause
          const silenceKey = hashKey({ kind: "silence", durationSec: pauseSec, sampleRateHz });
          const silencePath = join(segmentsDir, `silence-${safePrefix(silenceKey)}.wav`);
          if (!existsSync(silencePath)) {
            writeSilenceWav(silencePath, pauseSec, sampleRateHz);
          }
          segmentPathsForConcat.push(silencePath);

          continue;
        }

        const trimEndCfg = segSpec.trimEndSec ?? defaultTrimEnd ?? 0;
        const segKey = hashKey({
          kind: "tts",
          sceneId: scene.id,
          cueId: cue.id,
          text: segSpec.text,
          trimEndSec: trimEndCfg,
          ctx: ttsContext,
        });
        let duration: number;
        let segPath: string | null = null;

        if (dryRunMode) {
          const wpm = (provider as { wpm?: number }).wpm ?? 165;
          duration = estimateDurationSec(segSpec.text, wpm);
        } else {
          segmentKeyCounts[segKey] = (segmentKeyCounts[segKey] ?? 0) + 1;
          const occurrence = segmentKeyCounts[segKey];
          const ttsExt = providerName === "elevenlabs" ? ".mp3" : ".wav";
          segPath = join(segmentsDir, `${scene.id}--${cue.id}--tts--${safePrefix(segKey)}--${occurrence}${ttsExt}`);

          const cached = resolveCachedSegment(outDir, currentEnv, segKey, scene.id, cue.id, occurrence, ttsExt, _log);
          // Verify the cached file actually exists before using it
          const cacheValid = providerName !== "auritus" && cached.path && !fresh && existsSync(cached.path);
          if (cacheValid) {
            segPath = cached.path!;
            const manifestDuration = getManifestDuration(manifest, "segments", segPath, segKey);
            const probedDuration = probeDurationSec(segPath);
            duration = probedDuration;
            if (cached.env !== currentEnv) {
              _log(`tts: fallback scene=${scene.id} cue=${cue.id} seg=${segIndex + 1} using env=${cached.env}`);
            } else if (verboseLogs) {
              _log(`tts: cache scene=${scene.id} cue=${cue.id} seg=${segIndex + 1} key=${safePrefix(segKey).slice(0, 8)}`);
            }
            if (manifestDuration == null || Math.abs(manifestDuration - probedDuration) > 0.02) {
              setManifestEntry(manifest, "segments", segPath, segKey, probedDuration, {
                provider: providerName,
                sceneId: scene.id,
                cueId: cue.id,
                text: segSpec.text,
                sample_rate_hz: sampleRateHz,
                format: segPath.split(".").pop(),
                rawDurationSec: probedDuration,
                trimEndSec: 0,
              });
            }
          } else {
            // Log if cache entry exists but file is missing
            if (cached.path && !fresh && !existsSync(cached.path)) {
              _log(`tts: cache miss scene=${scene.id} cue=${cue.id} seg=${segIndex + 1} (manifest entry exists but file missing)`);
            }
            _log(`tts: synth scene=${scene.id} cue=${cue.id} seg=${segIndex + 1} -> ${segPath.split(sep).pop()}`);
            try {
              const seg = await provider.synthesize(
                {
                  text: expandText(segSpec.text),
                  voice: selectedVoice,
                  model: voiceover.model ?? null,
                  format: voiceover.format ?? "wav",
                  sampleRateHz,
                  extra: { ...(effectivePronunciationLocators ? { pronunciation_dictionary_locators: effectivePronunciationLocators } : {}), speed: selectedSpeed, seed: selectedSeed },
                },
                segPath,
              );
              recordUsageEvent({
                kind: "tts",
                unitType: "chars",
                quantity: segSpec.text.length,
                provider: providerName,
                compositionId: composition.id,
                sceneId: scene.id,
                cueId: cue.id,
                segmentIndex: segIndex,
                model: resolvedModel,
                voice: resolvedVoice,
                env: currentEnv,
              });
              duration = seg.durationSec;
              didSynthesize = true;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              throw new CompileError(
                `${message}\n\nLocation: ${dslPath}\n  Scene: ${scene.id}\n  Cue: ${cue.id}\n  Segment: ${segIndex + 1}`,
              );
            }
          }
        }

        const maxSeg = voiceover.maxTtsSegmentSeconds ?? 180;
        if (!dryRunMode && duration > maxSeg) {
          if (!segPath) {
            throw new CompileError(
              `Missing segment path for TTS regeneration.\n\nLocation: ${dslPath}\n  Scene: ${scene.id}\n  Cue: ${cue.id}\n  Segment: ${segIndex + 1}`,
            );
          }
          _log(`tts: corrupt-duration scene=${scene.id} cue=${cue.id} seg=${segIndex + 1} duration=${duration.toFixed(1)}s -> regen`);
          const seg = await provider.synthesize(
            {
              text: expandText(segSpec.text),
              voice: selectedVoice,
              model: voiceover.model ?? null,
              format: voiceover.format ?? "wav",
              sampleRateHz,
              extra: { ...(effectivePronunciationLocators ? { pronunciation_dictionary_locators: effectivePronunciationLocators } : {}), speed: selectedSpeed, seed: selectedSeed },
            },
            segPath,
          );
          recordUsageEvent({
            kind: "tts",
            unitType: "chars",
            quantity: segSpec.text.length,
            provider: providerName,
            compositionId: composition.id,
            sceneId: scene.id,
            cueId: cue.id,
            segmentIndex: segIndex,
            model: resolvedModel,
            voice: resolvedVoice,
            env: currentEnv,
          });
          duration = seg.durationSec;
          didSynthesize = true;
        }

        let trimEnd = 0;
        if (!dryRunMode && trimEndCfg > 0 && segPath) {
          const trailing = estimateTrailingSilenceSec(segPath, sampleRateHz, 80, 6.0);
          const safety = 0.08;
          trimEnd = trailing >= (trimEndCfg + safety) ? trimEndCfg : 0;
        }
        const effectiveDuration = trimEnd > 0 ? Math.max(0, duration - trimEnd) : duration;
        if (segPath) {
          setManifestEntry(manifest, "segments", segPath, segKey, effectiveDuration, {
            provider: providerName,
            sceneId: scene.id,
            cueId: cue.id,
            text: segSpec.text,
            sample_rate_hz: sampleRateHz,
            format: segPath.split(".").pop(),
            rawDurationSec: duration,
            trimEndSec: trimEnd,
          });
        }

        const segStart = now;
        const segEnd = segStart + effectiveDuration;
        now = segEnd;

        let concatPath: string | null = null;
        if (segPath) {
          concatPath = trimEnd > 0
            ? ensureTrimmed(segPath, envCacheDir, effectiveDuration, sampleRateHz, fresh)
            : segPath;
          segmentPathsForConcat.push(concatPath);
        }

        if (publicSegmentsDir && concatPath) {
          const staged = join(publicSegmentsDir, concatPath.split(sep).pop() ?? "segment.wav");
          copyFileSync(concatPath, staged);
          narrationSegmentClips.push({
            id: staged.split(sep).pop()?.replace(/\.[^.]+$/, "") ?? "segment",
            kind: "file",
            startSec: segStart,
            durationSec: effectiveDuration,
            src: toPublicPath(staged),
            volume: 1.0,
            sceneId: scene.id,
            cueId: cue.id,
          });
        }

        cueSegments.push({
          type: "tts",
          startSec: segStart,
          endSec: segEnd,
          text: segSpec.text,
          segmentPath: segPath ?? undefined,
          durationSec: effectiveDuration,
          rawDurationSec: duration,
          trimEndSec: trimEnd,
        });
      }

      const end = now;
      cuesOut.push({
        id: cue.id,
        label: cue.label,
        startSec: start,
        endSec: end,
        text: cue.segments.filter(isTextSegment).map((s) => s.text).join(" ").trim(),
        bullets: cue.bullets.map(makeBullet),
        markup: cue.markup,
        segments: cueSegments.map(seg => ({
          type: seg.type as "tts" | "pause",
          startSec: seg.startSec as number,
          endSec: seg.endSec as number,
          text: seg.text as string | undefined,
          durationSec: seg.seconds as number | undefined,
        })),
      });
      if (cueStartIndex[cue.id] != null) {
        throw new CompileError(`Duplicate cue id across scenes: "${cue.id}"`);
      }
      cueStartIndex[cue.id] = start;
      cueSceneIndex[cue.id] = scene.id;
      timelineItems.push({ type: "tts", sceneId: scene.id, cueId: cue.id, startSec: start, endSec: end, segments: cueSegments });
    }

    if (!cuesOut.length && scene.time?.end == null) {
      throw new CompileError(`Scene "${scene.id}" has no cues and no explicit end/duration`);
    }

    const sceneEndHint = scene.time?.end != null
      ? scene.time.startIsRelative
        ? sceneStart + (scene.time.end - (scene.time.start ?? 0))
        : scene.time.end
      : null;
    now = Math.max(now, sceneEndHint ?? now);
    // Inject sceneStartSec into component props
    const layersWithSceneStart = scene.layers?.map(layer => ({
      ...layer,
      components: layer.components.map(comp => ({
        ...comp,
        props: {
          ...(comp.props || {}),
          sceneStartSec: sceneStart,
        },
      })),
    }));

    outScenes.push({
      id: scene.id,
      title: scene.title,
      startSec: sceneStart,
      endSec: now,
      cues: cuesOut,
      markup: scene.markup,
      styles: scene.styles,
      layers: layersWithSceneStart,
      components: scene.components,
      enter: scene.enter,
      exit: scene.exit,
      transitionToNext: scene.transitionToNext,
    });
    if (sceneStartIndex[scene.id] != null) {
      throw new CompileError(`Duplicate scene id: "${scene.id}"`);
    }
    sceneStartIndex[scene.id] = sceneStart;
  }

  let outSceneById = new Map(outScenes.map((scene) => [scene.id, scene]));
  const timeline: Script["timeline"] = [];
  const DEFAULT_TRANSITION_DURATION_SEC = 1;

  const isSceneItem = (item: TimelineItemSpec): item is SceneSpec => !("kind" in item);
  const isTransitionItem = (item: TimelineItemSpec): item is TransitionSpec =>
    "kind" in item && item.kind === "transition";
  const isMarkItem = (item: TimelineItemSpec): item is MarkSpec => "kind" in item && item.kind === "mark";
  const isNarrationItem = (item: TimelineItemSpec): item is NarrationSpec =>
    "kind" in item && item.kind === "narration";

  const findPrevSceneId = (index: number) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const item = timelineSpec[i];
      if (isSceneItem(item)) return item.id;
    }
    return undefined;
  };

  const findNextSceneId = (index: number) => {
    for (let i = index + 1; i < timelineSpec.length; i += 1) {
      const item = timelineSpec[i];
      if (isSceneItem(item)) return item.id;
    }
    return undefined;
  };

  const getTransitionDurationSeconds = (transition: TransitionSpec): number => {
    let maxAudioEnd = 0;
    if (transition.overflowAudio === "extend" && transition.audio?.length) {
      for (const audio of transition.audio) {
        const offset = audio.time?.start ?? 0;
        let duration = audio.durationSeconds ?? null;
        if (duration == null && audio.time?.start != null && audio.time?.end != null) {
          duration = Math.max(0, audio.time.end - audio.time.start);
        }
        if (duration != null) {
          maxAudioEnd = Math.max(maxAudioEnd, offset + duration);
        }
      }
    }
    if (transition.time?.start != null && transition.time?.end != null) {
      return Math.max(0, transition.time.end - transition.time.start);
    }
    return Math.max(transition.durationSeconds ?? DEFAULT_TRANSITION_DURATION_SEC, maxAudioEnd);
  };

  const shiftBefore: number[] = [];
  const shiftBySceneId = new Map<string, number>();
  let cumulativeShift = 0;

  for (let i = 0; i < timelineSpec.length; i += 1) {
    shiftBefore[i] = cumulativeShift;
    const item = timelineSpec[i];
    if (isSceneItem(item)) {
      shiftBySceneId.set(item.id, cumulativeShift);
      continue;
    }
    if (isTransitionItem(item) && (item.mode ?? "overlap") === "insert") {
      const duration = getTransitionDurationSeconds(item);
      const prevSceneId = findPrevSceneId(i);
      const nextSceneId = findNextSceneId(i);
      let extraShift = duration;
      if (prevSceneId && nextSceneId) {
        const prevScene = outSceneById.get(prevSceneId);
        const nextScene = outSceneById.get(nextSceneId);
        if (prevScene && nextScene) {
          const prevShift = shiftBySceneId.get(prevSceneId) ?? 0;
          const prevEnd = prevScene.endSec + prevShift;
          const nextStart = nextScene.startSec + cumulativeShift;
          extraShift = Math.max(0, prevEnd + duration - nextStart);
        }
      }
      cumulativeShift += extraShift;
    }
  }

  const shiftTiming = (timing: { startSec?: number; endSec?: number } | undefined, delta: number) => {
    if (!timing) return;
    if (timing.startSec != null) timing.startSec += delta;
    if (timing.endSec != null) timing.endSec += delta;
  };

  const shiftComponentTiming = (component: ComponentSpec, delta: number) => {
    if (component.timing) {
      shiftTiming(component.timing, delta);
    }
  };

  const shiftLayerTiming = (layer: LayerSpec, delta: number) => {
    if (layer.timing) {
      shiftTiming(layer.timing, delta);
    }
    for (const component of layer.components ?? []) {
      shiftComponentTiming(component, delta);
    }
  };

  for (const scene of outScenes) {
    const delta = shiftBySceneId.get(scene.id) ?? 0;
    if (!delta) continue;
    scene.startSec += delta;
    scene.endSec += delta;
    for (const cue of scene.cues ?? []) {
      cue.startSec += delta;
      cue.endSec += delta;
      for (const segment of cue.segments ?? []) {
        segment.startSec += delta;
        segment.endSec += delta;
      }
    }
    for (const layer of scene.layers ?? []) {
      shiftLayerTiming(layer as LayerSpec, delta);
    }
    for (const component of scene.components ?? []) {
      shiftComponentTiming(component as ComponentSpec, delta);
    }
  }

  for (const item of timelineItems) {
    const sceneId = (item as { sceneId?: string }).sceneId;
    if (!sceneId) continue;
    const delta = shiftBySceneId.get(sceneId) ?? 0;
    if (!delta) continue;
    if (typeof (item as { startSec?: number }).startSec === "number") {
      (item as { startSec?: number }).startSec! += delta;
    }
    if (typeof (item as { endSec?: number }).endSec === "number") {
      (item as { endSec?: number }).endSec! += delta;
    }
    if (Array.isArray((item as { segments?: Array<{ startSec: number; endSec: number }> }).segments)) {
      for (const segment of (item as { segments: Array<{ startSec: number; endSec: number }> }).segments) {
        segment.startSec += delta;
        segment.endSec += delta;
      }
    }
  }

  for (const clip of narrationSegmentClips) {
    const sceneId = (clip as { sceneId?: string }).sceneId;
    if (!sceneId) continue;
    const delta = shiftBySceneId.get(sceneId) ?? 0;
    if (!delta) continue;
    if (typeof (clip as { startSec?: number }).startSec === "number") {
      (clip as { startSec?: number }).startSec! += delta;
    }
  }

  for (const key of Object.keys(cueStartIndex)) {
    delete cueStartIndex[key];
  }
  for (const scene of outScenes) {
    for (const cue of scene.cues ?? []) {
      cueStartIndex[cue.id] = cue.startSec;
    }
  }

  for (let i = 0; i < timelineSpec.length; i += 1) {
    const item = timelineSpec[i];
    if (!isNarrationItem(item)) continue;
    const shift = shiftBefore[i] ?? 0;
    const narrationSceneId = `narration:${item.id}`;
    let narrationStart = item.time?.start != null ? item.time.start + shift : null;
    if (narrationStart == null) {
      const nextSceneId = findNextSceneId(i);
      const nextScene = nextSceneId ? outSceneById.get(nextSceneId) : null;
      narrationStart = nextScene?.startSec ?? null;
    }
    if (narrationStart == null) {
      throw new CompileError(`Narration "${item.id}" requires a start time or a following scene.`);
    }
    let narrationNow = narrationStart;

    for (let idx = 0; idx < item.items.length; idx += 1) {
      const entry = item.items[idx];
      if (idx > 0) {
        const pauseSpec = normalizePauseSpec(voiceover.pauseBetweenItems);
        if (pauseSpec) {
          const pause = samplePause(pauseSpec, rng);
          if (pause > 0) {
            const start = narrationNow;
            narrationNow += pause;
            timelineItems.push({
              type: "pause",
              sceneId: narrationSceneId,
              startSec: start,
              endSec: narrationNow,
              seconds: pause,
            });
          }
        }
      }

      if (entry.kind === "pause") {
        const pauseSec = samplePause(entry, rng);
        const start = narrationNow;
        narrationNow += pauseSec;
        timelineItems.push({
          type: "pause",
          sceneId: narrationSceneId,
          startSec: start,
          endSec: narrationNow,
          seconds: pauseSec,
        });
        continue;
      }

      const cue = entry;
      const start = narrationNow;
      const cueSegments: Array<Record<string, unknown>> = [];

      for (let segIndex = 0; segIndex < cue.segments.length; segIndex += 1) {
        const segSpec = cue.segments[segIndex];
        if (segSpec.kind === "pause") {
          const pauseSec = samplePause(segSpec.pause, rng);
          const segStart = narrationNow;
          narrationNow += pauseSec;
          cueSegments.push({ type: "pause", startSec: segStart, endSec: narrationNow, seconds: pauseSec });
          continue;
        }

        const trimEndCfg = segSpec.trimEndSec ?? defaultTrimEnd ?? 0;
        const segKey = hashKey({
          kind: "tts",
          sceneId: narrationSceneId,
          cueId: cue.id,
          text: segSpec.text,
          trimEndSec: trimEndCfg,
          ctx: ttsContext,
        });
        let duration: number;
        let segPath: string | null = null;

        if (dryRunMode) {
          const wpm = (provider as { wpm?: number }).wpm ?? 165;
          duration = estimateDurationSec(segSpec.text, wpm);
        } else {
          segmentKeyCounts[segKey] = (segmentKeyCounts[segKey] ?? 0) + 1;
          const occurrence = segmentKeyCounts[segKey];
          const ttsExt = providerName === "elevenlabs" ? ".mp3" : ".wav";
          segPath = join(
            segmentsDir,
            `${narrationSceneId}--${cue.id}--tts--${safePrefix(segKey)}--${occurrence}${ttsExt}`,
          );

          const cached = resolveCachedSegment(
            outDir,
            currentEnv,
            segKey,
            narrationSceneId,
            cue.id,
            occurrence,
            ttsExt,
            _log,
          );
          const cacheValid = providerName !== "auritus" && cached.path && !fresh && existsSync(cached.path);
          if (cacheValid) {
            segPath = cached.path!;
            const manifestDuration = getManifestDuration(manifest, "segments", segPath, segKey);
            const probedDuration = probeDurationSec(segPath);
            duration = probedDuration;
            if (cached.env !== currentEnv) {
              _log(`tts: fallback scene=${narrationSceneId} cue=${cue.id} seg=${segIndex + 1} using env=${cached.env}`);
            } else if (verboseLogs) {
              _log(
                `tts: cache scene=${narrationSceneId} cue=${cue.id} seg=${segIndex + 1} key=${safePrefix(segKey).slice(0, 8)}`,
              );
            }
            if (manifestDuration != null) {
              duration = manifestDuration;
            } else if (duration != null) {
              setManifestEntry(manifest, "segments", segPath, segKey, duration, {
                provider: providerName,
                sceneId: narrationSceneId,
                cueId: cue.id,
                text: segSpec.text,
                sample_rate_hz: sampleRateHz,
                format: segPath.split(".").pop(),
                rawDurationSec: duration,
                trimEndSec: trimEndCfg,
              });
            }
          } else {
            if (cached.path) {
              _log(`tts: cache miss scene=${narrationSceneId} cue=${cue.id} seg=${segIndex + 1} (manifest entry exists but file missing)`);
            }
            _log(`tts: synth scene=${narrationSceneId} cue=${cue.id} seg=${segIndex + 1} -> ${segPath.split(sep).pop()}`);
            if (!segPath) {
              throw new CompileError(
                `Missing segment path for TTS regeneration.\n\nLocation: ${dslPath}\n  Narration: ${item.id}\n  Cue: ${cue.id}\n  Segment: ${segIndex + 1}`,
              );
            }
            if (!provider?.synthesize) {
              throw new CompileError(
                `TTS provider "${providerName}" does not support synthesis.\n\nLocation: ${dslPath}\n  Narration: ${item.id}\n  Cue: ${cue.id}\n  Segment: ${segIndex + 1}`,
              );
            }
            ensureDir(dirname(segPath));
            const seg = await provider.synthesize(
              {
                text: expandText(segSpec.text),
                voice: selectedVoice,
                model: voiceover.model ?? null,
                format: voiceover.format ?? "wav",
                sampleRateHz,
                extra: { ...(effectivePronunciationLocators ? { pronunciation_dictionary_locators: effectivePronunciationLocators } : {}), speed: selectedSpeed, seed: selectedSeed },
              },
              segPath,
            );
            duration = seg.durationSec ?? probeDurationSec(segPath);
            if (!duration || !Number.isFinite(duration)) {
              throw new CompileError(
                `TTS provider returned invalid duration.\n\nLocation: ${dslPath}\n  Narration: ${item.id}\n  Cue: ${cue.id}\n  Segment: ${segIndex + 1}`,
              );
            }
            if (duration < 0.01) {
              _log(
                `tts: corrupt-duration scene=${narrationSceneId} cue=${cue.id} seg=${segIndex + 1} duration=${duration.toFixed(1)}s -> regen`,
              );
              unlinkSync(segPath);
              segIndex -= 1;
              continue;
            }
            setManifestEntry(manifest, "segments", segPath, segKey, duration, {
              provider: providerName,
              sceneId: narrationSceneId,
              cueId: cue.id,
              text: segSpec.text,
              sample_rate_hz: sampleRateHz,
              format: segPath.split(".").pop(),
              rawDurationSec: duration,
              trimEndSec: trimEndCfg,
            });
          }
        }

        const effectiveDuration = duration - Math.max(0, trimEndCfg);
        const segStart = narrationNow;
        const segEnd = segStart + effectiveDuration;
        narrationNow = segEnd;

        let concatPath: string | null = null;
        if (segPath) {
          concatPath = trimEndCfg > 0
            ? ensureTrimmed(segPath, envCacheDir, effectiveDuration, sampleRateHz, fresh)
            : segPath;
        }

        if (publicSegmentsDir && concatPath) {
          const staged = join(publicSegmentsDir, concatPath.split(sep).pop() ?? "segment.wav");
          copyFileSync(concatPath, staged);
          narrationSegmentClips.push({
            id: staged.split(sep).pop()?.replace(/\.[^.]+$/, "") ?? "segment",
            kind: "file",
            startSec: segStart,
            durationSec: effectiveDuration,
            src: toPublicPath(staged),
            volume: 1.0,
            sceneId: narrationSceneId,
            cueId: cue.id,
          });
        }

        cueSegments.push({
          type: "tts",
          startSec: segStart,
          endSec: segEnd,
          text: segSpec.text,
          segmentPath: segPath ?? undefined,
          durationSec: effectiveDuration,
          rawDurationSec: duration,
          trimEndSec: trimEndCfg,
        });
      }

      const end = narrationNow;
      if (cueStartIndex[cue.id] != null) {
        throw new CompileError(`Duplicate cue id across scenes/narration: "${cue.id}"`);
      }
      cueStartIndex[cue.id] = start;
      timelineItems.push({
        type: "tts",
        sceneId: narrationSceneId,
        cueId: cue.id,
        startSec: start,
        endSec: end,
        segments: cueSegments,
      });
    }
  }

  outSceneById = new Map(outScenes.map((scene) => [scene.id, scene]));

  const buildTransitionTimelineItem = (
    transition: Pick<
      TransitionSpec,
      | "id"
      | "time"
      | "effect"
      | "ease"
      | "props"
      | "mode"
      | "overflow"
      | "overflowAudio"
      | "styles"
      | "markup"
      | "layers"
      | "components"
      | "durationSeconds"
      | "audio"
    >,
    prevSceneId?: string,
    nextSceneId?: string,
  ): TransitionTimelineItem => {
    const prevScene = prevSceneId ? outSceneById.get(prevSceneId) : undefined;
    const nextScene = nextSceneId ? outSceneById.get(nextSceneId) : undefined;
    const durationSeconds = getTransitionDurationSeconds(transition as TransitionSpec);
    const mode: TransitionSpec["mode"] =
      transition.mode ?? (prevScene && nextScene ? "overlap" : "insert");
    const startSec =
      transition.time?.start != null
        ? transition.time.start
        : mode === "overlap" && prevScene
          ? Math.max(0, prevScene.endSec - durationSeconds)
          : prevScene?.endSec ?? 0;
    const endSec = transition.time?.end ?? startSec + durationSeconds;

    if (mode === "overlap" && nextScene && startSec < nextScene.startSec) {
      nextScene.startSec = startSec;
    }

    return {
      kind: "transition",
      id: transition.id,
      startSec,
      endSec,
      effect: transition.effect,
      ease: transition.ease,
      props: transition.props,
      mode,
      overflow: transition.overflow,
      overflowAudio: transition.overflowAudio,
      fromSceneId: prevSceneId,
      toSceneId: nextSceneId,
      styles: transition.styles,
      markup: transition.markup,
      layers: transition.layers,
      components: transition.components,
    };
  };

  for (let i = 0; i < timelineSpec.length; i += 1) {
    const item = timelineSpec[i];
    if (isSceneItem(item)) {
      const sceneOut = outSceneById.get(item.id);
      if (!sceneOut) continue;
      timeline.push({
        kind: "scene",
        sceneId: sceneOut.id,
        startSec: sceneOut.startSec,
        endSec: sceneOut.endSec,
      });

      const nextItem = timelineSpec[i + 1];
      if (item.transitionToNext && (!nextItem || !isTransitionItem(nextItem))) {
        const nextSceneId = findNextSceneId(i);
        timeline.push(
          buildTransitionTimelineItem(
            {
              id: `${item.id}__to_next`,
              effect: item.transitionToNext.effect,
              ease: item.transitionToNext.ease,
              props: item.transitionToNext.props,
              durationSeconds: item.transitionToNext.durationSeconds,
            },
            item.id,
            nextSceneId,
          ),
        );
      }
      continue;
    }
    if (isTransitionItem(item)) {
      const prevSceneId = findPrevSceneId(i);
      const nextSceneId = findNextSceneId(i);
      const shift = shiftBefore[i] ?? 0;
      const adjustedTransition = item.time
        ? {
            ...item,
            time: {
              start: item.time.start + shift,
              end: item.time.end != null ? item.time.end + shift : item.time.end,
            },
          }
        : item;
      timeline.push(buildTransitionTimelineItem(adjustedTransition, prevSceneId, nextSceneId));
      continue;
    }
    if (isMarkItem(item)) {
      const shift = shiftBefore[i] ?? 0;
      timeline.push({ kind: "mark", id: item.id, atSec: item.at + shift });
    }
  }

  const script: Script = {
    scenes: outScenes,
    timeline,
    posterTimeSec: composition.posterTime ?? null,
    fps: composition.meta?.fps,
    meta: composition.meta,
  };
  for (const scene of outScenes) {
    sceneStartIndex[scene.id] = scene.startSec;
  }
  const markStartIndex: Record<string, number> = {};
  for (const item of timeline ?? []) {
    if (item.kind === "mark") {
      markStartIndex[item.id] = item.atSec;
    }
  }
  const sceneEndIndex: Record<string, number> = {};
  for (const scene of outScenes) {
    sceneEndIndex[scene.id] = scene.endSec;
  }
  const totalEndSec = outScenes.length ? outScenes[outScenes.length - 1].endSec : 0;

  ensureDir(dirname(scriptOut));
  writeFileSync(scriptOut, JSON.stringify({ ...scriptToJson(script), ...(selectedProvider === "dry-run" ? { simulated: true } : {}) }, null, 2) + "\n", "utf-8");
  if (verboseLogs) {
    _log(`write: script=${scriptOut} duration_seconds=${totalEndSec.toFixed(2)}`);
  }

  const transitionWindowById = new Map<string, { startSec: number; endSec: number; overflowAudio?: TransitionSpec["overflowAudio"] }>();
  for (const item of timeline ?? []) {
    if (item.kind === "transition") {
      transitionWindowById.set(item.id, {
        startSec: item.startSec,
        endSec: item.endSec,
        overflowAudio: item.overflowAudio,
      });
    }
  }

  const audioElementClips: AudioClipSpec[] = [];
  const pushAudioElements = (
    elements: AudioElementSpec[] | undefined,
    containerStartSec: number,
    window?: { startSec: number; endSec: number; overflowAudio?: TransitionSpec["overflowAudio"] },
  ) => {
    if (!elements) return;
    for (const element of elements) {
      const offset = element.time?.start ?? 0;
      const absoluteStart = containerStartSec + offset;
      let durationSeconds = element.durationSeconds ?? null;
      if (durationSeconds == null && element.time?.start != null && element.time?.end != null) {
        durationSeconds = Math.max(0, element.time.end - element.time.start);
      }
      if (window?.overflowAudio === "clip" && window.endSec != null) {
        const maxDuration = Math.max(0, window.endSec - absoluteStart);
        durationSeconds = durationSeconds == null ? maxDuration : Math.min(durationSeconds, maxDuration);
      }
      if (durationSeconds === 0) {
        continue;
      }
      audioElementClips.push({
        id: element.id,
        kind: element.kind,
        start: { kind: "absolute", sec: absoluteStart },
        volume: element.volume,
        fadeTo: element.fadeTo,
        fadeOut: element.fadeOut,
        sourceId: element.sourceId,
        playThrough: element.playThrough,
        src: element.src,
        prompt: element.prompt,
        durationSeconds: durationSeconds ?? undefined,
        variants: element.variants,
        pick: element.pick,
        modelId: element.modelId,
        forceInstrumental: element.forceInstrumental,
      });
    }
  };

  for (const scene of sceneItems) {
    const sceneOut = outSceneById.get(scene.id);
    if (!sceneOut) continue;
    pushAudioElements(scene.audio, sceneOut.startSec);
  }

  for (const item of timelineSpec) {
    if (isTransitionItem(item) && item.audio?.length) {
      const window = transitionWindowById.get(item.id);
      const startSec = window?.startSec ?? 0;
      pushAudioElements(item.audio, startSec, window);
    }
  }

  const derivedAudioPlan: AudioPlan | null = audioElementClips.length
    ? { tracks: [] }
    : null;
  if (derivedAudioPlan) {
    for (const clip of audioElementClips) {
      const trackId = clip.kind;
      let track = derivedAudioPlan.tracks.find((t) => t.id === trackId);
      if (!track) {
        track = { id: trackId, kind: trackId, clips: [] };
        derivedAudioPlan.tracks.push(track);
      }
      track.clips.push(clip);
    }
  }

  const effectiveAudioPlan = mergeAudioPlans(composition.audioPlan, derivedAudioPlan);

  const audioTracksOut: Array<Record<string, unknown>> = [];
  if (narrationSegmentClips.length) {
    const narrationClips = narrationSegmentClips.map((clip) => {
      const { sceneId, cueId, ...rest } = clip as Record<string, unknown>;
      return rest;
    });
    audioTracksOut.push({ id: "narration", kind: "narration", clips: narrationClips });
  }

  if (effectiveAudioPlan) {
    const sfxSelections = loadSelections(outDir);
    const defaultSfxProvider = sfxProviderOverride
      ?? composition.audioProviders?.sfx
      ?? effectiveAudioPlan.sfxProvider
      ?? getDefaultSfxProvider(config)
      ?? "dry-run";
    const defaultMusicProvider = musicProviderOverride
      ?? composition.audioProviders?.music
      ?? effectiveAudioPlan.musicProvider
      ?? getDefaultMusicProvider(config)
      ?? "dry-run";

    let sfxProvider: ReturnType<typeof getSfxProvider> | null = null;
    let musicProvider: ReturnType<typeof getMusicProvider> | null = null;

    try {
      sfxProvider = getSfxProvider(defaultSfxProvider, config);
    } catch (err) {
      _log(`audio: WARNING: ${(err as Error).message}. SFX generation will be skipped.`);
      sfxProvider = null;
    }

    try {
      musicProvider = getMusicProvider(defaultMusicProvider, config);
    } catch (err) {
      _log(`audio: WARNING: ${(err as Error).message}. Music generation will be skipped.`);
      musicProvider = null;
    }

    if (verboseLogs) {
      _log(`audio: sfx_provider=${sfxProvider ? defaultSfxProvider : "none"} music_provider=${musicProvider ? defaultMusicProvider : "none"}`);
    }

    const sfxOutDir = join(envCacheDir, "sfx");
    const musicOutDir = join(envCacheDir, "music");
    ensureDir(sfxOutDir);
    ensureDir(musicOutDir);

    const publicSfxDir = audioOutPath && audioOutPath.split(sep).includes("public") ? join(dirname(audioOutPath), "env", currentEnv, "sfx") : null;
    const publicMusicDir = audioOutPath && audioOutPath.split(sep).includes("public") ? join(dirname(audioOutPath), "env", currentEnv, "music") : null;
    if (publicSfxDir) ensureDir(publicSfxDir);
    if (publicMusicDir) ensureDir(publicMusicDir);

    for (const track of effectiveAudioPlan.tracks) {
      const clipsOut: Array<Record<string, unknown>> = [];
      for (const clip of track.clips) {
        const startSec = resolveStart(clip.start, cueStartIndex, sceneStartIndex, markStartIndex);
        if (clip.kind === "file") {
          const durationForFades = clip.fadeTo || clip.fadeOut ? Math.max(0, totalEndSec - startSec) : null;
          const envelope = volumeEnvelopeForClip(clip.volume ?? 1, durationForFades, clip.fadeTo, clip.fadeOut);
          clipsOut.push({
            id: clip.id,
            kind: "file",
            startSec,
            src: clip.src,
            volume: clip.volume ?? 1,
            ...(durationForFades != null ? { durationSec: durationForFades } : {}),
            ...(envelope ? { volumeEnvelope: envelope } : {}),
          });
          continue;
        }

        if (clip.kind === "music") {
          if (!musicProvider) {
            _log(`music: skip clip=${clip.id} (provider not supported)`);
            continue;
          }
          const cacheId = clip.sourceId ?? clip.id;
          const sceneId = resolveSceneForStart(clip.start, startSec, outScenes, cueSceneIndex);
          let desired: number;
          if (clip.durationSeconds != null) {
            desired = clip.durationSeconds;
          } else if (clip.playThrough) {
            desired = totalEndSec - startSec;
          } else {
            if (!sceneId || sceneEndIndex[sceneId] == null) {
              throw new CompileError(`Cannot infer scene duration for music clip "${clip.id}"`);
            }
            desired = sceneEndIndex[sceneId] - startSec;
          }
          if (defaultMusicProvider === "elevenlabs") {
            if (desired > 600) {
              _log(`music: clamp clip=${clip.id} duration_seconds=${desired.toFixed(1)} -> 600.0`);
              desired = 600;
            }
            if (desired < 3) {
              _log(`music: clamp clip=${clip.id} duration_seconds=${desired.toFixed(2)} -> 3.0`);
              desired = 3;
            }
          }
          if (desired <= 0) {
            throw new CompileError(`Non-positive music duration for "${clip.id}" (duration=${desired})`);
          }

          const variants = Math.max(1, clip.variants ?? 1);
          const pick = clip.pick ?? 0;
          if (pick >= variants) {
            throw new CompileError(`music pick out of range for "${clip.id}" (pick=${pick}, variants=${variants})`);
          }

          const generated: Array<Record<string, unknown>> = [];
          const musicExt = defaultMusicProvider === "elevenlabs" ? ".mp3" : ".wav";
          for (let v = 0; v < variants; v += 1) {
            const musicKey = hashKey({
              kind: "music",
              clipId: cacheId,
              variant: v,
              prompt: clip.prompt,
              durationSec: desired,
              model_id: clip.modelId,
              force_instrumental: clip.forceInstrumental,
              provider: defaultMusicProvider,
              seed: voiceover.seed ?? null,
            });
            const seed = parseInt(musicKey.slice(0, 8), 16) % 2147483647;
            let outPath = join(musicOutDir, `${cacheId}--v${v + 1}--${safePrefix(musicKey)}${musicExt}`);
            const cached = resolveCachedMusic(outDir, currentEnv, musicKey, cacheId, v, musicExt, _log);
            let dur: number;
            if (cached.path && !fresh) {
              if (cached.env && cached.env !== currentEnv) {
                _log(`music: fallback clip=${clip.id} variant=${v + 1}/${variants} using env=${cached.env}`);
              }
              outPath = cached.path;
              dur = getManifestDuration(manifest, "music", outPath, musicKey) ?? probeDurationSec(outPath);
            } else {
              _log(`music: synth clip=${clip.id} variant=${v + 1}/${variants} seed=${seed} duration_seconds=${desired.toFixed(1)} -> ${outPath.split(sep).pop()}`);
              try {
                const seg = await musicProvider.generate({
                  prompt: clip.prompt ?? "",
                  durationSeconds: desired,
                  sampleRateHz,
                  seed,
                  modelId: clip.modelId ?? null,
                  forceInstrumental: clip.forceInstrumental ?? null,
                }, outPath);
                dur = seg.durationSec;
                didSynthesize = true;
                recordUsageEvent({
                  kind: "music",
                  unitType: "seconds",
                  quantity: seg.durationSec,
                  provider: defaultMusicProvider,
                  compositionId: composition.id,
                  sceneId: sceneId ?? undefined,
                  clipId: clip.id,
                  env: currentEnv,
                  promptChars: clip.prompt?.length ?? 0,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
                _log(`music: synth-failed clip=${clip.id} variant=${v + 1}/${variants} err=${msg}`);
                const existing = findFirstMatch(musicOutDir, `${cacheId}--v${v + 1}--`, musicExt);
                if (existing) {
                  outPath = existing;
                  dur = probeDurationSec(outPath);
                  _log(`music: fallback clip=${clip.id} variant=${v + 1}/${variants} using_cached=${outPath.split(sep).pop()}`);
                } else {
                  dur = desired;
                  _log(`music: fallback clip=${clip.id} variant=${v + 1}/${variants} no_cache=true`);
                }
              }
            }

            if (existsSync(outPath)) {
              setManifestEntry(manifest, "music", outPath, musicKey, dur, {
                provider: defaultMusicProvider,
                clipId: cacheId,
                variant: v,
                prompt: clip.prompt,
                durationSecHint: desired,
                model_id: clip.modelId,
                force_instrumental: clip.forceInstrumental,
                format: outPath.split(".").pop(),
              });
            }
            generated.push({ variant: v, seed, path: outPath, durationSec: dur });
          }

          const chosen = generated[pick];
          let chosenSrc: string | null = null;
          const envelope = volumeEnvelopeForClip(clip.volume ?? 1, Number(chosen.durationSec), clip.fadeTo, clip.fadeOut);
          if (publicMusicDir) {
            if (!existsSync(chosen.path as string)) {
              chosenSrc = null;
            } else {
              const stagedDir = join(publicMusicDir, cacheId);
              ensureDir(stagedDir);
              const staged = join(stagedDir, String(chosen.path).split(sep).pop() ?? "music.wav");
              copyFileSync(String(chosen.path), staged);
              cleanupStagedDir(stagedDir, staged.split(sep).pop() ?? "");
              chosenSrc = toPublicPath(staged);
            }
          }

          clipsOut.push({
            id: clip.id,
            kind: "music",
            startSec,
            volume: clip.volume ?? 1,
            prompt: clip.prompt,
            pick,
            variants: generated,
            chosen,
            src: chosenSrc,
            playThrough: Boolean(clip.playThrough),
            ...(envelope ? { volumeEnvelope: envelope } : {}),
          });
          continue;
        }

        if (clip.kind === "sfx") {
          if (!sfxProvider) {
            _log(`sfx: skip clip=${clip.id} (provider not supported)`);
            continue;
          }
          const variants = Math.max(1, clip.variants ?? 1);
          const pick = sfxSelections.picks[clip.id] ?? (clip.pick ?? 0);
          if (pick >= variants) {
            throw new CompileError(`sfx pick out of range for "${clip.id}" (pick=${pick}, variants=${variants})`);
          }
          const cacheId = clip.sourceId ?? clip.id;
          const sfxCtx = {
            provider: defaultSfxProvider,
            sample_rate_hz: sampleRateHz,
            provider_ctx: defaultSfxProvider === "elevenlabs"
              ? {
                  base_url: (sfxProvider as { baseUrl?: string }).baseUrl ?? null,
                  model_id: (sfxProvider as { modelId?: string }).modelId ?? null,
                  prompt_influence: (sfxProvider as { promptInfluence?: number }).promptInfluence ?? null,
                  loop: (sfxProvider as { loop?: boolean }).loop ?? null,
                }
              : {},
          };
          const sfxExt = defaultSfxProvider === "elevenlabs" ? ".mp3" : ".wav";
          const generated: Array<Record<string, unknown>> = [];
          const sfxSceneId = resolveSceneForStart(clip.start, startSec, outScenes, cueSceneIndex);

          for (let v = 0; v < variants; v += 1) {
            const sfxKey = hashKey({
              kind: "sfx",
              clipId: cacheId,
              variant: v,
              prompt: clip.prompt,
              durationSec: clip.durationSeconds ?? null,
              ctx: sfxCtx,
              seed: voiceover.seed ?? null,
            });
            const seed = parseInt(sfxKey.slice(0, 8), 16) % 2147483647;
            let outPath = join(sfxOutDir, `${cacheId}--v${v + 1}--${safePrefix(sfxKey)}${sfxExt}`);
            const cached = resolveCachedSfx(outDir, currentEnv, sfxKey, cacheId, v, sfxExt, _log);
            let dur: number;
            if (cached.path && !fresh) {
              if (cached.env && cached.env !== currentEnv) {
                _log(`sfx: fallback clip=${clip.id} variant=${v + 1}/${variants} using env=${cached.env}`);
              }
              outPath = cached.path;
              dur = getManifestDuration(manifest, "sfx", outPath, sfxKey) ?? probeDurationSec(outPath);
            } else {
              _log(`sfx: synth clip=${clip.id} variant=${v + 1}/${variants} seed=${seed} -> ${outPath.split(sep).pop()}`);
              const seg = await sfxProvider.generate({
                prompt: clip.prompt ?? "",
                durationSec: clip.durationSeconds ?? null,
                sampleRateHz,
                seed,
              }, outPath);
              dur = seg.durationSec;
              didSynthesize = true;
              recordUsageEvent({
                kind: "sfx",
                unitType: "seconds",
                quantity: seg.durationSec,
                provider: defaultSfxProvider,
                compositionId: composition.id,
                sceneId: sfxSceneId ?? undefined,
                clipId: clip.id,
                env: currentEnv,
                promptChars: clip.prompt?.length ?? 0,
              });
            }
            setManifestEntry(manifest, "sfx", outPath, sfxKey, dur, {
              provider: defaultSfxProvider,
              clipId: clip.id,
              variant: v,
              prompt: clip.prompt,
              durationSecHint: clip.durationSeconds,
              sample_rate_hz: sampleRateHz,
              format: outPath.split(".").pop(),
            });
            generated.push({ variant: v, seed, path: outPath, durationSec: dur });
          }

          const chosen = generated[pick];
          let chosenSrc: string | null = null;
          const envelope = volumeEnvelopeForClip(clip.volume ?? 1, Number(chosen.durationSec), clip.fadeTo, clip.fadeOut);
          if (publicSfxDir) {
            const stagedDir = join(publicSfxDir, clip.id);
            ensureDir(stagedDir);
            const staged = join(stagedDir, String(chosen.path).split(sep).pop() ?? "sfx.wav");
            copyFileSync(String(chosen.path), staged);
            cleanupStagedDir(stagedDir, staged.split(sep).pop() ?? "");
            chosenSrc = toPublicPath(staged);
          }

          clipsOut.push({
            id: clip.id,
            kind: "sfx",
            startSec,
            volume: clip.volume ?? 1,
            prompt: clip.prompt,
            pick,
            selectionPath: selectionPath(outDir),
            variants: generated,
            chosen,
            src: chosenSrc,
            ...(envelope ? { volumeEnvelope: envelope } : {}),
          });
        }
      }
      audioTracksOut.push({ id: track.id, kind: track.kind, clips: clipsOut });
    }
  }

  ensureDir(dirname(timelineOut));
  writeFileSync(timelineOut, JSON.stringify({ items: timelineItems, audio: { tracks: audioTracksOut }, ...(selectedProvider === "dry-run" ? { simulated: true } : {}) }, null, 2) + "\n");
  if (verboseLogs) {
    _log(`write: timeline=${timelineOut} items=${timelineItems.length} tracks=${audioTracksOut.length}`);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (usageLedger && usageLedger.entries.length) {
    const summary = summarizeUsageFile(usageLedger.path);
    const summaryPath = join(dirname(usageLedger.path), "usage-summary.json");
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
    const detailed = summarizeUsageFileDetailed(usageLedger.path);
    const detailedPath = join(dirname(usageLedger.path), "usage-summary-detailed.json");
    writeFileSync(detailedPath, JSON.stringify(detailed, null, 2) + "\n");
    if (verboseLogs) {
      _log(`usage: summary=${summaryPath} detail=${detailedPath} events=${usageLedger.entries.length}`);
    }
  }

  let audioPath: string | null = null;
  if (audioOutPath && segmentPathsForConcat.length > 0) {
    concatAudioFiles(audioOutPath, segmentPathsForConcat);
    audioPath = audioOutPath;
    if (verboseLogs) {
      _log(`write: audio=${audioOutPath} segments=${segmentPathsForConcat.length}`);
    }
  }

  const runArtifacts = writeRunArtifacts({
    envCacheDir,
    env: currentEnv,
    compositionId: composition.id,
    dslPath,
    scriptPath: scriptOut,
    timelinePath: timelineOut,
    audioPath,
  });
  if (verboseLogs) {
    _log(`run: id=${runArtifacts.runId} path=${runArtifacts.runPath}`);
  }

  return {
    script,
    audioPath,
    timelinePath: timelineOut,
    didSynthesize,
    runId: runArtifacts.runId,
    runPath: runArtifacts.runPath,
  };
}

function normalizeManifest(base: Record<string, unknown>): Record<string, any> {
  return {
    version: 1,
    segments: {},
    sfx: {},
    music: {},
    ...base,
  } as Record<string, any>;
}

function setManifestEntry(
  manifest: Record<string, any>,
  section: "segments" | "sfx" | "music",
  path: string,
  key: string,
  durationSec: number,
  meta: Record<string, unknown>,
): void {
  if (!manifest[section] || typeof manifest[section] !== "object") {
    manifest[section] = {};
  }
  manifest[section][path] = { key, durationSec, meta };
}

function providerCacheContext(providerName: string, provider: unknown): Record<string, unknown> {
  if (providerName === "elevenlabs") {
    const p = provider as ElevenLabsTTSProvider;
    return {
      provider: "elevenlabs",
      voice_id: p.voiceId,
      model_id: p.modelId,
      voice_settings: p.voiceSettings ?? null,
      base_url: p.baseUrl,
    };
  }
  if (providerName === "openai") {
    return {
      provider: "openai",
      default_model: (provider as { defaultModel?: string }).defaultModel ?? null,
      default_voice: (provider as { defaultVoice?: string }).defaultVoice ?? null,
      base_url: (provider as { baseUrl?: string }).baseUrl ?? null,
    };
  }
  if (providerName === "aws" || providerName === "aws-polly") {
    return {
      provider: "aws-polly",
      region: (provider as { region?: string }).region ?? null,
      voice_id: (provider as { voiceId?: string }).voiceId ?? null,
      engine: (provider as { engine?: string }).engine ?? null,
      language_code: (provider as { languageCode?: string }).languageCode ?? null,
    };
  }
  if (providerName === "azure" || providerName === "azure-speech") {
    return {
      provider: "azure-speech",
      region: (provider as { region?: string }).region ?? null,
      voice_name: (provider as { voiceName?: string }).voiceName ?? null,
    };
  }
  return { provider: providerName };
}

function mergeAudioPlans(base?: AudioPlan | null, extra?: AudioPlan | null): AudioPlan | null {
  if (!base && !extra) return null;
  if (!base) return extra ?? null;
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    tracks: [...base.tracks, ...extra.tracks],
  };
}

function normalizePauseSpec(value: PauseSpec | number | undefined | null): PauseSpec | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return pauseHelper(value);
  }
  return value;
}

function samplePause(spec: PauseSpec, rng: () => number): number {
  if (spec.mode === "fixed") {
    return Math.max(0, spec.seconds);
  }
  let val = gaussianSample(rng, spec.mean, spec.std);
  if (spec.min != null) {
    val = Math.max(val, spec.min);
  }
  if (spec.max != null) {
    val = Math.min(val, spec.max);
  }
  return Math.max(0, val);
}

function gaussianSample(rng: () => number, mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

function makeRng(seed: number | null): () => number {
  if (seed == null) {
    return () => Math.random();
  }
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function ensureTrimmed(path: string, envCacheDir: string, duration: number, sampleRateHz: number, fresh: boolean): string {
  const trimmedDir = join(envCacheDir, "segments_trimmed");
  ensureDir(trimmedDir);
  const filename = path.split(sep).pop() ?? "segment.wav";
  const trimmed = join(trimmedDir, filename);
  if (!existsSync(trimmed) || fresh) {
    trimAudioToDuration(path, trimmed, duration, sampleRateHz);
  }
  return trimmed;
}

function toPublicPath(path: string): string {
  const parts = path.split(`${sep}public${sep}`);
  if (parts.length < 2) {
    return path;
  }
  const rel = parts[1].replace(/\\/g, "/");
  return rel.startsWith("/") ? rel : `/${rel}`;
}

function resolveStart(
  start: AudioClipSpec["start"],
  cueIndex: Record<string, number>,
  sceneIndex: Record<string, number>,
  markIndex: Record<string, number>,
): number {
  if (start.kind === "absolute") {
    return start.sec;
  }
  if (start.kind === "cue") {
    const base = cueIndex[start.cue.cueId];
    if (base == null) {
      throw new CompileError(`Unknown cue in audio start: "${start.cue.cueId}"`);
    }
    return base + (start.cue.offsetSec ?? 0);
  }
  if (start.kind === "scene") {
    const base = sceneIndex[start.scene.sceneId];
    if (base == null) {
      throw new CompileError(`Unknown scene in audio start: "${start.scene.sceneId}"`);
    }
    return base + (start.scene.offsetSec ?? 0);
  }
  if (start.kind === "mark") {
    const base = markIndex[start.mark.markId];
    if (base == null) {
      throw new CompileError(`Unknown mark in audio start: "${start.mark.markId}"`);
    }
    return base + (start.mark.offsetSec ?? 0);
  }
  throw new CompileError("Unsupported audio start kind");
}

function resolveSceneForStart(
  start: AudioClipSpec["start"],
  startSec: number,
  scenes: Script["scenes"],
  cueSceneIndex: Record<string, string>,
): string | null {
  if (start.kind === "scene") {
    return start.scene.sceneId;
  }
  if (start.kind === "cue") {
    return cueSceneIndex[start.cue.cueId] ?? null;
  }
  for (const scene of scenes) {
    if (scene.startSec - 1e-6 <= startSec && startSec <= scene.endSec + 1e-6) {
      return scene.id;
    }
  }
  return null;
}

function volumeEnvelopeForClip(
  baseVolume: number,
  durationSec: number | null,
  fadeTo?: { volume: number; afterSeconds: number; fadeDurationSeconds?: number },
  fadeOut?: { volume: number; beforeEndSeconds: number; fadeDurationSeconds?: number },
): Array<{ atSec: number; volume: number }> | null {
  if (!fadeTo && !fadeOut) {
    return null;
  }
  const points: Array<[number, number]> = [[0, baseVolume]];
  if (fadeTo) {
    const end = fadeTo.afterSeconds;
    const dur = fadeTo.fadeDurationSeconds ?? 2.0;
    const start = Math.max(0, end - Math.max(0, dur));
    points.push([start, baseVolume]);
    points.push([end, fadeTo.volume]);
  }
  if (fadeOut) {
    if (durationSec == null) {
      throw new CompileError("fadeOut requires a known clip duration");
    }
    const start = Math.max(0, durationSec - fadeOut.beforeEndSeconds);
    const dur = fadeOut.fadeDurationSeconds ?? 2.0;
    const end = Math.min(durationSec, start + Math.max(0, dur));
    const current = volumeAt(points, start);
    points.push([start, current]);
    points.push([end, fadeOut.volume]);
  }
  points.sort((a, b) => a[0] - b[0]);
  const squashed: Array<[number, number]> = [];
  for (const [t, v] of points) {
    const last = squashed[squashed.length - 1];
    if (last && Math.abs(last[0] - t) < 1e-9) {
      last[1] = v;
    } else {
      squashed.push([t, v]);
    }
  }
  if (!squashed.length || squashed[0][0] > 1e-9) {
    squashed.unshift([0, baseVolume]);
  }
  return squashed.map(([t, v]) => ({ atSec: t, volume: v }));
}

function volumeAt(points: Array<[number, number]>, t: number): number {
  if (!points.length) {
    return 1;
  }
  if (t <= points[0][0]) {
    return points[0][1];
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const [t0, v0] = points[i];
    const [t1, v1] = points[i + 1];
    if (t0 <= t && t <= t1) {
      if (t1 <= t0 + 1e-9) {
        return v1;
      }
      const a = (t - t0) / (t1 - t0);
      return v0 + a * (v1 - v0);
    }
  }
  return points[points.length - 1][1];
}

function isTextSegment(segment: VoiceSegmentSpec): segment is { kind: "text"; text: string } {
  return segment.kind === "text";
}

function findFirstMatch(dir: string, prefix: string, ext: string): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(prefix) && entry.endsWith(ext)) {
      return join(dir, entry);
    }
  }
  return null;
}

function cleanupStagedDir(dir: string, keepFilename: string): void {
  for (const entry of readdirSync(dir)) {
    if (entry === keepFilename) {
      continue;
    }
    try {
      const path = join(dir, entry);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch {
      // Ignore cleanup errors.
    }
  }
}
