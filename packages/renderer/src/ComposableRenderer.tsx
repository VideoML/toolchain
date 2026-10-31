import React, { useMemo } from "react";
import gsapImport from "gsap";
import { getActiveCue, getActiveScene, type ScriptData } from "./shared.ts";
import { useCurrentFrame, useVideoConfig } from "./context.tsx";
import { getComponent } from "./components/registry.ts";
import type { ComponentSpec, LayerSpec, VisualStyles, SemanticMarkup } from "@videoml/toolchain/dsl";
import { cascadeStyles, type CascadedStyles } from "./styles/cascade.ts";
import { cascadeMarkup, type CascadedMarkup } from "./markup/cascade.ts";

export type ComposableRendererProps = {
  script: ScriptData;
  debugLayout?: boolean;
  liveMode?: boolean;
  captureSceneId?: string;
};


function getScriptDuration(script: ScriptData): number {
  const metaDuration = script.meta?.durationSeconds ?? 0;
  const sceneEnds = (script.scenes ?? []).map((scene: { endSec?: number | null }) => scene.endSec ?? 0);
  const sceneMax = sceneEnds.length ? Math.max(...sceneEnds) : 0;
  const timelineEnds = (script.timeline ?? []).map((item: any) => {
    if (item.kind === "mark") return item.atSec ?? 0;
    return item.endSec ?? 0;
  });
  const timelineMax = timelineEnds.length ? Math.max(...timelineEnds) : 0;
  return Math.max(metaDuration, sceneMax, timelineMax);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const gsap = (gsapImport as any).gsap ?? gsapImport;

const resolveEase = (ease?: string) => {
  if (!ease) return (t: number) => t;
  const parsed = (gsap as any).parseEase?.(ease);
  if (typeof parsed === "function") {
    return parsed as (t: number) => number;
  }
  return (t: number) => t;
};

const isActiveRange = (
  timeSec: number,
  startSec?: number,
  endSec?: number,
  allowOpenEnded = false,
): boolean => {
  const start = startSec ?? 0;
  const end = endSec ?? (allowOpenEnded ? Number.POSITIVE_INFINITY : start);
  return timeSec >= start && timeSec < end;
};

const normalizeTransitionEffect = (effect?: string | null) => (effect ?? "").toLowerCase();

const resolveDirection = (transition?: any): "left" | "right" | "up" | "down" => {
  const raw =
    transition?.props?.direction ??
    transition?.props?.dir ??
    transition?.props?.orientation ??
    transition?.props?.axis ??
    "left";
  const value = String(raw).toLowerCase();
  if (value.startsWith("r")) return "right";
  if (value.startsWith("u")) return "up";
  if (value.startsWith("d")) return "down";
  if (value === "vertical") return "up";
  if (value === "horizontal") return "left";
  return "left";
};

const translateIncoming = (direction: "left" | "right" | "up" | "down", progress: number) => {
  const offset = (1 - progress) * 100;
  switch (direction) {
    case "left":
      return `translateX(${offset}%)`;
    case "right":
      return `translateX(${-offset}%)`;
    case "up":
      return `translateY(${offset}%)`;
    case "down":
      return `translateY(${-offset}%)`;
  }
};

const translateOutgoing = (direction: "left" | "right" | "up" | "down", progress: number) => {
  const offset = progress * 100;
  switch (direction) {
    case "left":
      return `translateX(${-offset}%)`;
    case "right":
      return `translateX(${offset}%)`;
    case "up":
      return `translateY(${-offset}%)`;
    case "down":
      return `translateY(${offset}%)`;
  }
};

const wipeClipPath = (direction: "left" | "right" | "up" | "down", progress: number) => {
  const remain = 100 - progress * 100;
  switch (direction) {
    case "left":
      return `inset(0 ${remain}% 0 0)`;
    case "right":
      return `inset(0 0 0 ${remain}%)`;
    case "up":
      return `inset(${remain}% 0 0 0)`;
    case "down":
      return `inset(0 0 ${remain}% 0)`;
  }
};

const getTransitionStyle = (
  transition: any,
  role: "from" | "to",
  progress: number,
): React.CSSProperties => {
  if (!transition) return {};
  const effect = normalizeTransitionEffect(transition.effect);
  const direction = resolveDirection(transition);
  if (effect.includes("slide")) {
    if (role === "to") {
      return { transform: translateIncoming(direction, progress) };
    }
    return {};
  }
  if (effect.includes("push")) {
    return { transform: role === "from" ? translateOutgoing(direction, progress) : translateIncoming(direction, progress) };
  }
  if (effect.includes("wipe")) {
    if (role === "to") {
      return { clipPath: wipeClipPath(direction, progress) };
    }
    return {};
  }
  if (effect.includes("scale")) {
    if (role === "to") {
      const startScale = transition?.props?.from ?? 0.9;
      const endScale = transition?.props?.to ?? 1;
      const scale = startScale + (endScale - startScale) * progress;
      return { transform: `scale(${scale})` };
    }
    const fromScale = transition?.props?.fromOut ?? 1;
    const toScale = transition?.props?.toOut ?? 0.98;
    const scale = fromScale + (toScale - fromScale) * progress;
    return { transform: `scale(${scale})` };
  }
  return {};
};

export const ComposableRenderer = ({ script, debugLayout, liveMode = false, captureSceneId }: ComposableRendererProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const timeSec = frame / fps;
  const scenes = script.scenes ?? [];
  const sceneById = useMemo(() => new Map(scenes.map((scene: any) => [scene.id, scene])), [scenes]);
  const scene = useMemo(
    () => captureSceneId ? sceneById.get(captureSceneId) : getActiveScene(script, timeSec, { allowOpenEnded: liveMode }),
    [script, timeSec, liveMode, captureSceneId, sceneById]
  );
  const cue = useMemo(
    () => captureSceneId
      ? (scene?.cues ?? []).find((item: any) => isActiveRange(timeSec, item.startSec, item.endSec, liveMode)) ?? null
      : getActiveCue(script, timeSec, { allowOpenEnded: liveMode }),
    [script, timeSec, liveMode, captureSceneId, scene]
  );
  const durationSec = useMemo(() => getScriptDuration(script), [script]);
  const progressPct = durationSec > 0 ? Math.min(100, Math.max(0, (timeSec / durationSec) * 100)) : 0;

  const activeTransition = useMemo(() => {
    if(captureSceneId)return null;
    const items = script.timeline ?? [];
    for (const item of items) {
      if (item.kind !== "transition") continue;
      if (isActiveRange(timeSec, item.startSec, item.endSec, liveMode)) {
        return item;
      }
    }
    return null;
  }, [script, timeSec, liveMode, captureSceneId]);

  const transitionProgress = useMemo(() => {
    if (!activeTransition) return 0;
    const start = activeTransition.startSec ?? 0;
    const end = activeTransition.endSec ?? start;
    const raw = end > start ? (timeSec - start) / (end - start) : 1;
    const easeFn = resolveEase(activeTransition.ease ?? undefined);
    return clamp01(easeFn(clamp01(raw)));
  }, [activeTransition, timeSec]);

  const fromScene = activeTransition?.fromSceneId ? sceneById.get(activeTransition.fromSceneId) : null;
  const toScene = activeTransition?.toSceneId ? sceneById.get(activeTransition.toSceneId) : null;
  const transitionEffect = normalizeTransitionEffect(activeTransition?.effect);
  const useOpacityMix =
    !transitionEffect || transitionEffect.includes("fade") || transitionEffect.includes("crossfade");
  const fromOpacity = useOpacityMix ? 1 - transitionProgress : 1;
  const toOpacity = useOpacityMix ? transitionProgress : 1;
  const activeScenes = useMemo(
    () =>
      captureSceneId ? scenes.filter((s:any)=>s.id===captureSceneId) : scenes.filter((s: any) =>
        isActiveRange(timeSec, s.startSec, s.endSec, liveMode)
      ),
    [scenes, timeSec, liveMode, captureSceneId]
  );

  const primaryScene = fromScene ?? activeScenes[0] ?? scene;
  const secondaryScene = toScene ?? activeScenes[1] ?? null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {activeTransition ? (
        <>
          {primaryScene && (
            <SceneCanvas
              scene={primaryScene}
              cue={cue}
              frame={frame}
              timeSec={timeSec}
              fps={fps}
              width={width}
              height={height}
              progressPct={progressPct}
              debugLayout={debugLayout}
              opacity={fromOpacity}
              transition={activeTransition}
              transitionProgress={transitionProgress}
              role="from"
            />
          )}
          {secondaryScene && (
            <SceneCanvas
              scene={secondaryScene}
              cue={null}
              frame={frame}
              timeSec={timeSec}
              fps={fps}
              width={width}
              height={height}
              progressPct={progressPct}
              debugLayout={debugLayout}
              opacity={toOpacity}
              transition={activeTransition}
              transitionProgress={transitionProgress}
              role="to"
            />
          )}
          <TransitionCanvas
            transition={activeTransition}
            frame={frame}
            timeSec={timeSec}
            fps={fps}
            width={width}
            height={height}
            progressPct={progressPct}
            debugLayout={debugLayout}
            transitionProgress={transitionProgress}
            scene={primaryScene}
            cue={cue}
          />
        </>
      ) : (
        <SceneCanvas
          scene={scene}
          cue={cue}
          frame={frame}
          timeSec={timeSec}
          fps={fps}
          width={width}
          height={height}
          progressPct={progressPct}
          debugLayout={debugLayout}
          opacity={1}
        />
      )}
    </div>
  );
};

