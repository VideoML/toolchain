import { spawn } from "node:child_process";
import { join } from "path";

export type EncodeVideoOptions = {
  framesDir: string;
  fps: number;
  outputPath: string;
  audioPath?: string | null;
  framePattern?: string;
  startNumber?: number; // For preview mode: which frame number to start from
  frameCount?: number; // Total number of frames to encode (for preview mode)
  ffmpegPath?: string;
  ffmpegArgs?: string[];
  signal?: AbortSignal;
};

export type EncodeRunnerResult = {
  code: number | null;
};

export type EncodeRunner = (command: string, args: string[], signal?: AbortSignal) => Promise<EncodeRunnerResult>;

const defaultFramePattern = "frame-%06d.png";

export const buildFfmpegArgs = ({
  framesDir,
  fps,
  outputPath,
  audioPath,
  framePattern = defaultFramePattern,
  startNumber,
  frameCount,
  ffmpegArgs,
}: EncodeVideoOptions): string[] => {
  const args = ["-y", "-framerate", String(fps)];

  // If preview mode with non-zero start, tell ffmpeg which frame to start from
  if (startNumber !== undefined && startNumber > 0) {
    args.push("-start_number", String(startNumber));
  }

  args.push("-i", join(framesDir, framePattern));
  if (audioPath) {
    // Calculate audio offset from start frame number
    // If we're starting from frame N, we need to skip N/fps seconds in the audio
    // Place -ss BEFORE the audio input for input seeking (faster and more accurate)
    if (startNumber !== undefined && startNumber > 0) {
      const audioOffsetSec = startNumber / fps;
      args.push("-ss", String(audioOffsetSec));
    }
    args.push("-i", audioPath);
    // Only use -shortest if we're NOT specifying exact frame count
    // When frameCount is specified, we're in preview mode and explicitly control video length
    if (frameCount === undefined) {
      args.push("-shortest");
    }
  }

  // Output options come after all inputs
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  // Add keyframe interval for better compatibility with video players
  args.push("-g", String(Math.max(1, Math.floor(fps))));
  if (audioPath) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push("-r", String(fps));

  // If frameCount is specified, limit the number of video frames to encode
  // This is crucial for preview mode to only encode the frames we rendered
  if (frameCount !== undefined) {
    args.push("-frames:v", String(frameCount));
  }
  if (ffmpegArgs && ffmpegArgs.length) {
    args.push(...ffmpegArgs);
  }
  args.push(outputPath);
  return args;
};

const spawnRunner: EncodeRunner = (command, args, signal) =>
  new Promise((resolve, reject) => {
    if(signal?.aborted){reject(new Error('RENDER_CANCELLED'));return;}
    if(signal&&process.platform==='win32'){reject(new Error('RENDER_CAPABILITY_UNAVAILABLE: encoder tree cancellation is unsupported on Windows'));return;}
    const child=spawn(command,args,{stdio:'inherit',detached:process.platform!=='win32'});let aborted=false,closed=false,done=false,probe:ReturnType<typeof setInterval>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
    const finish=(error?:Error,code?:number|null)=>{if(done)return;done=true;signal?.removeEventListener('abort',cancel);if(probe)clearInterval(probe);if(killTimer)clearTimeout(killTimer);if(deadline)clearTimeout(deadline);if(error)reject(error);else resolve({code:code??null});};
    const groupSignal=(name:NodeJS.Signals|0)=>{if(!child.pid)throw new Error('encoder process group unavailable');try{process.kill(-child.pid,name);return true;}catch(error:any){if(error?.code==='ESRCH')return false;throw error;}};
    const check=()=>{try{if(closed&&!groupSignal(0))finish(new Error('RENDER_CANCELLED'));}catch(error){finish(new Error(`RENDER_CLEANUP_UNCONFIRMED: ${String(error)}`));}};
    const cancel=()=>{if(aborted||done)return;aborted=true;try{groupSignal('SIGTERM');}catch(error){finish(new Error(`RENDER_CLEANUP_UNCONFIRMED: ${String(error)}`));return;}probe=setInterval(check,50);killTimer=setTimeout(()=>{try{groupSignal('SIGKILL');check();}catch(error){finish(new Error(`RENDER_CLEANUP_UNCONFIRMED: ${String(error)}`));}},2000);deadline=setTimeout(()=>finish(new Error('RENDER_CLEANUP_UNCONFIRMED: encoder process group did not terminate')),4000);check();};
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    child.on('error',error=>finish(error));child.on('close',code=>{closed=true;if(aborted)check();else finish(undefined,code);});
  });

export const encodeVideo = async (options: EncodeVideoOptions, runner: EncodeRunner = spawnRunner): Promise<void> => {
  const command = options.ffmpegPath ?? "ffmpeg";
  const args = buildFfmpegArgs(options);
  let result: EncodeRunnerResult;
  try {
    result = await runner(command, args, options.signal);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      throw new Error(`ffmpeg not found at ${command}`);
    }
    throw error;
  }
  if (!result || result.code !== 0) {
    throw new Error(`ffmpeg failed with code ${result?.code ?? "unknown"}`);
  }
};
