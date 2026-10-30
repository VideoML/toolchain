import { normalizeSourceElement, normalizedSourceIds, type SourceElement } from "@videoml/shared/resolved-timing";
import { DOMParser } from "@xmldom/xmldom";
import { ParseError } from "../errors.js";
import { applyVomPatches } from "./xml-patch.js";
import { MissingTimeReferenceError, parseTimeValue, type TimeEvalContext } from "./time-expr.js";
import type {
  AudioPlan,
  AudioElementSpec,
  ComponentSpec,
  CueSpec,
  LayerSpec,
  MarkSpec,
  NarrationSpec,
  PauseSpec,
  SceneSpec,
  SemanticMarkup,
  TransitionRef,
  TransitionSpec,
  TimelineItemSpec,
  TimeRange,
  VideoFileSpec,
  VisualStyles,
  VoiceSegmentSpec,
} from "./types.js";

const BUILTIN_TAGS = new Set([
  "video",
  "scene",
  "cue",
  "layer",
  "pause",
  "voice",
  "bullet",
  "voiceover",
  "sequence",
  "stack",
  "transition",
  "mark",
  "narration",
  "audio",
  "sfx",
  "music",
]);

type NodeLike = {
  nodeType: number;
};

type ElementLike = {
  nodeType: number;
  tagName: string;
  attributes: {
    length: number;
    item(index: number): { name: string; value: string } | null;
  };
  childNodes: ArrayLike<NodeLike>;
  textContent?: string | null;
};

const isElement = (node: NodeLike): node is ElementLike => node.nodeType === 1;

const getChildElements = (node: ElementLike): ElementLike[] =>
  Array.from(node.childNodes).filter(isElement);

const asElementLike = (node: unknown): ElementLike => node as unknown as ElementLike;

const normalizeText = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const parseBoolean = (value: string) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

const parseNumber = (value: string) => {
  if (!/^[-+]?\d+(\.\d+)?$/.test(value)) return null;
  return Number.parseFloat(value);
};

const parseJson = (value: string, context: string) => {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ParseError(`Invalid JSON in ${context}: ${message}`);
  }
};

const toCamelCase = (value: string) =>
  value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const toPascalCase = (value: string) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");


const parseAttributes = (element: ElementLike) => {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attr = element.attributes.item(i);
    if (!attr) continue;
    attrs[attr.name] = attr.value;
  }
  return attrs;
};

const parseProps = (attrs: Record<string, string>, reserved: Set<string>) => {
  const props: Record<string, unknown> = {};
  if (attrs.props) {
    Object.assign(props, parseJson(attrs.props, "props attribute"));
  }
  for (const [rawKey, rawValue] of Object.entries(attrs)) {
    if (rawKey === "props" || reserved.has(rawKey)) continue;
    const key = toCamelCase(rawKey);
    const boolValue = parseBoolean(rawValue);
    if (boolValue != null) {
      props[key] = boolValue;
      continue;
    }
    const numValue = parseNumber(rawValue);
    if (numValue != null) {
      props[key] = numValue;
      continue;
    }
    props[key] = rawValue;
  }
  return props;
};

const parseStylesOrMarkup = (value: string | undefined, label: string) => {
  if (!value) return undefined;
  return parseJson(value, label);
};

const parseTiming = (attrs: Record<string, string>, ctx: TimeEvalContext) => {
  const startRaw = attrs.start;
  const endRaw = attrs.end;
  const durationRaw = attrs.duration;
  if (!startRaw && !endRaw && !durationRaw) return undefined;
  const start = startRaw ? parseTimeValue(startRaw, ctx) : (durationRaw ? 0 : undefined);
  const end = endRaw ? parseTimeValue(endRaw, ctx) : undefined;
  if (start != null && durationRaw && end == null) {
    const duration = parseTimeValue(durationRaw, ctx);
    return { startSec: start, endSec: start + duration };
  }
  return {
    startSec: start,
    endSec: end,
  };
};