function SceneCanvas({
  scene,
  cue,
  frame,
  timeSec,
  fps,
  width,
  height,
  progressPct,
  debugLayout,
  opacity,
  transition,
  transitionProgress,
  role = "from",
}: {
  scene: any;
  cue: any;
  frame: number;
  timeSec: number;
  fps: number;
  width: number;
  height: number;
  progressPct: number;
  debugLayout?: boolean;
  opacity: number;
  transition?: any;
  transitionProgress?: number;
  role?: "from" | "to";
}) {
  if (!scene) return null;
  const sceneStyles: VisualStyles = (scene?.styles as VisualStyles | undefined) || {};
  const sceneMarkup: SemanticMarkup = (scene?.markup as SemanticMarkup | undefined) || {};
  const layers: LayerSpec[] = (scene?.layers as LayerSpec[] | undefined) || [];
  const components: ComponentSpec[] = (scene?.components as ComponentSpec[] | undefined) || [];

  const sceneBackground = (sceneMarkup.background as string) || sceneStyles.background || "transparent";
  const sceneVars = sceneStyles.vars ?? {};
  const transitionStyle = getTransitionStyle(transition, role, transitionProgress ?? 0);
  let sceneOpacity = opacity;
  const enter = scene?.enter;
  if (enter?.effect && enter.effect.startsWith("fade")) {
    const duration = enter.durationSeconds ?? 0;
    if (duration > 0 && scene?.startSec != null) {
      const raw = clamp01((timeSec - scene.startSec) / duration);
      const easeFn = resolveEase(enter.ease ?? undefined);
      sceneOpacity *= clamp01(easeFn(raw));
    }
  }
  const exit = scene?.exit;
  if (exit?.effect && exit.effect.startsWith("fade")) {
    const duration = exit.durationSeconds ?? 0;
    if (duration > 0 && scene?.endSec != null) {
      const raw = clamp01((scene.endSec - timeSec) / duration);
      const easeFn = resolveEase(exit.ease ?? undefined);
      sceneOpacity *= clamp01(easeFn(raw));
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: 0,
        background: sceneBackground,
        fontFamily: sceneStyles.fontFamily || "ui-sans-serif, system-ui, sans-serif",
        ...(sceneVars as Record<string, string>),
        opacity: sceneOpacity,
        zIndex: role === "to" ? 2 : 1,
        ...transitionStyle,
      }}
    >
      {layers.map((layer) => (
        <Layer
          key={layer.id}
          layer={layer}
          sceneStyles={sceneStyles}
          sceneMarkup={sceneMarkup}
          scene={scene}
          cue={cue}
          frame={frame}
          timeSec={timeSec}
          fps={fps}
          width={width}
          height={height}
          progressPct={progressPct}
          debugLayout={debugLayout}
          transition={transition}
          transitionProgress={transitionProgress}
        />
      ))}

      {components.map((spec) => (
        <Component
          key={spec.id}
          spec={spec}
          sceneStyles={sceneStyles}
          sceneMarkup={sceneMarkup}
          layerStyles={{}}
          layerMarkup={{}}
          scene={scene}
          cue={cue}
          frame={frame}
          timeSec={timeSec}
          fps={fps}
          width={width}
          height={height}
          progressPct={progressPct}
          debugLayout={debugLayout}
          transition={transition}
          transitionProgress={transitionProgress}
        />
      ))}
    </div>
  );
}

