import type React from "react";
import { encodeVideo, type EncodeRunner, type EncodeVideoOptions } from "./encode.js";
import {
  renderFramesToPng,
  type RenderFramesPngOptions,
  type RenderFramesResult,
  type RenderFrameOptions,
} from "./render.js";
import type { VideoConfig } from "./context.js";

export type RenderVideoOptions<TInputProps extends Record<string, unknown> = Record<string, unknown>> = {
  component: React.ComponentType<TInputProps>;
  config: VideoConfig;
  outputPath: string;
  framesDir: string;
  inputProps?: TInputProps;
  audioPath?: string | null;
  framePattern?: string;
  startFrame?: number;
  endFrame?: number;
  deviceScaleFactor?: number;
  workers?: number;
  ffmpegPath?: string;
  ffmpegArgs?: string[];
  browser?: RenderFramesPngOptions["browser"];
  effectRegistryBundlePath?: RenderFramesPngOptions["effectRegistryBundlePath"];
  effectStageTimeoutMs?: RenderFramesPngOptions["effectStageTimeoutMs"];
  browserBundlePath?: RenderFramesPngOptions["browserBundlePath"]; // Deprecated
  browserBundlePaths?: RenderFramesPngOptions["browserBundlePaths"]; // Multiple bundles
  onFrame?: RenderFramesPngOptions["onFrame"];
  cleanFrames?: boolean; // If true, delete existing frames before rendering (default: true)
  renderFrames?: (options: RenderFramesPngOptions) => Promise<RenderFramesResult>;
  encode?: (options: EncodeVideoOptions, runner?: EncodeRunner) => Promise<void>;
  encodeRunner?: EncodeRunner;
};

export type RenderVideoResult = {
  frames: RenderFramesResult["frames"];
  outputPath: string;
};

export const renderVideo = async <TInputProps extends Record<string, unknown> = Record<string, unknown>>({
  component,
  config,
  outputPath,
  framesDir,
  inputProps,
  audioPath,
  framePattern = "frame-%06d.png",
  startFrame,
  endFrame,
  deviceScaleFactor,
  workers,
  ffmpegPath,
  ffmpegArgs,
  browser,
  effectRegistryBundlePath,
  effectStageTimeoutMs,
  browserBundlePath,
  browserBundlePaths,
  onFrame,
  cleanFrames,
  renderFrames,
  encode,
  encodeRunner,
}: RenderVideoOptions<TInputProps>): Promise<RenderVideoResult> => {
  const render = renderFrames ?? renderFramesToPng;
  const encoder = encode ?? encodeVideo;
  const frameOptions: RenderFramesPngOptions = {
    component,
    config,
    inputProps,
    outDir: framesDir,
    startFrame,
    endFrame,
    framePattern,
    deviceScaleFactor,
    workers,
    browser,
    effectRegistryBundlePath,
    effectStageTimeoutMs,
    browserBundlePath,
    browserBundlePaths,
    onFrame,
    cleanFrames,
  };
  const framesResult = await render(frameOptions);
  if (!framesResult.frames.length) {
    throw new Error("No frames rendered.");
  }

  // Always encode video, even in preview mode
  // For preview mode with non-zero start, ffmpeg will use start_number to find the correct frames
  await encoder(
    {
      framesDir,
      fps: config.fps,
      outputPath,
      audioPath,
      framePattern,
      startNumber: startFrame, // Pass startFrame so ffmpeg knows where frames begin
      frameCount: framesResult.frames.length, // Number of frames actually rendered
      ffmpegPath,
      ffmpegArgs,
    },
    encodeRunner,
  );

  return { frames: framesResult.frames, outputPath };
};