const parseTimeRange = (
  attrs: Record<string, string>,
  ctx: TimeEvalContext,
  label: string,
  allowRelativeStart = false,
): TimeRange | undefined => {
  const startRaw = attrs.start;
  const endRaw = attrs.end;
  const durationRaw = attrs.duration;
  if (!startRaw && !endRaw && !durationRaw) return undefined;
  if (!startRaw && endRaw) {
    throw new ParseError(`${label} timing requires start when end is provided.`);
  }
  if (!startRaw && durationRaw && allowRelativeStart) {
    const prevEnd = ctx.getPrevEnd();
    const duration = parseTimeValue(durationRaw, ctx);
    if (prevEnd == null) {
      return { start: 0, end: duration, startIsRelative: true };
    }
    return { start: prevEnd, end: prevEnd + duration };
  }
  if (!startRaw && durationRaw) {
    throw new ParseError(`${label} timing requires start when duration is provided.`);
  }
  const start = startRaw ? parseTimeValue(startRaw, ctx) : undefined;
  const endExplicit = endRaw ? parseTimeValue(endRaw, ctx) : undefined;
  if (start != null && durationRaw && endExplicit == null) {
    const duration = parseTimeValue(durationRaw, ctx);
    return { start, end: start + duration };
  }
  if (start != null && endExplicit != null) {
    return { start, end: endExplicit };
  }
  if (start != null) {
    return { start };
  }
  return undefined;
};

const parseTransitionRef = (
  attrs: Record<string, string>,
  ctx: TimeEvalContext,
  effectKey: string,
  prefix: string,
): TransitionRef | undefined => {
  const effect = attrs[effectKey];
  if (!effect) return undefined;
  const durationKey = `${prefix}-duration`;
  const easeKey = `${prefix}-ease`;
  const propsKey = `${prefix}-props`;
  const durationSeconds = attrs[durationKey] ? parseTimeValue(attrs[durationKey], ctx) : undefined;
  const ease = attrs[easeKey];
  const props = attrs[propsKey] ? parseJson(attrs[propsKey], `${prefix} props`) : undefined;
  return {
    effect,
    durationSeconds,
    ease,
    props,
  };
};

const parsePause = (attrs: Record<string, string>, ctx: TimeEvalContext): PauseSpec => {
  if (attrs.seconds) {
    return {
      kind: "pause",
      mode: "fixed",
      seconds: parseTimeValue(attrs.seconds, ctx),
    };
  }
  if (attrs.mean && attrs.std) {
    const pause: PauseSpec = {
      kind: "pause",
      mode: "gaussian",
      mean: parseTimeValue(attrs.mean, ctx),
      std: parseTimeValue(attrs.std, ctx),
    };
    if (attrs.min) pause.min = parseTimeValue(attrs.min, ctx);
    if (attrs.max) pause.max = parseTimeValue(attrs.max, ctx);
    return pause;
  }
  throw new ParseError("pause requires seconds or mean+std attributes.");
};

const parseAudioElement = (
  element: ElementLike,
  ctx: TimeEvalContext,
  index: number,
  defaultKind?: AudioElementSpec["kind"],
): AudioElementSpec => {
  const attrs = parseAttributes(element);
  const kind = (attrs.kind as AudioElementSpec["kind"] | undefined) ?? defaultKind;
  if (!kind) {
    throw new ParseError("audio tag requires kind attribute.");
  }
  const id = attrs.id ?? `${kind}-${index}`;
  let time = parseTimeRange(attrs, ctx, `audio "${id}"`);
  if (!time && attrs.duration && !attrs.start && !attrs.end) {
    const duration = parseTimeValue(attrs.duration, ctx);
    time = { start: 0, end: duration };
  }
  const volume = attrs.volume ? parseNumber(attrs.volume) ?? undefined : undefined;
  const playThrough = attrs["play-through"] ? parseBoolean(attrs["play-through"]) ?? undefined : undefined;
  const sourceId = attrs["source-id"] ?? undefined;
  const durationSeconds = attrs["clip-duration"] ? parseTimeValue(attrs["clip-duration"], ctx) : undefined;
  const variants = attrs.variants ? parseNumber(attrs.variants) ?? undefined : undefined;
  const pick = attrs.pick ? parseNumber(attrs.pick) ?? undefined : undefined;
  const modelId = attrs["model-id"] ?? undefined;
  const forceInstrumental = attrs["force-instrumental"]
    ? parseBoolean(attrs["force-instrumental"]) ?? undefined
    : undefined;
  const fadeToVolume = attrs["fade-to"] ? parseNumber(attrs["fade-to"]) ?? undefined : undefined;
  const fadeToAfter = attrs["fade-to-after"] ? parseTimeValue(attrs["fade-to-after"], ctx) : undefined;
  const fadeToDuration = attrs["fade-to-duration"] ? parseTimeValue(attrs["fade-to-duration"], ctx) : undefined;
  const fadeOutVolume = attrs["fade-out"] ? parseNumber(attrs["fade-out"]) ?? undefined : undefined;
  const fadeOutBefore = attrs["fade-out-before"] ? parseTimeValue(attrs["fade-out-before"], ctx) : undefined;
  const fadeOutDuration = attrs["fade-out-duration"] ? parseTimeValue(attrs["fade-out-duration"], ctx) : undefined;

  return {
    id,
    kind,
    time,
    volume,
    playThrough,
    sourceId,
    src: attrs.src ?? undefined,
    prompt: attrs.prompt ?? undefined,
    durationSeconds,
    variants: variants == null ? undefined : Math.trunc(variants),
    pick: pick == null ? undefined : Math.trunc(pick),
    modelId,
    forceInstrumental,
    fadeTo:
      fadeToVolume != null && fadeToAfter != null
        ? { volume: fadeToVolume, afterSeconds: fadeToAfter, fadeDurationSeconds: fadeToDuration }
        : undefined,
    fadeOut:
      fadeOutVolume != null && fadeOutBefore != null
        ? { volume: fadeOutVolume, beforeEndSeconds: fadeOutBefore, fadeDurationSeconds: fadeOutDuration }
        : undefined,
  };
};

