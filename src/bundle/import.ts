import {validateResolvedTiming,type ResolvedTiming} from '@videoml/shared/resolved-timing';
import {DirectoryStage,type InventoryFile} from './stage.js';
import {verifyBundleInventory,validateManifestRoles,type BundleManifest} from './manifest.js';
import {verifyBundleLock} from './lock.js';
import {validateBundleAudio} from './audio.js';
type SourceVerifier=(input:{source:Buffer;script:Record<string,unknown>;timing:ResolvedTiming;manifest:BundleManifest;stage:DirectoryStage;inventory:InventoryFile[]})=>Promise<void>;
function json(bytes:Buffer,label:string):unknown {try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error(`BUNDLE_MANIFEST: invalid ${label} JSON`);}}
/** Prepare and validate staged bytes; a trusted source-semantic verifier is mandatory before commit. */
export async function prepareVerifiedBundle(options:{source:string;destination:string;sourceKind?:'directory'|'zip';python?:string;expectedDigest?:string;signal?:AbortSignal;verifySource:SourceVerifier}){
 if(typeof options.verifySource!=='function')throw new Error('BUNDLE_CAPABILITY_UNAVAILABLE: source verification is required');
 const {stage,files}=await DirectoryStage.prepare(options.source,options.destination,{sourceKind:options.sourceKind,python:options.python,signal:options.signal});
 try{
  const manifest=verifyBundleInventory(json(await stage.read('videoml-project.json',options.signal),'manifest'),files,options.expectedDigest);
  const lock=json(await stage.read('dependencies.lock.json',options.signal),'dependency lock');
  verifyBundleLock(lock,manifest);
  const timing=json(await stage.read(manifest.composition.timing,options.signal),'timing');validateResolvedTiming(timing);
  if(timing.fps!==manifest.fps||timing.durationFrames!==manifest.durationFrames||timing.generationSeed!==manifest.seed)throw new Error('BUNDLE_TIMING: manifest identity mismatch');
  validateManifestRoles(manifest,timing.segments.map(segment=>segment.audioPath));
  await validateBundleAudio(stage,manifest,timing,files);
  const script=json(await stage.read(manifest.composition.script,options.signal),'script');if(!script||typeof script!=='object'||Array.isArray(script))throw new Error('BUNDLE_SCRIPT: invalid script');const meta=(script as Record<string,any>).meta;
  if(!meta||typeof meta!=='object'||meta.compositionId!==manifest.composition.id||meta.width!==manifest.width||meta.height!==manifest.height||meta.fps!==manifest.fps)throw new Error('BUNDLE_SCRIPT: composition metadata mismatch');
  const source=await stage.read(manifest.entry,options.signal);
  await options.verifySource({source,script:script as Record<string,unknown>,timing,manifest,stage,inventory:files});
  return {stage,manifest,timing,script};
 }catch(error){try{await stage.abort();}catch(cleanup){throw new Error(`BUNDLE_CLEANUP_UNCONFIRMED: ${String(cleanup)}; original: ${String(error)}`);}throw error;}
}
