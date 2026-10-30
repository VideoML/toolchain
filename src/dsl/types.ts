export type TimeRange = {
  start: number;
  end?: number;
  startIsRelative?: boolean;
  endIsRelative?: boolean;
};

export type MarkupValue =
  | string
  | number
  | boolean
  | null
  | MarkupValue[]
  | { [key: string]: MarkupValue };

export type SemanticMarkup = Record<string, MarkupValue>;

export type PauseSpec =
  | { kind: "pause"; mode: "fixed"; seconds: number }
  | { kind: "pause"; mode: "gaussian"; mean: number; std: number; min?: number; max?: number };

export type VoiceSegmentSpec =
  | { kind: "text"; text: string; trimEndSec?: number | null }
  | { kind: "pause"; pause: PauseSpec };

export type CueSpec = {
  kind: "cue";
  id: string;
  label: string;
  segments: VoiceSegmentSpec[];
  bullets: string[];
  markup?: SemanticMarkup;
  time?: TimeRange;
  provider?: string | null;
};

export type TransitionRef = {
  effect: string;
  durationSeconds?: number;
  ease?: string;
  props?: Record<string, unknown>;
};

export type SceneSpec = {
  id: string;
  title: string;
  time?: TimeRange;
  items: Array<CueSpec | PauseSpec>;
  markup?: SemanticMarkup; // Deprecated - use styles instead
  styles?: VisualStyles; // Scene-level styles (cascade to layers/components)
  layers?: LayerSpec[]; // Grouped components with shared styles
  components?: ComponentSpec[]; // Visual components to render (backward compat)
  enter?: TransitionRef;
  exit?: TransitionRef;
  transitionToNext?: TransitionRef;
  audio?: AudioElementSpec[];
};

export type TransitionSpec = {
  kind: "transition";
  id: string;
  title?: string;
  time?: TimeRange;
  effect?: string;
  ease?: string;
  props?: Record<string, unknown>;
  mode?: "overlap" | "insert";
  durationSeconds?: number;
  overflow?: "clip" | "extend" | "allow";
  overflowAudio?: "clip" | "extend" | "allow";
  markup?: SemanticMarkup;
  styles?: VisualStyles;
  layers?: LayerSpec[];
  components?: ComponentSpec[];
  audio?: AudioElementSpec[];
};

export type MarkSpec = {
  kind: "mark";
  id: string;
  at: number;
};

export type NarrationSpec = {
  kind: "narration";
  id: string;
  time?: TimeRange;
  items: Array<CueSpec | PauseSpec>;
};

export type PronunciationLexemeSpec = {
  grapheme: string;
  phoneme?: string;
  alphabet?: string;
  alias?: string;
};

export type VoiceoverConfig = {
  speed?: number;
  provider?: string | null;
  voice?: string | null;
  model?: string | null;
  format?: string;
  sampleRateHz?: number;
  seed?: number;
  leadInSeconds?: number;
  trimEndSeconds?: number;
  /**
   * Pause inserted between consecutive scene items.
   * Use `pause(0.4)` for fixed or `pause(0.4, 0.1)` for Gaussian.
   */
  pauseBetweenItems?: PauseSpec | number;
  pronunciationDictionaryLocators?: Array<{ pronunciationDictionaryId: string; versionId?: string | null }>;
  pronunciationDictionary?: {
    name?: string;
    workspaceAccess?: string | null;
    description?: string | null;
  };
  pronunciations?: PronunciationLexemeSpec[];
  maxTtsSegmentSeconds?: number;
};

export type VolumeFadeToSpec = {
  volume: number;
  afterSeconds: number;
  fadeDurationSeconds?: number;
};

export type VolumeFadeOutSpec = {
  volume: number;
  beforeEndSeconds: number;
  fadeDurationSeconds?: number;
};

export type CueRef = { cueId: string; offsetSec?: number };
export type SceneRef = { sceneId: string; offsetSec?: number };
export type MarkRef = { markId: string; offsetSec?: number };

export type StartAt =
  | { kind: "absolute"; sec: number }
  | { kind: "cue"; cue: CueRef }
  | { kind: "scene"; scene: SceneRef }
  | { kind: "mark"; mark: MarkRef };

export type AudioElementSpec = {
  id: string;
  kind: "file" | "sfx" | "music";
  time?: TimeRange;
  volume?: number;
  fadeTo?: VolumeFadeToSpec;
  fadeOut?: VolumeFadeOutSpec;
  sourceId?: string | null;
  playThrough?: boolean;
  src?: string;
  prompt?: string;
  durationSeconds?: number | null;
  variants?: number;
  pick?: number;
  modelId?: string | null;
  forceInstrumental?: boolean | null;
};

