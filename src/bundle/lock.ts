import {isDeepStrictEqual} from 'node:util';
import {validateRuntimeTargets} from './runtime-targets.js';
import type {BundleManifest} from './manifest.js';
const digest=/^sha256:[0-9a-f]{64}$/;
const packageKey=/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)@(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function map(value:unknown):value is Record<string,string>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.entries(value).every(([key,item])=>!['__proto__','constructor','prototype'].includes(key)&&typeof item==='string'&&digest.test(item));}
/** V1 retains exact legacy host pins; V2 pins complete explicit target closures. */
export function verifyBundleLock(lock:unknown,manifest:Pick<BundleManifest,'dependencies'|'fonts'> & Partial<Pick<BundleManifest,'schemaVersion'|'runtimeTargets'>>):void {
 if(!lock||typeof lock!=='object'||Array.isArray(lock))throw new Error('BUNDLE_LOCK: invalid lock');
 const data=lock as {schemaVersion?:number;dependencies?:unknown;runtimeTargets?:unknown;fonts?:unknown};
 if(!map(data.fonts)||!Object.keys(data.fonts).every(key=>/^[A-Za-z][A-Za-z0-9_-]*$/.test(key))||!isDeepStrictEqual(data.fonts,manifest.fonts))throw new Error('BUNDLE_LOCK: invalid font pins');
 if(manifest.schemaVersion===2){
  if(data.schemaVersion!==2||Object.keys(data).length!==3||!Object.hasOwn(data,'runtimeTargets'))throw new Error('BUNDLE_LOCK: expected v2 target maps');
  validateRuntimeTargets(data.runtimeTargets);if(!isDeepStrictEqual(data.runtimeTargets,manifest.runtimeTargets))throw new Error('BUNDLE_LOCK: target mismatch');return;
 }
 if((manifest.schemaVersion??1)!==1||Object.keys(data).length!==2||!Object.hasOwn(data,'dependencies')||!map(data.dependencies)||!Object.keys(data.dependencies).every(key=>packageKey.test(key))||!isDeepStrictEqual(data.dependencies,manifest.dependencies))throw new Error('BUNDLE_LOCK: invalid v1 pins or manifest mismatch');
}
