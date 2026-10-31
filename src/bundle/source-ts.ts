import {verifyBundleRuntime} from './runtime-lock.js';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {normalizeCompositionIds} from '../dsl/normalize.js';
import type {CompositionSpec} from '../dsl/types.js';
import type {BundleManifest} from './manifest.js';
import type {DirectoryStage,InventoryFile} from './stage.js';
import type {ResolvedTiming} from '@videoml/shared/resolved-timing';
import {verifyCompositionSource} from './source-xml.js';
import {verifyTsClosureAcrossTargets} from './ts-closure.js';
import {compileTsClosure,executeCompiledSource} from './ts-execution.js';
import {selectSourceValue} from './source-value.js';
function data(value:unknown,path='source'):void {if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;if(Array.isArray(value)){value.forEach((entry,index)=>data(entry,`${path}/${index}`));return;}if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw new Error(`BUNDLE_SOURCE: non-data value at ${path}`);for(const [key,entry] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw new Error(`BUNDLE_SOURCE: forbidden key at ${path}`);data(entry,`${path}/${key}`);}}
/** Inert snapshot verification, optionally followed by explicitly trusted re-execution. */
export async function verifyTrustedTsSource(input:{source:Buffer;script:Record<string,unknown>;timing:ResolvedTiming;manifest:BundleManifest;stage:DirectoryStage;inventory:InventoryFile[]},options:{executeSource:boolean;signal?:AbortSignal}):Promise<void>{
 const role=input.manifest.composition;if(!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(input.manifest.entry)||!role.normalizedSource||!role.sourceClosure||role.browserBundle===undefined||!role.customComponents)throw new Error('BUNDLE_SOURCE: custom source roles missing');
 const maps=input.manifest.schemaVersion===2?Object.values(input.manifest.runtimeTargets!):[input.manifest.dependencies];await verifyTsClosureAcrossTargets(input.stage,role.sourceClosure,input.inventory,maps,options.signal);let snapshot:unknown;try{snapshot=JSON.parse((await input.stage.read(role.normalizedSource,options.signal)).toString('utf8'));}catch{throw new Error('BUNDLE_SOURCE: invalid normalized source snapshot');}data(snapshot);if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||typeof (snapshot as any).id!=='string'||!Array.isArray((snapshot as any).timeline))throw new Error('BUNDLE_SOURCE: invalid normalized composition');const normalized=normalizeCompositionIds(snapshot as CompositionSpec);await verifyCompositionSource(input,normalized);
 if(options.executeSource){const dependencies=await verifyBundleRuntime(input.manifest,dirname(fileURLToPath(import.meta.url)),options.signal);const code=await compileTsClosure(input.stage,input.manifest.entry,role.sourceClosure,input.inventory,dependencies,options.signal);const raw=await executeCompiledSource(code,dependencies,options.signal);data(raw);const selected=selectSourceValue(raw,role.id);if(!isDeepStrictEqual(JSON.parse(JSON.stringify(normalizeCompositionIds(selected))),JSON.parse(JSON.stringify(normalized))))throw new Error('BUNDLE_SOURCE: trusted source differs from normalized snapshot');}
}
