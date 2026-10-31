import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,posix,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DirectoryStage,type InventoryFile} from './stage.js';
import {canonicalBundlePath} from './core.js';
import {collectRuntimeLock} from './runtime-lock.js';
import {loadVideoFileFromXml} from '../dsl/xml.js';
import {selectComposition} from './selection.js';
import {compileTsClosure,executeCompiledSource} from './ts-execution.js';
import {selectSourceValue} from './source-value.js';
import {validateAssetMedia} from '../assets/local.js';
/** Compute pins from the trusted installed runtime and selected source's declared fonts. */
export async function createPortableLock(options:{source:string;entry:string;composition?:string;python?:string;signal?:AbortSignal;executeSource?:boolean;sourceClosure?:string[]}){return createPortableLockWithRuntime(options,dirname(fileURLToPath(import.meta.url)));}
/** Internal seam for deterministic runtime-lock tests; not exported from the package entry. */
export async function createPortableLockWithRuntime(options:{source:string;entry:string;composition?:string;python?:string;signal?:AbortSignal;executeSource?:boolean;sourceClosure?:string[]},runtimeRoot:string){
 canonicalBundlePath(options.entry);const scratch=await realpath(await mkdtemp(join(tmpdir(),'videoml-bundle-lock-')));let stage:DirectoryStage|undefined,clean=false;
 try{const captured=await DirectoryStage.prepare(options.source,join(scratch,'capture'),{python:options.python,signal:options.signal,sourceKind:'selective'});stage=captured.stage;const inventory=new Map<string,InventoryFile>();const capture=async(path:string)=>{canonicalBundlePath(path);if(!inventory.has(path))inventory.set(path,await stage!.capture(path,options.signal));};await capture(options.entry);const dependencies=await collectRuntimeLock(runtimeRoot);let composition;
  if(options.entry.toLowerCase().endsWith('.xml')){const xml=new TextDecoder('utf-8',{fatal:true}).decode(await stage.read(options.entry,options.signal));composition=selectComposition(loadVideoFileFromXml(xml),options.composition);}else{if(!options.executeSource)throw new Error('BUNDLE_TRUST_REQUIRED: pass --execute-source for trusted custom source');const closure=[...new Set([options.entry,...(options.sourceClosure??[])])];for(const path of closure)await capture(path);const compiled=await compileTsClosure(stage,options.entry,closure,[...inventory.values()],dependencies,options.signal);composition=selectSourceValue(await executeCompiledSource(compiled,dependencies,options.signal),options.composition);}
  const fonts:Record<string,string>={};for(const asset of composition.assets??[]){if(asset.mediaType!=='font/woff2')continue;const path=posix.join(posix.dirname(options.entry),canonicalBundlePath(asset.src));await capture(path);const file=inventory.get(path)!;if(file.size>16*1024*1024)throw new Error('BUNDLE_ASSET: missing or excessive font');const chunks:Buffer[]=[];for(let offset=0;offset<file.size;offset+=1024*1024)chunks.push(await stage.readRange(path,offset,Math.min(1024*1024,file.size-offset),options.signal));validateAssetMedia(Buffer.concat(chunks),asset.mediaType);fonts[asset.id]=`sha256:${file.sha256}`;}await stage.abort();stage=undefined;clean=true;return {dependencies,fonts};
 }catch(error){if(stage)try{await stage.abort();}catch(cleanup){throw new Error(`BUNDLE_CLEANUP_UNCONFIRMED: ${String(cleanup)}; original: ${String(error)}`);}if(!String(error).includes('BUNDLE_CLEANUP_UNCONFIRMED'))clean=true;throw error;}finally{if(clean)await rm(scratch,{recursive:true,force:true});}
}
