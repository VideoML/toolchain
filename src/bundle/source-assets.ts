import {posix} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {validateAssetMedia} from '../assets/local.js';
import type {CompositionSpec} from '../dsl/types.js';
import type {BundleManifest} from './manifest.js';
import type {DirectoryStage,InventoryFile} from './stage.js';
import {canonicalBundlePath} from './core.js';
/** Verify declared local asset closure, generated metadata and bounded media bytes using the held stage. */
export async function verifySourceAssets(composition:CompositionSpec,script:Record<string,any>,manifest:BundleManifest,stage:DirectoryStage,inventory:InventoryFile[],signal?:AbortSignal):Promise<void>{
 const assets=composition.assets??[];if(assets.length>32||new Set(assets.map(a=>a.id)).size!==assets.length)throw new Error('BUNDLE_ASSET: invalid declarations');
 const byPath=new Map(inventory.map(file=>[file.path,file]));const assetRoles=new Map(manifest.assets.map(a=>[a.path,a]));let total=0;const expected=[],fonts:Record<string,string>={};
 for(const asset of assets){
  if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(asset.id)||['__proto__','prototype','constructor'].includes(asset.id))throw new Error('BUNDLE_ASSET: invalid ID');
  canonicalBundlePath(asset.src);const sourcePath=posix.join(posix.dirname(manifest.entry),asset.src);canonicalBundlePath(sourcePath);const source=byPath.get(sourcePath);if(!source||source.size>16*1024*1024)throw new Error('BUNDLE_ASSET: missing or excessive source asset');total+=source.size;if(total>64*1024*1024)throw new Error('BUNDLE_ASSET: total limit');
  const chunks:Buffer[]=[];for(let offset=0;offset<source.size;offset+=1024*1024)chunks.push(await stage.readRange(sourcePath,offset,Math.min(1024*1024,source.size-offset),signal));const bytes=Buffer.concat(chunks);validateAssetMedia(bytes,asset.mediaType);
  const path=`assets/${source.sha256}`,renderPath=posix.join(posix.dirname(manifest.composition.script),path),render=byPath.get(renderPath),role=assetRoles.get(renderPath);if(!render||render.sha256!==source.sha256||!role||role.sha256!==source.sha256||role.mediaType!==asset.mediaType)throw new Error('BUNDLE_ASSET: rendered asset identity mismatch');
  expected.push({id:asset.id,path,mediaType:asset.mediaType,sha256:source.sha256});if(asset.mediaType==='font/woff2')fonts[asset.id]=`sha256:${source.sha256}`;
 }
 if(!isDeepStrictEqual(fonts,manifest.fonts))throw new Error('BUNDLE_LOCK: font identity mismatch');
 const actual=script.meta?.assets;if(assets.length?!isDeepStrictEqual(actual,expected):actual!==undefined)throw new Error('BUNDLE_ASSET: script asset metadata mismatch');
}
