import { applyResolvedTimingToScript, projectResolvedTimeline, validateResolvedTiming, type ResolvedTiming } from "@videoml/shared/resolved-timing";
import type { ScriptData } from "./shared.ts";
import { deriveVideoConfig, type TimelineData } from "./shared.ts";
import { resolveEffectAssets } from "./effect-assets-node.js";
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
  effectAssets?: Readonly<Record<string, string>>;
  assetBaseDir?: string;
  effectSeed?: number;
};

/** Project authored component offsets to composition time for the browser effect adapter. */
function absoluteFrameEffectTiming<T extends ScriptData>(input:T):T {
 const script=structuredClone(input);
 const project=(container:any,start:number,end:number|null|undefined)=>{
  const resolve=(component:any,base:number,limit:number|null|undefined)=>{
   if(component.type!=="FrameEffect")return;
   const offset=component.timing?.startSec ?? 0, authoredEnd=component.timing?.endSec;
   const endSec=authoredEnd===undefined?limit:base+authoredEnd;
   if(!Number.isFinite(endSec))throw new Error('FRAME_EFFECT_INVALID: a bounded interval is required');
   component.timing={startSec:base+offset,endSec:Math.min(endSec,limit ?? endSec)};
  };
  for(const component of container.components ?? [])resolve(component,start,end);
  for(const layer of container.layers ?? []) {
   if(!(layer.components ?? []).some((component:any)=>component.type==='FrameEffect'))continue;
   const layerStart=start+(layer.timing?.startSec ?? 0),layerEnd=layer.timing?.endSec===undefined?end:Math.min(start+layer.timing.endSec,end ?? Infinity);
   layer.timing={startSec:layerStart,endSec:layerEnd};for(const component of layer.components ?? [])resolve(component,layerStart,layerEnd);
  }
 };
 for(const scene of script.scenes ?? [])project(scene,scene.startSec ?? 0,scene.endSec);
 for(const item of script.timeline ?? [])if(item.kind==='transition')project(item,item.startSec ?? 0,item.endSec);
 return script;
}

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
  effectAssets,
  assetBaseDir,
  effectSeed,
  ...options
}: RenderVideoScriptOptions): Promise<RenderVideoResult> => {
  if (resolvedTiming) {
    validateResolvedTiming(resolvedTiming);
    if (!resolvedTimingRoot) throw new Error("Frozen timing requires an audio root");
    if ((fps !== undefined && fps !== resolvedTiming.fps) || (durationFrames !== undefined && durationFrames !== resolvedTiming.durationFrames) || (preview?.fps !== undefined && preview.fps !== resolvedTiming.fps)) throw new Error("FPS or duration conflicts with frozen timing");
  }
  const script = resolvedTiming ? applyResolvedTimingToScript(originalScript, resolvedTiming, timeline as any) : absoluteFrameEffectTiming(originalScript);
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
      effectAssets: resolveEffectAssets((script.meta as any)?.assets,assetBaseDir,effectAssets),
      effectSeed: resolvedTiming?.generationSeed ?? effectSeed ?? (script.meta as any)?.generationSeed ?? 0,
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
