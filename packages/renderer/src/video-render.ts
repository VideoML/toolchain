import { applyResolvedTimingToScript, projectResolvedTimeline, validateResolvedTiming, type ResolvedTiming } from "@videoml/shared/resolved-timing";
import type { ScriptData } from "./shared.ts";
import { deriveVideoConfig, type TimelineData } from "./shared.ts";
import { withVerifiedFrozenAudio } from "./resolved-audio-node.js";
import { renderVideo, type RenderVideoOptions, type RenderVideoResult } from "./pipeline.js";
import { ComposableRenderer } from "./ComposableRenderer.js";

export type PreviewOptions = {
  offsetSec?: number;    // Start time in seconds (default: 0)
  durationSec?: number;  // Duration to render in seconds (default: 2)
  fps?: number;          // Frame rate for preview (default: 15)
};

export type RenderVideoScriptOptions = Omit<RenderVideoOptions, "component" | "config" | "inputProps"> & {
  script: ScriptData;
  timeline?: TimelineData | null;
  resolvedTiming?: ResolvedTiming | null;
  resolvedTimingRoot?: string;
  title?: string | null;
  subtitle?: string | null;
  debugLayout?: boolean;
  fps?: number;
  width?: number;
  height?: number;
  durationFrames?: number;
  preview?: PreviewOptions; // Preview mode for fast iteration
};

export const renderVideoFromScript = async ({
  script: originalScript,
  timeline,
  resolvedTiming,
  resolvedTimingRoot,
  title,
  subtitle,
  debugLayout,
  fps,
  width,
  height,
  durationFrames,
  preview,
  ...options
}: RenderVideoScriptOptions): Promise<RenderVideoResult> => {
  if (resolvedTiming) {
    validateResolvedTiming(resolvedTiming);
    if (!resolvedTimingRoot) throw new Error("Frozen timing requires an audio root");
    if ((fps !== undefined && fps !== resolvedTiming.fps) || (durationFrames !== undefined && durationFrames !== resolvedTiming.durationFrames) || (preview?.fps !== undefined && preview.fps !== resolvedTiming.fps)) throw new Error("FPS or duration conflicts with frozen timing");
  }
  const script = resolvedTiming ? applyResolvedTimingToScript(originalScript, resolvedTiming, timeline as any) : originalScript;
  const projectedTimeline = resolvedTiming && timeline ? projectResolvedTimeline(timeline, resolvedTiming) : timeline;
  const derived = deriveVideoConfig({ script, timeline: projectedTimeline });

  // Handle preview mode
  let resolvedFps: number;
  let resolvedDurationFrames: number;
  // Default to explicit start/end if provided; preview mode can override below
  let startFrame: number | undefined = options.startFrame;
  let endFrame: number | undefined = options.endFrame;

  if (preview) {
    // Preview mode: use preview fps and calculate frame range
    const previewFps = preview.fps ?? resolvedTiming?.fps ?? 15; // Default to 15 fps for preview
    const previewOffsetSec = preview.offsetSec ?? 0;
    const previewDurationSec = preview.durationSec ?? 2; // Default to 2 seconds

    resolvedFps = previewFps;
    startFrame = Math.floor(previewOffsetSec * previewFps);
    endFrame = Math.floor((previewOffsetSec + previewDurationSec) * previewFps);

    // Duration frames must cover the full video for proper rendering context
    resolvedDurationFrames = resolvedTiming?.durationFrames ?? Math.max(1, Math.ceil(derived.durationSec * previewFps));

    console.log(`[Preview Mode] Rendering ${previewDurationSec}s at ${previewFps} fps from offset ${previewOffsetSec}s`);
    console.log(`[Preview Mode] Frame range: ${startFrame}-${endFrame} (total: ${endFrame - startFrame} frames)`);
  } else {
    // Normal mode
    resolvedFps = resolvedTiming?.fps ?? fps ?? derived.fps;
    resolvedDurationFrames = resolvedTiming?.durationFrames ?? durationFrames ?? Math.max(1, Math.ceil(derived.durationSec * resolvedFps));
  }

  const resolvedWidth = width ?? derived.width;
  const resolvedHeight = height ?? derived.height;

  const render = (verifiedAudioPath: string | null | undefined) => renderVideo({
    ...options,
    audioPath: verifiedAudioPath,
    component: ComposableRenderer,
    config: {
      fps: resolvedFps,
      width: resolvedWidth,
      height: resolvedHeight,
      durationFrames: resolvedDurationFrames,
    },
    inputProps: {
      script,
      title: title ?? undefined,
      subtitle: subtitle ?? undefined,
      debugLayout: !!debugLayout,
    },
    startFrame,
    endFrame,
  });
  return resolvedTiming
    ? withVerifiedFrozenAudio(resolvedTiming, resolvedTimingRoot!, options.audioPath, render)
    : render(options.audioPath);
};

// Deprecated: Use renderVideoFromScript instead
export const renderStoryboardVideo = renderVideoFromScript;
export type RenderStoryboardOptions = RenderVideoScriptOptions;