const parseVoiceSegments = (cueEl: ElementLike, ctx: TimeEvalContext): VoiceSegmentSpec[] => {
  const segments: VoiceSegmentSpec[] = [];
  for (const child of getChildElements(cueEl)) {
    if (child.tagName === "voice") {
      const text = normalizeText(child.textContent);
      if (!text) continue;
      const attrs = parseAttributes(child);
      const trimEnd = attrs["trim-end"];
      segments.push({
        kind: "text",
        text,
        trimEndSec: trimEnd ? parseTimeValue(trimEnd, ctx) : undefined,
      });
      continue;
    }
    if (child.tagName === "pause") {
      const attrs = parseAttributes(child);
      segments.push({ kind: "pause", pause: parsePause(attrs, ctx) });
      continue;
    }
  }
  return segments;
};

const parseCue = (cueEl: ElementLike, ctx: TimeEvalContext): CueSpec => {
  const attrs = parseAttributes(cueEl);
  const id = attrs.id;
  if (!id) {
    throw new ParseError("cue tag requires id attribute.");
  }
  const label = attrs.label ?? id;
  const provider = attrs.provider ?? null;
  const segments = parseVoiceSegments(cueEl, ctx);
  const time = parseTimeRange(attrs, ctx, `cue "${id}"`);
  const bullets = getChildElements(cueEl)
    .filter((child) => child.tagName === "bullet")
    .map((child) => normalizeText(child.textContent))
    .filter(Boolean);

  return {
    kind: "cue",
    id,
    label,
    segments,
    bullets,
    provider,
    time,
  };
};

const parseComponent = (
  element: ElementLike,
  ctx: TimeEvalContext,
  componentIndex: number,
): ComponentSpec => {
  const attrs = parseAttributes(element);
  const reserved = new Set(["id", "visible", "z", "start", "end", "duration", "styles", "markup", "props"]);
  const rawId = attrs.id;
  const id = rawId ?? `${element.tagName}-${componentIndex}`;
  const visible = attrs.visible ? parseBoolean(attrs.visible) ?? true : undefined;
  const zIndex = attrs.z ? parseNumber(attrs.z) ?? undefined : undefined;
  const timing = parseTiming(attrs, ctx);
  const styles = parseStylesOrMarkup(attrs.styles, "styles attribute") as VisualStyles | undefined;
  const markup = parseStylesOrMarkup(attrs.markup, "markup attribute") as SemanticMarkup | undefined;
  const props = parseProps(attrs, reserved);
  const type = toPascalCase(element.tagName);

  return {
    id,
    generatedId: rawId == null,
    type,
    props,
    styles,
    markup,
    zIndex,
    visible,
    timing: timing
      ? {
          startSec: timing.startSec,
          endSec: timing.endSec,
        }
      : undefined,
  };
};

const DEFAULT_SEQUENCE_CHILD_SECONDS = 1;

const parseContainerTiming = (attrs: Record<string, string>, ctx: TimeEvalContext) => {
  const startRaw = attrs.start;
  const endRaw = attrs.end;
  const durationRaw = attrs.duration;
  if (!startRaw && !endRaw && !durationRaw) return { startSec: 0, endSec: undefined };
  const start = startRaw ? parseTimeValue(startRaw, ctx) : 0;
  const end = endRaw ? parseTimeValue(endRaw, ctx) : undefined;
  if (durationRaw && end == null) {
    const duration = parseTimeValue(durationRaw, ctx);
    return { startSec: start, endSec: start + duration };
  }
  return { startSec: start, endSec: end };
};