function TransitionCanvas({
  transition,
  frame,
  timeSec,
  fps,
  width,
  height,
  progressPct,
  debugLayout,
  transitionProgress,
  scene,
  cue,
}: {
  transition: any;
  frame: number;
  timeSec: number;
  fps: number;
  width: number;
  height: number;
  progressPct: number;
  debugLayout?: boolean;
  transitionProgress: number;
  scene: any;
  cue: any;
}) {
  if (!transition) return null;
  const transitionStyles: VisualStyles = (transition?.styles as VisualStyles | undefined) || {};
  const transitionMarkup: SemanticMarkup = (transition?.markup as SemanticMarkup | undefined) || {};
  const layers: LayerSpec[] = (transition?.layers as LayerSpec[] | undefined) || [];
  const components: ComponentSpec[] = (transition?.components as ComponentSpec[] | undefined) || [];
  const transitionBackground =
    (transitionMarkup.background as string) || transitionStyles.background || "transparent";
  const transitionVars = transitionStyles.vars ?? {};

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: transitionBackground,
        ...(transitionVars as Record<string, string>),
        opacity: transitionStyles.opacity,
      }}
    >
      {layers.map((layer) => (
        <Layer
          key={layer.id}
          layer={layer}
          sceneStyles={transitionStyles}
          sceneMarkup={transitionMarkup}
          scene={scene}
          cue={cue}
          frame={frame}
          timeSec={timeSec}
          fps={fps}
          width={width}
          height={height}
          progressPct={progressPct}
          debugLayout={debugLayout}
          transition={transition}
          transitionProgress={transitionProgress}
        />
      ))}

      {components.map((spec) => (
        <Component
          key={spec.id}
          spec={spec}
          sceneStyles={transitionStyles}
          sceneMarkup={transitionMarkup}
          layerStyles={{}}
          layerMarkup={{}}
          scene={scene}
          cue={cue}
          frame={frame}
          timeSec={timeSec}
          fps={fps}
          width={width}
          height={height}
          progressPct={progressPct}
          debugLayout={debugLayout}
          transition={transition}
          transitionProgress={transitionProgress}
        />
      ))}
    </div>
  );
}

