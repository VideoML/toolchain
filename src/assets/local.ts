import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,writeFileSync,mkdirSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
export type DeclaredAsset={id:string;src:string;mediaType:string};
export type StagedAsset={id:string;path:string;mediaType:string;sha256:string};
const maxFile=16*1024*1024,maxTotal=64*1024*1024;
export function readLocalAsset(base:string,path:string):Buffer {
 if(!path || path.startsWith('/') || path.includes('\\') || /[?#:%]/.test(path) || path.split('/').some(x=>!x||x==='.'||x==='..')) throw new Error('ASSET_INVALID: unsafe path');
 const root=realpathSync(base);let current=root;
 for(const segment of path.split('/')) {current=join(current,segment);if(lstatSync(current).isSymbolicLink())throw new Error('ASSET_INVALID: symlink');}
 const real=realpathSync(current);if(!real.startsWith(root+sep))throw new Error('ASSET_INVALID: path escape');
 const fd=openSync(current,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
 try {const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maxFile)throw new Error('ASSET_INVALID: not a bounded regular file');const buffer=Buffer.alloc(maxFile+1);let used=0;while(used<buffer.length){const count=readSync(fd,buffer,used,buffer.length-used,null);if(!count)break;used+=count;}if(used>maxFile)throw new Error('ASSET_INVALID: file too large');return buffer.subarray(0,used);} finally {closeSync(fd);}
}
function validateMedia(bytes:Buffer,type:string):void {
 if(type==='font/woff2' && bytes.subarray(0,4).toString()!=='wOF2')throw new Error('ASSET_INVALID: invalid WOFF2');
 if(type==='image/png' && !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('ASSET_INVALID: invalid PNG');
 if(type==='image/jpeg' && !bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))throw new Error('ASSET_INVALID: invalid JPEG');
 if(type==='image/webp' && !(bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP'))throw new Error('ASSET_INVALID: invalid WebP');
 if(type==='image/svg+xml' && (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.toString('utf8')) || /<\s*(script|style|foreignObject)|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href|src)\s*=\s*['"]\s*(?!#)|url\s*\(|@import/i.test(bytes.toString('utf8'))))throw new Error('ASSET_INVALID: unsupported SVG');
 if(!['font/woff2','image/png','image/jpeg','image/webp','image/svg+xml'].includes(type))throw new Error('ASSET_INVALID: unsupported media type');
}
export function stageAssets(assets:DeclaredAsset[],sourcePath:string,scriptPath:string):StagedAsset[]{
 if(assets.length>32||new Set(assets.map(a=>a.id)).size!==assets.length)throw new Error('ASSET_INVALID: duplicate or excessive assets');let total=0;const targetPath=dirname(resolve(scriptPath));mkdirSync(targetPath,{recursive:true});const target=realpathSync(targetPath);
 return assets.map(asset=>{if(['__proto__','constructor','prototype'].includes(asset.id)||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(asset.id))throw new Error('ASSET_INVALID: invalid ID');const bytes=readLocalAsset(dirname(resolve(sourcePath)),asset.src);total+=bytes.length;if(total>maxTotal)throw new Error('ASSET_INVALID: total size limit');validateMedia(bytes,asset.mediaType);const sha256=createHash('sha256').update(bytes).digest('hex'),path=`assets/${sha256}`;mkdirSync(join(target,'assets'),{recursive:true});const assetDir=join(target,'assets');if(lstatSync(assetDir).isSymbolicLink()||realpathSync(assetDir)!==assetDir)throw new Error('ASSET_INVALID: unsafe output directory');try{writeFileSync(join(target,path),bytes,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST'||createHash('sha256').update(readLocalAsset(target,path)).digest('hex')!==sha256)throw e;}return {id:asset.id,path,mediaType:asset.mediaType,sha256};});
}