const mergeCascaded = <T extends Record<string, unknown> | undefined>(
  parent: T,
  child: T,
): T => {
  if (!parent) return child;
  if (!child) return parent;
  return { ...parent, ...child } as T;
};

const parseContainerChildren = (
  element: ElementLike,
  ctx: TimeEvalContext,
  componentIndex: number,
  containerStart: number,
  flow: "sequence" | "stack",
  inheritedStyles?: VisualStyles,
  inheritedMarkup?: SemanticMarkup,
): { components: ComponentSpec[]; componentIndex: number; maxEnd?: number } => {
  const components: ComponentSpec[] = [];
  let cursor = containerStart;
  let maxEnd: number | undefined = undefined;
  const containerAttrs = parseAttributes(element);
  const containerStyles = parseStylesOrMarkup(containerAttrs.styles, "styles attribute") as
    | VisualStyles
    | undefined;
  const containerMarkup = parseStylesOrMarkup(containerAttrs.markup, "markup attribute") as
    | SemanticMarkup
    | undefined;
  const cascadedStyles = mergeCascaded(inheritedStyles, containerStyles);
  const cascadedMarkup = mergeCascaded(inheritedMarkup, containerMarkup);

  for (const child of getChildElements(element)) {
    if (BUILTIN_TAGS.has(child.tagName) && child.tagName !== "sequence" && child.tagName !== "stack") {
      continue;
    }

      if (child.tagName === "sequence" || child.tagName === "stack") {
        const childAttrs = parseAttributes(child);
        const childTiming = parseContainerTiming(childAttrs, ctx);
        const childStart = containerStart + (childTiming.startSec ?? 0);
        const nested = parseContainerChildren(
          child,
          ctx,
          componentIndex,
          flow === "sequence" ? cursor : childStart,
          child.tagName as "sequence" | "stack",
          cascadedStyles,
          cascadedMarkup,
        );
        components.push(...nested.components);
        componentIndex = nested.componentIndex;
      if (flow === "sequence") {
        cursor = nested.maxEnd ?? cursor;
      } else if (nested.maxEnd != null) {
        maxEnd = maxEnd == null ? nested.maxEnd : Math.max(maxEnd, nested.maxEnd);
      }
      continue;
    }

    const attrs = parseAttributes(child);
    const parsed = parseComponent(child, ctx, componentIndex);
    parsed.styles = mergeCascaded(cascadedStyles, parsed.styles as VisualStyles | undefined);
    parsed.markup = mergeCascaded(cascadedMarkup, parsed.markup as SemanticMarkup | undefined);
    componentIndex += 1;

    const startOffset = attrs.start ? parseTimeValue(attrs.start, ctx) : undefined;
    const endOffset = attrs.end ? parseTimeValue(attrs.end, ctx) : undefined;
    const durationValue = attrs.duration ? parseTimeValue(attrs.duration, ctx) : undefined;

    const baseStart = flow === "sequence" ? cursor : containerStart;
    const childStart = baseStart + (startOffset ?? 0);
    let childEnd: number | undefined;

    if (durationValue != null) {
      childEnd = childStart + durationValue;
    } else if (endOffset != null) {
      childEnd = containerStart + endOffset;
    } else if (flow === "sequence") {
      childEnd = childStart + DEFAULT_SEQUENCE_CHILD_SECONDS;
    }

    if (childStart != null || childEnd != null) {
      parsed.timing = {
        startSec: childStart,
        endSec: childEnd,
      };
    }

    components.push(parsed);

    if (flow === "sequence") {
      cursor = childEnd ?? cursor;
    } else if (childEnd != null) {
      maxEnd = maxEnd == null ? childEnd : Math.max(maxEnd, childEnd);
    }
  }

  if (flow === "sequence") {
    maxEnd = cursor;
  }

  return { components, componentIndex, maxEnd };
};