/**
 * Layer component - renders a group of components with shared styles/timing.
 */
function Layer({
  layer,
  sceneStyles,
  sceneMarkup,
  scene,
  cue,
  frame,
  timeSec,
  fps,
  width,
  height,
  progressPct,
  debugLayout,
  transition,
  transitionProgress,
}: {
  layer: LayerSpec;
  sceneStyles: VisualStyles;
  sceneMarkup: SemanticMarkup;
  scene: any;
  cue: any;
  frame: number;
  timeSec: number;
  fps: number;
  width: number;
  height: number;
  progressPct: number;
  debugLayout?: boolean;
  transition?: any;
  transitionProgress?: number;
}) {
  // Check layer visibility
  if (layer.visible === false) return null;

  // Check layer timing
  if (layer.timing) {
    const { startSec, endSec } = layer.timing;
    if (startSec !== undefined && timeSec < startSec) return null;
    if (endSec !== undefined && timeSec > endSec) return null;
  }

  const layerStyles = layer.styles || {};
  const layerMarkup = layer.markup || {};
  const { vars: layerVars, _computedOpacity, ...layerStyleProps } = layerStyles as any;

  // Sort components by zIndex (lower = back, higher = front)
  const sortedComponents = useMemo(() => {
    return [...layer.components].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  }, [layer.components]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: layerStyles.opacity,
        zIndex: layer.zIndex,
        ...(layerStyleProps as React.CSSProperties),
        ...(layerVars as Record<string, string>),
      }}
    >
      {sortedComponents.map((spec) => (
        <Component
          key={spec.id}
          spec={spec}
          sceneStyles={sceneStyles}
          sceneMarkup={sceneMarkup}
          layerStyles={layerStyles}
          layerMarkup={layerMarkup}
          scene={scene}
          cue={cue}
          frame={frame}
          timeSec={timeSec}
          fps={fps}
          width={width}
          height={height}
          progressPct={progressPct}
          debugLayout={debugLayout}
          transition={transition}
          transitionProgress={transitionProgress}
        />
      ))}
    </div>
  );
}

