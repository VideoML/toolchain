import { slugify } from "./util.js";
import type { SemanticMarkup, VisualStyles, LayerSpec, ComponentSpec, TransitionSpec, TransitionRef } from "./dsl/types.js";

export type Bullet = { id: string; text: string };

/**
 * Segment-level timing for individual voice.say() calls within a cue.
 */
export type CueSegment = {
  type: "tts" | "pause";
  startSec: number;
  endSec: number;
  text?: string;
  durationSec?: number;
};

export type CuePoint = {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
  text: string;
  bullets: Bullet[];
  segments?: CueSegment[];
  markup?: SemanticMarkup;
};

export type Scene = {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  cues: CuePoint[];
  markup?: SemanticMarkup;
  styles?: VisualStyles;
  layers?: LayerSpec[];
  components?: ComponentSpec[];
  enter?: TransitionRef;
  exit?: TransitionRef;
  transitionToNext?: TransitionRef;
};

export type SceneTimelineItem = {
  kind: "scene";
  sceneId: string;
  startSec: number;
  endSec: number;
};

export type TransitionTimelineItem = {
  kind: "transition";
  id: string;
  startSec: number;
  endSec: number;
  effect?: string;
  ease?: string;
  props?: Record<string, unknown>;
  mode?: TransitionSpec["mode"];
  overflow?: TransitionSpec["overflow"];
  overflowAudio?: TransitionSpec["overflowAudio"];
  fromSceneId?: string;
  toSceneId?: string;
  styles?: VisualStyles;
  markup?: SemanticMarkup;
  layers?: LayerSpec[];
  components?: ComponentSpec[];
};

export type MarkTimelineItem = {
  kind: "mark";
  id: string;
  atSec: number;
};

export type ScriptMeta = {
  fps?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  generationSeed?: number;
  assets?: Array<{id:string;path:string;mediaType:string;sha256:string}>;
};

export type Script = {
  scenes: Scene[];
  timeline?: Array<SceneTimelineItem | TransitionTimelineItem | MarkTimelineItem>;
  posterTimeSec?: number | null;
  fps?: number;
  meta?: ScriptMeta;
};

export function makeBullet(text: string): Bullet {
  return { id: slugify(text), text };
}

export function scriptToJson(script: Script): Record<string, unknown> {
  const out: Record<string, unknown> = {
    scenes: script.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      startSec: scene.startSec,
      endSec: scene.endSec,
      ...(scene.markup ? { markup: scene.markup } : {}),
      ...(scene.styles ? { styles: scene.styles } : {}),
      ...(scene.layers ? { layers: scene.layers } : {}),
      ...(scene.components ? { components: scene.components } : {}),
      ...(scene.enter ? { enter: scene.enter } : {}),
      ...(scene.exit ? { exit: scene.exit } : {}),
      ...(scene.transitionToNext ? { transitionToNext: scene.transitionToNext } : {}),
      cues: scene.cues.map((cue) => ({
        id: cue.id,
        label: cue.label,
        startSec: cue.startSec,
        endSec: cue.endSec,
        text: cue.text,
        ...(cue.markup ? { markup: cue.markup } : {}),
        ...(cue.segments ? { segments: cue.segments } : {}),
        bullets: cue.bullets.map((b) => ({ id: b.id, text: b.text })),
      })),
    })),
  };
  if (script.timeline) {
    out.timeline = script.timeline.map((item) => {
      if (item.kind === "scene") {
        return {
          kind: item.kind,
          sceneId: item.sceneId,
          startSec: item.startSec,
          endSec: item.endSec,
        };
      }
      if (item.kind === "transition") {
        return {
          kind: item.kind,
          id: item.id,
          startSec: item.startSec,
          endSec: item.endSec,
          ...(item.effect ? { effect: item.effect } : {}),
          ...(item.ease ? { ease: item.ease } : {}),
          ...(item.props ? { props: item.props } : {}),
          ...(item.mode ? { mode: item.mode } : {}),
          ...(item.overflow ? { overflow: item.overflow } : {}),
          ...(item.overflowAudio ? { overflowAudio: item.overflowAudio } : {}),
          ...(item.fromSceneId ? { fromSceneId: item.fromSceneId } : {}),
          ...(item.toSceneId ? { toSceneId: item.toSceneId } : {}),
          ...(item.styles ? { styles: item.styles } : {}),
          ...(item.markup ? { markup: item.markup } : {}),
          ...(item.layers ? { layers: item.layers } : {}),
          ...(item.components ? { components: item.components } : {}),
        };
      }
      return {
        kind: item.kind,
        id: item.id,
        atSec: item.atSec,
      };
    });
  }
  if (script.posterTimeSec != null) {
    out.posterTimeSec = script.posterTimeSec;
  }
  if (script.fps != null) {
    out.fps = script.fps;
  }
  if (script.meta) {
    out.meta = script.meta;
  }
  return out;
}