const parseLayer = (layerEl: ElementLike, ctx: TimeEvalContext): LayerSpec => {
  const attrs = parseAttributes(layerEl);
  const id = attrs.id;
  if (!id) {
    throw new ParseError("layer tag requires id attribute.");
  }
  const visible = attrs.visible ? parseBoolean(attrs.visible) ?? true : undefined;
  const zIndex = attrs.z ? parseNumber(attrs.z) ?? undefined : undefined;
  const timing = parseTiming(attrs, ctx);
  const styles = parseStylesOrMarkup(attrs.styles, "styles attribute") as VisualStyles | undefined;
  const markup = parseStylesOrMarkup(attrs.markup, "markup attribute") as SemanticMarkup | undefined;

  const components: ComponentSpec[] = [];
  const children = getChildElements(layerEl);
  let componentIndex = 0;
  for (const child of children) {
    if (child.tagName === "sequence" || child.tagName === "stack") {
      const containerAttrs = parseAttributes(child);
      const containerTiming = parseContainerTiming(containerAttrs, ctx);
      const containerStart = containerTiming.startSec ?? 0;
      const parsed = parseContainerChildren(
        child,
        ctx,
        componentIndex,
        containerStart,
        child.tagName as "sequence" | "stack",
        undefined,
        undefined,
      );
      components.push(...parsed.components);
      componentIndex = parsed.componentIndex;
      continue;
    }
    if (BUILTIN_TAGS.has(child.tagName)) {
      continue;
    }
    components.push(parseComponent(child, ctx, componentIndex));
    componentIndex += 1;
  }

  return {
    id,
    styles,
    markup,
    timing: timing
      ? {
          startSec: timing.startSec,
          endSec: timing.endSec,
        }
      : undefined,
    visible,
    zIndex,
    components,
  };
};

const parseScene = (sceneEl: ElementLike, ctx: TimeEvalContext): SceneSpec => {
  const attrs = parseAttributes(sceneEl);
  const id = attrs.id;
  if (!id) {
    throw new ParseError("scene tag requires id attribute.");
  }
  const title = attrs.title ?? id;
  const time = parseTimeRange(attrs, ctx, `scene "${id}"`, true);
  const styles = parseStylesOrMarkup(attrs.styles, "styles attribute") as VisualStyles | undefined;
  const markup = parseStylesOrMarkup(attrs.markup, "markup attribute") as SemanticMarkup | undefined;
  const enter = parseTransitionRef(attrs, ctx, "enter", "enter");
  const exit = parseTransitionRef(attrs, ctx, "exit", "exit");
  const transitionToNext =
    parseTransitionRef(attrs, ctx, "transition-to-next", "transition") ??
    parseTransitionRef(attrs, ctx, "transition", "transition");

  const items: Array<CueSpec | PauseSpec> = [];
  let cueCount = 0;
  const layers: LayerSpec[] = [];
  const components: ComponentSpec[] = [];
  const audio: AudioElementSpec[] = [];
  let audioIndex = 0;
  let componentIndex = 0;

  for (const child of getChildElements(sceneEl)) {
    if (child.tagName === "cue") {
      items.push(parseCue(child, ctx));
      cueCount += 1;
      continue;
    }
    if (child.tagName === "pause") {
      items.push(parsePause(parseAttributes(child), ctx));
      continue;
    }
    if (child.tagName === "layer") {
      layers.push(parseLayer(child, ctx));
      continue;
    }
    if (child.tagName === "audio") {
      audio.push(parseAudioElement(child, ctx, audioIndex));
      audioIndex += 1;
      continue;
    }
    if (child.tagName === "sfx") {
      audio.push(parseAudioElement(child, ctx, audioIndex, "sfx"));
      audioIndex += 1;
      continue;
    }
    if (child.tagName === "music") {
      audio.push(parseAudioElement(child, ctx, audioIndex, "music"));
      audioIndex += 1;
      continue;
    }
    if (child.tagName === "sequence" || child.tagName === "stack") {
      const containerAttrs = parseAttributes(child);
      const containerTiming = parseContainerTiming(containerAttrs, ctx);
      const containerStart = containerTiming.startSec ?? 0;
      const parsed = parseContainerChildren(
        child,
        ctx,
        componentIndex,
        containerStart,
        child.tagName as "sequence" | "stack",
        undefined,
        undefined,
      );
      components.push(...parsed.components);
      componentIndex = parsed.componentIndex;
      continue;
    }
    if (!BUILTIN_TAGS.has(child.tagName)) {
      components.push(parseComponent(child, ctx, componentIndex));
      componentIndex += 1;
    }
  }

  // Cues are optional in V3 (visual-only scenes are allowed).

  return {
    id,
    title,
    time,
    items,
    styles,
    markup,
    layers: layers.length > 0 ? layers : undefined,
    components: components.length > 0 ? components : undefined,
    enter,
    exit,
    transitionToNext,
    audio: audio.length > 0 ? audio : undefined,
  };
};

const parseNarration = (narrationEl: ElementLike, ctx: TimeEvalContext): NarrationSpec => {
  const attrs = parseAttributes(narrationEl);
  const id = attrs.id;
  if (!id) {
    throw new ParseError("narration tag requires id attribute.");
  }
  const time = parseTimeRange(attrs, ctx, `narration "${id}"`, true);
  const items: Array<CueSpec | PauseSpec> = [];

  for (const child of getChildElements(narrationEl)) {
    if (child.tagName === "cue") {
      items.push(parseCue(child, ctx));
      continue;
    }
    if (child.tagName === "pause") {
      items.push(parsePause(parseAttributes(child), ctx));
      continue;
    }
  }

  return {
    kind: "narration",
    id,
    time,
    items,
  };
};

