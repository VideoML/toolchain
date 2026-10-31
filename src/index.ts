export * from "./dsl/index.js";

export {
  loadConfig,
  findConfigPath,
  findProjectRoot,
  getDefaultMusicProvider,
  getDefaultProvider,
  getDefaultSfxProvider,
  getProviderConfig,
  type Config,
} from "./config.js";

export { BabulusError, ParseError, CompileError } from "./errors.js";

export { loadVideoFile } from "./dsl/load.js";
export type { CompositionSpec, VideoFileSpec } from "./dsl/types.js";

export { generateComposition, type GenerateOptions, type GeneratedArtifact } from "./generate.js";

export { renderVideoFromScript } from "@videoml/renderer/video-render";
export type { ScriptData } from "@videoml/shared";
export type { TimelineData } from "@videoml/shared";

export { GenerationSession, AuritusProvider } from "./providers/tts/auritus.js";

export {importPortableBundle,validatePortableBundle,type BundleInput} from './bundle/public.js';
export {exportPortableBundle,type BundleExport} from './bundle/export.js';
export {renderPortableBundle} from './bundle/render.js';
export {createPortableLock} from './bundle/create-lock.js';

export {collectRuntimeTargetDescriptor} from './bundle/runtime-lock.js';
