import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join,sep} from 'node:path';
export function resolveEffectAssets(manifest:unknown,base:string|undefined,overrides:Readonly<Record<string,string>>={}):Record<string,string>{
 if(manifest==null)return {...overrides};
 if(!Array.isArray(manifest)||manifest.length>32||!base)throw new Error('ASSET_INVALID: assetBaseDir and bounded manifest required');
 const root=realpathSync(base),result={...overrides};let total=0;const seen=new Set<string>();
 for(const entry of manifest){
  if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||['__proto__','constructor','prototype'].includes(entry.id)||!/^([A-Za-z][A-Za-z0-9_-]*)$/.test(entry.id)||seen.has(entry.id)||entry.id in result||typeof entry.path!=='string'||typeof entry.mediaType!=='string'||typeof entry.sha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.sha256))throw new Error('ASSET_INVALID: invalid or conflicting manifest');seen.add(entry.id);
  if(!/^(font\/woff2|image\/(png|jpeg|webp|svg\+xml))$/.test(entry.mediaType)||entry.path.startsWith('/')||entry.path.includes('\\')||/[?#:%]/.test(entry.path)||entry.path.split('/').some((x:string)=>!x||x==='.'||x==='..'))throw new Error('ASSET_INVALID: unsafe asset');
  let file=root;for(const part of entry.path.split('/')){file=join(file,part);if(lstatSync(file).isSymbolicLink())throw new Error('ASSET_INVALID: symlink');}const real=realpathSync(file);if(!real.startsWith(root+sep))throw new Error('ASSET_INVALID: path escape');const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let bytes:Buffer;try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>16*1024*1024)throw new Error('ASSET_INVALID: file bounds');const buffer=Buffer.alloc(16*1024*1024+1);let used=0;while(used<buffer.length){const count=readSync(fd,buffer,used,buffer.length-used,null);if(!count)break;used+=count;}if(used>16*1024*1024)throw new Error('ASSET_INVALID: file bounds');total+=used;if(total>64*1024*1024)throw new Error('ASSET_INVALID: total bounds');bytes=buffer.subarray(0,used);}finally{closeSync(fd);}if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('ASSET_INVALID: digest mismatch');
  if(entry.mediaType==='font/woff2'&&bytes.subarray(0,4).toString()!=='wOF2'||entry.mediaType==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||entry.mediaType==='image/jpeg'&&!bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))||entry.mediaType==='image/webp'&&!(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'))throw new Error('ASSET_INVALID: media mismatch');
  if(entry.mediaType==='image/svg+xml'){const svg=bytes.toString('utf8');if(!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)||/<\s*(script|style|foreignObject)|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href|src)\s*=\s*['"]\s*(?!#)|url\s*\(|@import/i.test(svg))throw new Error('ASSET_INVALID: unsupported SVG');}
  result[entry.id]=`data:${entry.mediaType};base64,${bytes.toString('base64')}`;
 }
 return result;
}