const parseTransition = (transitionEl: ElementLike, ctx: TimeEvalContext): TransitionSpec => {
  const attrs = parseAttributes(transitionEl);
  const id = attrs.id;
  if (!id) {
    throw new ParseError("transition tag requires id attribute.");
  }
  const title = attrs.title ?? undefined;
  let time: TimeRange | undefined;
  let durationSeconds: number | undefined;
  if (attrs.duration && !attrs.start && !attrs.end) {
    durationSeconds = parseTimeValue(attrs.duration, ctx);
  } else {
    time = parseTimeRange(attrs, ctx, `transition \"${id}\"`);
  }
  const effect = attrs.effect ?? attrs.type ?? undefined;
  const ease = attrs.ease ?? undefined;
  const props = attrs.props ? parseJson(attrs.props, "transition props") : undefined;
  const mode = (attrs.mode as TransitionSpec["mode"]) ?? undefined;
  const overflow = (attrs.overflow as TransitionSpec["overflow"]) ?? undefined;
  const overflowAudio = (attrs["overflow-audio"] as TransitionSpec["overflowAudio"]) ?? undefined;
  const styles = parseStylesOrMarkup(attrs.styles, "styles attribute") as VisualStyles | undefined;
  const markup = parseStylesOrMarkup(attrs.markup, "markup attribute") as SemanticMarkup | undefined;

  const layers: LayerSpec[] = [];
  const components: ComponentSpec[] = [];
  const audio: AudioElementSpec[] = [];
  let componentIndex = 0;
  let audioIndex = 0;

  for (const child of getChildElements(transitionEl)) {
    if (child.tagName === "layer") {
      layers.push(parseLayer(child, ctx));
      continue;
    }
    if (child.tagName === "audio") {
      audio.push(parseAudioElement(child, ctx, audioIndex));
      audioIndex += 1;
      continue;
    }
    if (child.tagName === "sfx") {
      audio.push(parseAudioElement(child, ctx, audioIndex, "sfx"));
      audioIndex += 1;
      continue;
    }
    if (child.tagName === "music") {
      audio.push(parseAudioElement(child, ctx, audioIndex, "music"));
      audioIndex += 1;
      continue;
    }
    if (child.tagName === "sequence" || child.tagName === "stack") {
      const containerAttrs = parseAttributes(child);
      const containerTiming = parseContainerTiming(containerAttrs, ctx);
      const containerStart = containerTiming.startSec ?? 0;
      const parsed = parseContainerChildren(
        child,
        ctx,
        componentIndex,
        containerStart,
        child.tagName as "sequence" | "stack",
        undefined,
        undefined,
      );
      components.push(...parsed.components);
      componentIndex = parsed.componentIndex;
      continue;
    }
    if (!BUILTIN_TAGS.has(child.tagName)) {
      components.push(parseComponent(child, ctx, componentIndex));
      componentIndex += 1;
    }
  }

  return {
    kind: "transition",
    id,
    title,
    time,
    effect,
    ease,
    props,
    durationSeconds,
    mode,
    overflow,
    overflowAudio,
    styles,
    markup,
    layers: layers.length > 0 ? layers : undefined,
    components: components.length > 0 ? components : undefined,
    audio: audio.length > 0 ? audio : undefined,
  };
};

const parseMark = (markEl: ElementLike, ctx: TimeEvalContext): MarkSpec => {
  const attrs = parseAttributes(markEl);
  const id = attrs.id;
  if (!id) {
    throw new ParseError("mark tag requires id attribute.");
  }
  const atValue = attrs.at ?? attrs.start;
  if (!atValue) {
    throw new ParseError(`mark \"${id}\" requires at attribute.`);
  }
  const at = parseTimeValue(atValue, ctx);
  return {
    kind: "mark",
    id,
    at,
  };
};

