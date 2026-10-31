import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {commitPortableOutput} from './output-commit.js';
import {verifyRuntimeLock} from './runtime-lock.js';
import {importPortableBundle,type BundleInput} from './public.js';
import {renderVideoFromScript} from '@videoml/renderer/video-render';
/** Verify a private staging copy and render using the local request-isolated browser bundle. */
export async function renderPortableBundle(input:BundleInput&{framesDir:string;outputPath:string;ffmpegPath?:string;workers?:number}){
 const scratch=await realpath(await mkdtemp(join(tmpdir(),'videoml-bundle-render-')));let outputScratch:string|undefined,clean=false;
 try{
  const destination=join(scratch,'bundle'),{manifest}=await importPortableBundle({...input,destination});
  await verifyRuntimeLock(manifest.dependencies,dirname(fileURLToPath(import.meta.url)));
  const script=JSON.parse(await readFile(join(destination,...manifest.composition.script.split('/')),'utf8'));
  const timing=JSON.parse(await readFile(join(destination,...manifest.composition.timing.split('/')),'utf8'));
  const cueIds=timing.cues.map((cue:{id:string})=>JSON.parse(cue.id.slice('cue:'.length))[0]);
  const timeline={items:cueIds.map((cueId:string)=>({type:'tts',cueId,segments:[]})),sourceCueOrder:cueIds};
  outputScratch=await mkdtemp(join(dirname(input.outputPath),'.videoml-output-'));const stagedOutput=join(outputScratch,'output.mp4');
  const result=await renderVideoFromScript({script,timeline:timeline as any,resolvedTiming:timing,resolvedTimingRoot:destination,assetBaseDir:dirname(join(destination,...manifest.composition.script.split('/'))),audioPath:manifest.composition.audio?join(destination,...manifest.composition.audio.split('/')):null,framesDir:input.framesDir,outputPath:stagedOutput,ffmpegPath:input.ffmpegPath??'ffmpeg',workers:input.workers,signal:input.signal,forceLocalSceneRenderer:true,portableMode:true,portableComponents:manifest.composition.customComponents??[],customEffects:manifest.composition.customEffects??[],...(manifest.composition.browserBundle?{effectRegistryBundlePath:join(destination,...manifest.composition.browserBundle.split('/'))}:{})});
  commitPortableOutput(stagedOutput,input.outputPath,input.signal);clean=true;return {...result,outputPath:input.outputPath};
 }catch(error){if(!String(error).includes('BUNDLE_CLEANUP_UNCONFIRMED')&&!String(error).includes('BUNDLE_PUBLICATION_UNCONFIRMED')&&!String(error).includes('RENDER_CLEANUP_UNCONFIRMED'))clean=true;else throw new Error(`${String(error)}; retained staging: ${scratch}${outputScratch?`, ${outputScratch}`:''}`);throw error;}finally{if(clean){await rm(scratch,{recursive:true,force:true});if(outputScratch)await rm(outputScratch,{recursive:true,force:true});}}
}
