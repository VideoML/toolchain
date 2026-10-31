import {listComponents} from '@videoml/renderer/components/registry';
import {isDeepStrictEqual} from 'node:util';
import {loadVideoFileFromXml} from '../dsl/xml.js';
import {normalizeCompositionIds} from '../dsl/normalize.js';
import type {Script} from '../models.js';
import type {CompositionSpec} from '../dsl/types.js';
import {validateCompositionIdentity} from './selection.js';
import {verifyAuthoredScenes} from './source-scenes.js';
import {collectEffectIdentities} from './effects.js';
import {verifySourceCursor} from './source-cursor.js';
import {verifyAuthoredTimeline} from './source-timeline.js';
import {verifyChildIntervals} from './source-intervals.js';
import {verifySourceAssets} from './source-assets.js';
import type {ResolvedTiming} from '@videoml/shared/resolved-timing';
import type {BundleManifest} from './manifest.js';
import type {DirectoryStage,InventoryFile} from './stage.js';
const builtinComponents=new Set(listComponents());
/** Trusted-local XML validation. Hosted execution requires a separate strict AST and asset-reference gate. */
export async function verifyTrustedXmlSource(input:{source:Buffer;script:Record<string,unknown>;timing:ResolvedTiming;manifest:BundleManifest;stage:DirectoryStage;inventory:InventoryFile[]}):Promise<void>{
 if(input.manifest.composition.normalizedSource!==undefined||input.manifest.composition.sourceClosure!==undefined||input.manifest.composition.browserBundle!==undefined||input.manifest.composition.customComponents!==undefined||input.manifest.composition.customEffects!==undefined)throw new Error('BUNDLE_ROLE: custom source roles are not permitted on XML');
 if(!input.manifest.entry.toLowerCase().endsWith('.xml'))throw new Error('BUNDLE_CAPABILITY_UNAVAILABLE: trusted custom source compilation is not available');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(input.source);}catch{throw new Error('BUNDLE_SOURCE: invalid UTF-8');}
 const parsed=loadVideoFileFromXml(text),selected=validateCompositionIdentity(parsed,input.manifest,input.script as any);await verifyCompositionSource(input,selected);
}
export async function verifyCompositionSource(input:{source:Buffer;script:Record<string,unknown>;timing:ResolvedTiming;manifest:BundleManifest;stage:DirectoryStage;inventory:InventoryFile[]},selected:CompositionSpec):Promise<void>{
 const script=input.script as unknown as Script,composition=normalizeCompositionIds(selected);if(composition.id!==input.manifest.composition.id)throw new Error('BUNDLE_SELECTION: source identity mismatch');

 const keys=new Set(['scenes','timeline','fps','meta','posterTimeSec','simulated']);if(Object.keys(script).some(key=>!keys.has(key))||!script.meta||typeof script.meta!=='object')throw new Error('BUNDLE_SCRIPT: unknown script fields');
 if(input.timing.segments.some(segment=>segment.provenance.simulated===true)&&(script as any).simulated!==true)throw new Error('BUNDLE_SCRIPT: simulation marker missing');
 if(Object.hasOwn(script,'simulated')&&((script as any).simulated!==true||input.timing.segments.some(segment=>segment.provenance.simulated!==true)))throw new Error('BUNDLE_SCRIPT: simulation metadata mismatch');
 const expectedMeta={...composition.meta,generationSeed:input.timing.generationSeed,compositionId:composition.id,...(composition.assets?.length?{assets:(script.meta as any).assets}:{})};
 if(!isDeepStrictEqual(JSON.parse(JSON.stringify(expectedMeta)),script.meta)||script.fps!==composition.meta?.fps||(script.posterTimeSec??null)!==(composition.posterTime??null))throw new Error('BUNDLE_SCRIPT: source metadata mismatch');
 const declared=new Set((input.manifest.composition.customComponents??[]).map(item=>item.id));for(const id of declared)if(builtinComponents.has(id)||id==='FrameEffect')throw new Error(`BUNDLE_SOURCE: custom component collides with builtin ${id}`);
 const scan=(items:any[])=>{for(const item of items??[]){if(item.type!==undefined&&(typeof item.type!=='string'||(!builtinComponents.has(item.type)&&item.type!=='FrameEffect'&&!declared.has(item.type))))throw new Error(`BUNDLE_SOURCE: undeclared component ${String(item.type)}`);scan(item.components??[]);scan(item.layers??[]);}};scan((input.script as any).scenes??[]);scan(((input.script as any).timeline??[]).filter((item:any)=>item.kind==='transition'));
 if(!isDeepStrictEqual(collectEffectIdentities(input.script),input.manifest.effects))throw new Error('BUNDLE_SOURCE: effect identity mismatch');
 verifyAuthoredScenes(composition,script,input.timing);const shifts=verifySourceCursor(composition,script,input.timing);verifyAuthoredTimeline(composition,script,input.timing,shifts);verifyChildIntervals(script,input.timing);
 await verifySourceAssets(composition,script,input.manifest,input.stage,input.inventory);
}