export const loadVideoFileFromXml = (xml: string): VideoFileSpec => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  const rootTag = root?.tagName ?? "";
  const allowedRoots = new Set(["videoml", "video-ml", "vml"]);
  if (!allowedRoots.has(rootTag)) {
    throw new ParseError("XML root must be <vml>, <videoml>, or <video-ml>.");
  }

  try { normalizeSourceElement(root as unknown as SourceElement); }
  catch (error) { throw new ParseError(error instanceof Error ? error.message : String(error)); }
  const attrs = parseAttributes(asElementLike(root));
  const id = attrs.id;
  if (!id) {
    throw new ParseError("video tag requires id attribute.");
  }
  const title = attrs.title ?? null;
  const fps = attrs.fps ? parseNumber(attrs.fps) ?? 30 : 30;
  const width = attrs.width ? parseNumber(attrs.width) ?? 1280 : 1280;
  const height = attrs.height ? parseNumber(attrs.height) ?? 720 : 720;
  const baseCtx: TimeEvalContext = {
    fps,
    getSceneStart: () => null,
    getSceneEnd: () => null,
    getCueStart: () => null,
    getMarkStart: () => null,
    getPrevStart: () => null,
    getPrevEnd: () => null,
    getNextStart: () => null,
  };
  const duration = attrs.duration ? parseTimeValue(attrs.duration, baseCtx) : undefined;
  const poster = attrs.poster ? parseTimeValue(attrs.poster, baseCtx) : undefined;

  const timeline: TimelineItemSpec[] = [];
  let voiceover: VideoFileSpec["compositions"][number]["voiceover"] | undefined;
  const sceneStartIndex = new Map<string, number>();
  const sceneEndIndex = new Map<string, number>();
  const markStartIndex = new Map<string, number>();
  const timelineElements = getChildElements(asElementLike(root)).filter((child) =>
    child.tagName === "scene" ||
    child.tagName === "transition" ||
    child.tagName === "mark" ||
    child.tagName === "narration",
  );
  const cueStartIndex = new Map<string, number>();
  const itemStarts: Array<number | null> = [];
  const itemEnds: Array<number | null> = [];

  const pending = new Set(timelineElements.keys());
  let passes = 0;
  while (pending.size > 0) {
    let progressed = false;
    const snapshot = Array.from(pending);
    for (const index of snapshot) {
      const child = timelineElements[index];
      const ctx: TimeEvalContext = {
        fps,
        getSceneStart: (sceneId) => sceneStartIndex.get(sceneId) ?? null,
        getSceneEnd: (sceneId) => sceneEndIndex.get(sceneId) ?? null,
        getCueStart: (cueId) => cueStartIndex.get(cueId) ?? null,
        getMarkStart: (markId) => markStartIndex.get(markId) ?? null,
        getPrevStart: () => (index === 0 ? 0 : itemStarts[index - 1] ?? null),
        getPrevEnd: () => (index === 0 ? 0 : itemEnds[index - 1] ?? null),
        getNextStart: () => {
          if (index + 1 >= timelineElements.length) return null;
          return itemStarts[index + 1] ?? null;
        },
      };
      try {
        let item: TimelineItemSpec;
        if (child.tagName === "scene") {
          item = parseScene(child, ctx);
          if (item.time?.start != null) {
            sceneStartIndex.set(item.id, item.time.start);
          }
          if (item.time?.end != null) {
            sceneEndIndex.set(item.id, item.time.end);
          }
          for (const sceneItem of item.items) {
            if ("kind" in sceneItem && sceneItem.kind === "cue" && sceneItem.time?.start != null) {
              cueStartIndex.set(sceneItem.id, sceneItem.time.start);
            }
          }
          if (item.time?.start != null) itemStarts[index] = item.time.start;
          if (item.time?.end != null) itemEnds[index] = item.time.end;
        } else if (child.tagName === "transition") {
          item = parseTransition(child, ctx);
          if (item.time?.start != null) itemStarts[index] = item.time.start;
          if (item.time?.end != null) itemEnds[index] = item.time.end;
        } else if (child.tagName === "narration") {
          item = parseNarration(child, ctx);
          if (item.time?.start != null) itemStarts[index] = item.time.start;
          if (item.time?.end != null) itemEnds[index] = item.time.end;
        } else if (child.tagName === "mark") {
          item = parseMark(child, ctx);
          markStartIndex.set(item.id, item.at);
          itemStarts[index] = item.at;
          itemEnds[index] = item.at;
        } else {
          throw new ParseError(`Unsupported timeline element <${child.tagName}>.`);
        }
        timeline[index] = item;
        pending.delete(index);
        progressed = true;
      } catch (err) {
        if (!(err instanceof MissingTimeReferenceError)) {
          throw err;
        }
      }
    }
    passes += 1;
    if (!progressed) {
      const unresolved = Array.from(pending)
        .map((idx) => parseAttributes(timelineElements[idx]).id ?? `item#${idx}`)
        .join(", ");
      throw new ParseError(`Unresolved time references for timeline items: ${unresolved}`);
    }
    if (passes > timelineElements.length + 2) {
      throw new ParseError("Time resolution did not converge.");
    }
  }

  for (const child of getChildElements(asElementLike(root))) {
    if (child.tagName === "voiceover") {
      const voiceoverAttrs = parseAttributes(child);
      if (voiceoverAttrs.seed !== undefined && voiceoverAttrs.seed !== "random" && (!/^\d+$/.test(voiceoverAttrs.seed) || Number(voiceoverAttrs.seed) > 0xffffffff)) throw new ParseError("voiceover seed must be a uint32 or random");
      if (voiceoverAttrs.speed !== undefined && (!Number.isFinite(Number(voiceoverAttrs.speed)) || !voiceoverAttrs.speed.trim() || Number(voiceoverAttrs.speed) <= 0)) throw new ParseError("voiceover speed must be a positive finite number");
      voiceover = {
        pronunciations: getChildElements(child).filter(node => node.tagName === "pronunciation").map(node => {
          const attrs = parseAttributes(node);
          if (!attrs.grapheme || ((!attrs.alias || attrs.phoneme || attrs.alphabet) && (!attrs.phoneme || !attrs.alphabet || attrs.alias))) throw new ParseError("pronunciation requires grapheme and either alias or phoneme with alphabet");
          return {grapheme: attrs.grapheme, alias: attrs.alias, phoneme: attrs.phoneme, alphabet: attrs.alphabet};
        }),
        provider: voiceoverAttrs.provider ?? undefined,
        speed: voiceoverAttrs.speed === undefined ? undefined : Number(voiceoverAttrs.speed),
        voice: voiceoverAttrs.voice ?? undefined,
        model: voiceoverAttrs.model ?? undefined,
        format: voiceoverAttrs.format ?? undefined,
        sampleRateHz: voiceoverAttrs.sampleRateHz ? parseNumber(voiceoverAttrs.sampleRateHz) ?? undefined : undefined,
        seed: voiceoverAttrs.seed === "random" ? "random" : voiceoverAttrs.seed ? parseNumber(voiceoverAttrs.seed) ?? undefined : undefined,
        leadInSeconds: voiceoverAttrs.leadInSeconds
          ? parseTimeValue(voiceoverAttrs.leadInSeconds, baseCtx)
          : undefined,
        trimEndSeconds: voiceoverAttrs.trimEndSeconds
          ? parseTimeValue(voiceoverAttrs.trimEndSeconds, baseCtx)
          : undefined,
      };
    }
  }

  const scenes = timeline.filter((item): item is SceneSpec => !("kind" in item));
  if (scenes.length === 0) {
    throw new ParseError("vml requires at least one scene.");
  }

  const cueIds = new Set<string>();
  for (const scene of scenes) {
    for (const item of scene.items) {
      if ("kind" in item && item.kind === "cue") {
        if (cueIds.has(item.id)) {
          throw new ParseError(`Duplicate cue id across scenes: "${item.id}".`);
        }
        cueIds.add(item.id);
      }
    }
  }
  for (const item of timeline) {
    if ("kind" in item && item.kind === "narration") {
      for (const cueItem of item.items) {
        if ("kind" in cueItem && cueItem.kind === "cue") {
          if (cueIds.has(cueItem.id)) {
            throw new ParseError(`Duplicate cue id across scenes/narration: "${cueItem.id}".`);
          }
          cueIds.add(cueItem.id);
        }
      }
    }
  }

  const markIds = new Set<string>();
  for (const item of timeline) {
    if ("kind" in item && item.kind === "mark") {
      if (markIds.has(item.id)) {
        throw new ParseError(`Duplicate mark id: "${item.id}".`);
      }
      markIds.add(item.id);
    }
  }

  const composition = {
    id,
    title,
    meta: {
      fps,
      width,
      height,
      durationSeconds: duration,
    },
    posterTime: poster ?? undefined,
    voiceover,
    timeline,
  };

  Object.defineProperty(composition, normalizedSourceIds, {value: true});
  const videoFile: VideoFileSpec = {
    compositions: [composition],
  };

  return videoFile;
};

export const loadVideoFileFromXmlWithPatches = (
  xml: string,
  patches: Array<import("./xml-patch.js").VomPatch>,
  opts?: { enforceSealed?: boolean },
): VideoFileSpec => {
  const nextXml = applyVomPatches(xml, patches, { enforceSealed: opts?.enforceSealed });
  return loadVideoFileFromXml(nextXml);
};

export const getXmlAudioPlan = (_root: ElementLike): AudioPlan | undefined => {
  return undefined;
};