export type AudioClipSpec = {
  id: string;
  kind: "file" | "sfx" | "music";
  start: StartAt;
  volume?: number;
  fadeTo?: VolumeFadeToSpec;
  fadeOut?: VolumeFadeOutSpec;
  sourceId?: string | null;
  playThrough?: boolean;
  src?: string;
  prompt?: string;
  durationSeconds?: number | null;
  variants?: number;
  pick?: number;
  modelId?: string | null;
  forceInstrumental?: boolean | null;
};

export type AudioTrackSpec = {
  id: string;
  kind: string;
  clips: AudioClipSpec[];
};

export type AudioPlan = {
  sfxProvider?: string | null;
  musicProvider?: string | null;
  tracks: AudioTrackSpec[];
};

export type CompositionMeta = {
  fps?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type CompositionSpec = {
  id: string;
  title?: string | null;
  meta?: CompositionMeta;
  posterTime?: number | null;
  voiceover?: VoiceoverConfig;
  audioProviders?: { sfx?: string | null; music?: string | null };
  timeline: TimelineItemSpec[];
  audioPlan?: AudioPlan;
};

export type SeriesSpec = {
  id: string;
  episodes: Array<{ id: string; props?: Record<string, unknown> }>;
  compositionId?: string;
};

// Component system types
export type DataReference =
  | `scene.${string}` // scene.title, scene.id
  | `cue.${string}` // cue.text, cue.label
  | `frame.${string}` // frame.number, frame.time
  | string; // Literal value

export type ComponentBindings = {
  [propName: string]: DataReference;
};

// Visual styles (cascadable properties)
export type VisualStyles = {
  // Color & appearance
  background?: string;
  color?: string;
  opacity?: number; // 0-1, multiplicative when cascading

  // Typography
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  textAlign?: "left" | "center" | "right";

  // CSS variable theme tokens (fonts/colors)
  vars?: Record<string, string>;

  // Future: transforms, filters, etc.
};

export type ComponentSpec = {
  id: string; // Unique ID within scene/layer
  type: string | React.ComponentType<any>; // Component type or React element
  props?: Record<string, unknown>; // Static props
  bindings?: ComponentBindings; // Data bindings to scene/cue
  styles?: VisualStyles; // Component-level styles (cascade from layer/scene)
  markup?: SemanticMarkup; // Component-level markup (cascade from layer/scene)
  zIndex?: number; // Layer ordering (higher = front)
  visible?: boolean; // Show/hide
  timing?: {
    // When to show
    startSec?: number;
    endSec?: number;
  };
};

// Layer specification (groups components with shared styles/timing)
export type LayerSpec = {
  id: string; // Unique ID within scene
  styles?: VisualStyles; // Layer-level styles (cascade from scene)
  markup?: SemanticMarkup; // Layer-level markup (cascade from scene)
  timing?: {
    // When to show layer
    startSec?: number;
    endSec?: number;
  };
  visible?: boolean; // Show/hide entire layer
  zIndex?: number; // Base zIndex for layer
  components: ComponentSpec[]; // Components in this layer
};

export type TimelineItemSpec = SceneSpec | TransitionSpec | MarkSpec | NarrationSpec;

export type VideoFileSpec = {
  compositions: CompositionSpec[];
  series?: SeriesSpec[];
};

export type CompositionDefaults = Partial<Pick<CompositionSpec, "voiceover" | "audioProviders" | "meta">> & {
  audioPlan?: Partial<AudioPlan>;
};

// Animation types
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

export type TransitionConfig = {
  type: 'fade' | 'slide' | 'push' | 'scale' | 'wipe' | 'typewriter' | 'spring';
  durationFrames: number;
  easing?: string; // Name of easing function
  delayFrames?: number;
  direction?: TransitionDirection;
  from?: number;
  to?: number;
  distance?: number;
  // ... other type-specific options as needed
};

export type StaggerConfig = {
  count: number;
  delayFrames: number;
  pattern?: 'linear' | 'reverse' | 'from-center' | 'from-edges' | 'random';
  seed?: number;
};

// Layout and component types
export type LayoutType =
  | 'TitleSlide'
  | 'TwoColumn'
  | 'Grid'
  | 'Sidebar'
  | 'SplitScreen'
  | 'ChapterHeading'
  | 'QuoteCard'
  | 'FlexPage'
  | 'BulletListScreen'
  | 'ContentScreen'
  | 'TwoColumnScreen'
  | 'ThreeColumnScreen'
  | 'GridScreen';

export type MotionComponentType =
  | 'Chyron'
  | 'LowerThird'
  | 'BulletList'
  | 'Callout'
  | 'CodeBlock'
  | 'Icon';
