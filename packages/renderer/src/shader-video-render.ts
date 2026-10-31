import {prepareSceneSnapshots} from './prepare-scene-snapshots.js';
import {mkdtemp,rm,writeFile,copyFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSafeEsbuild} from './safe-esbuild.js';
import {shaderNames,validateTransitionOptions} from '@videoml/stdlib/effects/transitions';
import {captureTransitionFrames} from './transition-capture.js';
import {renderFramesToPng,type RenderFramesPngOptions,type RenderFramesResult} from './render.js';

export function hasShaderTransitions(script:unknown):boolean {return !!script && typeof script==='object' && Array.isArray((script as any).timeline) && (script as any).timeline.some((item:any)=>item.kind==='transition' && shaderNames.includes(item.effect));}

/** Render normal frames and replace shader intervals with P07 browser-painted scene captures. */
export async function renderShaderFrames(options:RenderFramesPngOptions):Promise<RenderFramesResult>{
 if(options.signal?.aborted)throw new Error('RENDER_CANCELLED');
 const script=options.inputProps?.script as any;
 const transitions=(script?.timeline ?? []).filter((item:any)=>item.kind==='transition' && shaderNames.includes(item.effect));
 if(!transitions.length)return renderFramesToPng(options);
 if(options.browser || options.browserBundlePath || options.browserBundlePaths)throw new Error('SCENE_CAPTURE_UNAVAILABLE: custom browser or scene bundle is not supported by automatic shader capture');
 const fps=options.config.fps, first=options.startFrame ?? 0,last=Math.min(options.endFrame ?? options.config.durationFrames-1,options.config.durationFrames-1);
 const ranges=transitions.map((item:any)=>{
  if(!Number.isFinite(item.startSec)||!Number.isFinite(item.endSec)||item.endSec<=item.startSec||!item.fromSceneId||!item.toSceneId||item.fromSceneId===item.toSceneId||!script.scenes?.some((scene:any)=>scene.id===item.fromSceneId)||!script.scenes?.some((scene:any)=>scene.id===item.toSceneId))throw new Error('SCENE_CAPTURE_UNAVAILABLE: shader transition requires two valid source IDs and a bounded interval');
  return {item,start:Math.floor(item.startSec*fps),end:Math.ceil(item.endSec*fps),parameters:validateTransitionOptions(item.props ?? {})};
 });
 for(let i=0;i<ranges.length;i++)for(let j=i+1;j<ranges.length;j++)if(ranges[i].start<ranges[j].end&&ranges[j].start<ranges[i].end)throw new Error('TRANSITION_INVALID: overlapping shader transitions');
 const temp=await mkdtemp(join(tmpdir(),'videoml-shader-render-'));let result:RenderFramesResult|undefined,failed=false,uncertain=false;
 try {
  const rendererDir=dirname(fileURLToPath(import.meta.url));
  const builds=Promise.all(['frame-effect-browser.tsx','shader-compositor-browser.ts'].map(entry=>loadSafeEsbuild(import.meta.url).build({entryPoints:[join(rendererDir,entry)],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})));
  let onAbort:()=>void=()=>{};const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error('RENDER_CANCELLED'));options.signal?.addEventListener('abort',onAbort,{once:true});if(options.signal?.aborted)onAbort();});let scene,compositor;try{[scene,compositor]=await Promise.race([builds,aborted]);}catch(error){if(options.signal?.aborted){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([builds.then(()=>{},()=>{}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('RENDER_CLEANUP_UNCONFIRMED: shader build did not settle')),options.effectStageTimeoutMs??30000);})]);}finally{if(timer)clearTimeout(timer);}}throw error;}finally{options.signal?.removeEventListener('abort',onAbort);}
  const sceneBundle=join(temp,'scene.js'),compositorBundle=join(temp,'compositor.js');await Promise.all([writeFile(sceneBundle,scene.outputFiles[0].contents),writeFile(compositorBundle,compositor.outputFiles[0].contents)]);
  const snapshots=options.preparedSceneSnapshots ?? await prepareSceneSnapshots({script,width:options.config.width,height:options.config.height,fps:options.config.fps,seed:Number(options.inputProps?.effectSeed??0),assets:(options.inputProps?.effectAssets??{}) as Record<string,unknown>,durationFrames:options.config.durationFrames,bundle:scene.outputFiles[0].text,signal:options.signal,portableBundlePath:options.effectRegistryBundlePath,portableComponents:options.portableComponents,customEffects:options.customEffects});
  const intermediate=structuredClone(script);for(const item of intermediate.timeline ?? [])if(item.kind==='transition'&&shaderNames.includes(item.effect))item.effect='crossfade';
  result=await renderFramesToPng({...options,inputProps:{...options.inputProps,script:intermediate},forceLocalSceneRenderer:true,preparedSceneSnapshots:snapshots,onFrame:undefined});
  const targets=new Map(result.frames.map(frame=>[frame.frame,frame.path]));
  for(const range of ranges){const frames:number[]=[];for(let frame=Math.max(first,range.start);frame<=Math.min(last,range.end-1);frame++)frames.push(frame);if(!frames.length)continue;
   const captured=await captureTransitionFrames({fromBundlePath:sceneBundle,toBundlePath:sceneBundle,compositorBundlePath:compositorBundle,width:options.config.width,height:options.config.height,frames,startFrame:range.start,endFrame:range.end,fps,seed:Number(options.inputProps?.effectSeed ?? 0),assets:(options.inputProps?.effectAssets ?? {}) as Record<string,unknown>,fromSceneId:range.item.fromSceneId,toSceneId:range.item.toSceneId,shader:range.item.effect,parameters:range.parameters,easeName:range.item.ease,sceneScript:script,durationFrames:options.config.durationFrames,allowCrossfadeFallback:options.transitionAllowCrossfadeFallback,onDiagnostic:options.onTransitionDiagnostic,signal:options.signal,stageTimeoutMs:options.effectStageTimeoutMs,portableBundlePath:options.effectRegistryBundlePath,portableComponents:options.portableComponents,portableMode:options.portableMode,customEffects:options.customEffects,snapshots,outDir:join(temp,`transition-${ranges.indexOf(range)}`)});
   for(let i=0;i<frames.length;i++){const target=targets.get(frames[i]);if(!target)throw new Error('Missing shader output frame');await copyFile(captured[i],target);}
  }
  for(const frame of result.frames)options.onFrame?.(frame.frame,frame.path);
  return result;
 } catch(error){failed=true;uncertain=String(error).includes('RENDER_CLEANUP_UNCONFIRMED');if(!uncertain&&result)await Promise.all(result.frames.map(frame=>unlink(frame.path).catch(()=>{})));if(uncertain)throw new Error(`${String(error)}; retained shader staging: ${temp}`);throw error;}
 finally{if(!uncertain)try{await rm(temp,{recursive:true,force:true});}catch(error){if(!failed)throw error;}}
}
