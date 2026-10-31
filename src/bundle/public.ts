import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareVerifiedBundle} from './import.js';
import {loadVideoFileFromXml} from '../dsl/xml.js';
import {selectComposition} from './selection.js';
import {evaluateHostedXml,evaluateHostedFiles} from './hosted.js';
import {verifyTrustedTsSource} from './source-ts.js';
import {verifyTrustedXmlSource} from './source-xml.js';
export type BundleInput={source:string;sourceKind?:'directory'|'zip';python?:string;expectedDigest?:string;signal?:AbortSignal;trust:'local'|'hosted';executeSource?:boolean};
async function prepare(input:BundleInput,destination:string){
 if(input.trust!=='local'&&input.trust!=='hosted')throw new Error('BUNDLE_TRUST_REQUIRED: select trusted local or hosted policy');
 let custom=false;const result=await prepareVerifiedBundle({...input,destination,verifySource:async data=>{custom=!data.manifest.entry.toLowerCase().endsWith('.xml');if(custom){if(input.trust==='hosted')throw new Error('HOSTED_UNSUPPORTED: executable source is not hosted');await verifyTrustedTsSource(data,{executeSource:input.executeSource===true,signal:input.signal});}else await verifyTrustedXmlSource(data);}});
 try{let hostedEligibility;if(custom)hostedEligibility={eligible:false,policyVersion:'videoml-hosted-v1',reasons:[{path:result.manifest.entry,code:'HOSTED_UNSUPPORTED',message:'custom source is trusted-local only'}]};else{const xml=new TextDecoder('utf-8',{fatal:true}).decode(await result.stage.read(result.manifest.entry,input.signal));const composition=selectComposition(loadVideoFileFromXml(xml),result.manifest.composition.id);hostedEligibility=evaluateHostedXml(xml,composition);hostedEligibility.reasons.push(...evaluateHostedFiles(composition,result.script,result.manifest));hostedEligibility.eligible=hostedEligibility.reasons.length===0;}if(input.trust==='hosted'&&!hostedEligibility.eligible)throw new Error(`HOSTED_UNSUPPORTED: ${JSON.stringify(hostedEligibility.reasons)}`);return {...result,hostedEligibility,sourceVerification:custom&&!input.executeSource?'pending-trusted-execution':'verified'};}catch(error){try{await result.stage.abort();}catch(cleanup){throw new Error(`BUNDLE_CLEANUP_UNCONFIRMED: ${String(cleanup)}; original: ${String(error)}`);}throw error;}
}
/** Commit an already prepared stage; pre-dispatch failures still require confirmed cleanup. */
export async function commitPreparedStage(stage:{commit(signal?:AbortSignal,format?:'directory'|'zip'):Promise<void>;abort():Promise<void>},signal?:AbortSignal,format?:'directory'|'zip'):Promise<void>{try{await stage.commit(signal,format);}catch(error){if(String(error).includes('BUNDLE_PUBLICATION_UNCONFIRMED'))throw error;try{await stage.abort();}catch(cleanup){throw new Error(`BUNDLE_CLEANUP_UNCONFIRMED: ${String(cleanup)}; original: ${String(error)}`);}throw error;}}
/** Verify and atomically publish into an absent destination under a trusted parent. */
export async function importPortableBundle(input:BundleInput&{destination:string;format?:'directory'|'zip'}){const result=await prepare(input,input.destination);if(result.sourceVerification!=='verified'){await result.stage.abort();throw new Error('BUNDLE_TRUST_REQUIRED: pass --execute-source for trusted custom source');}await commitPreparedStage(result.stage,input.signal,input.format);return {manifest:result.manifest,hostedEligibility:result.hostedEligibility,sourceVerification:result.sourceVerification};}
/** Verify without publishing; the helper-owned stage is removed before returning. */
export async function validatePortableBundle(input:BundleInput){const scratch=await realpath(await mkdtemp(join(tmpdir(),'videoml-bundle-validation-')));let clean=false;try{const result=await prepare(input,join(scratch,'unused'));await result.stage.abort();clean=true;return {manifest:result.manifest,hostedEligibility:result.hostedEligibility,sourceVerification:result.sourceVerification};}catch(error){if(!String(error).includes('BUNDLE_CLEANUP_UNCONFIRMED')&&!String(error).includes('BUNDLE_PUBLICATION_UNCONFIRMED'))clean=true;throw error;}finally{if(clean)await rm(scratch,{recursive:true,force:true});}}