/**
 * Component renderer - renders a single component with cascaded styles and markup.
 */
function Component({
  spec,
  sceneStyles,
  sceneMarkup,
  layerStyles,
  layerMarkup,
  scene,
  cue,
  frame,
  timeSec,
  fps,
  width,
  height,
  progressPct,
  debugLayout,
  transition,
  transitionProgress,
}: {
  spec: ComponentSpec;
  sceneStyles: VisualStyles;
  sceneMarkup: SemanticMarkup;
  layerStyles: VisualStyles;
  layerMarkup: SemanticMarkup;
  scene: any;
  cue: any;
  frame: number;
  timeSec: number;
  fps: number;
  width: number;
  height: number;
  progressPct: number;
  debugLayout?: boolean;
  transition?: any;
  transitionProgress?: number;
}) {
  // Check visibility
  if (spec.visible === false) return null;

  // Check timing
  if (spec.timing && spec.type !== "FrameEffect") {
    const { startSec, endSec } = spec.timing;
    if (startSec !== undefined && timeSec < startSec) return null;
    if (endSec !== undefined && timeSec > endSec) return null;
  }

  if (spec.type === "FrameEffect") {
    if (spec.timing?.startSec !== undefined && frame < Math.floor(spec.timing.startSec * fps)) return null;
    if (spec.timing?.endSec !== undefined && frame >= Math.ceil(spec.timing.endSec * fps)) return null;
    const effectId = spec.props?.effectId, effectVersion = spec.props?.effectVersion;
    return React.createElement("frame-effect", {id:spec.id,"effect-id":String(effectId ?? ""),"effect-version":String(effectVersion ?? ""),props:JSON.stringify({parameters:spec.props?.parameters}),"data-start":String(spec.timing?.startSec ?? scene.startSec ?? 0),"data-end":String(spec.timing?.endSec ?? scene.endSec ?? 0)});
  }

  // Resolve component
  const ComponentImpl = getComponent(spec.type);
  if (!ComponentImpl) {
    console.warn(`Component not found: ${spec.type}`);
    return null;
  }

  // Cascade styles: scene → layer → component
  const cascadedStyles: CascadedStyles = cascadeStyles(
    sceneStyles,
    layerStyles,
    spec.styles || {}
  );

  // Cascade markup: scene → layer → component
  const cascadedMarkup: CascadedMarkup = cascadeMarkup(
    sceneMarkup,
    layerMarkup,
    spec.markup || {}
  );

  // Merge props with context, styles, and markup
  // IMPORTANT: Use videoWidth/videoHeight to avoid overwriting component's own width/height props
  const props: Record<string, any> = {
    ...spec.props,
    styles: cascadedStyles, // Pass cascaded styles to component
    markup: cascadedMarkup, // Pass cascaded markup to component
    scene,
    cue,
    frame,
    timeSec,
    fps,
    videoWidth: width,
    videoHeight: height,
    progress: progressPct, // For ProgressBar
    debugLayout: !!debugLayout,
    transition,
    transitionProgress,
  };

  // Apply bindings
  if (spec.bindings) {
    for (const [propName, dataRef] of Object.entries(spec.bindings)) {
      props[propName] = resolveDataReference(dataRef, { scene, cue, transition, frame, timeSec });
    }
  }

  return <ComponentImpl key={spec.id} {...props} />;
}

function resolveDataReference(
  ref: string,
  context: { scene: any; cue: any; transition?: any; frame: number; timeSec: number },
): any {
  if (ref.startsWith("scene.")) {
    const key = ref.substring(6);
    return context.scene?.[key];
  }
  if (ref.startsWith("cue.")) {
    const key = ref.substring(4);
    return context.cue?.[key];
  }
  if (ref.startsWith("transition.")) {
    const key = ref.substring(11);
    return context.transition?.[key];
  }
  if (ref.startsWith("frame.")) {
    const key = ref.substring(6);
    return key === "number" ? context.frame : context.timeSec;
  }
  return ref; // Literal value
}
