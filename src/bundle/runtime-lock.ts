import {createRequire} from 'node:module';
import {currentRuntimeTarget,selectRuntimeDependencies,type RuntimeTargetDescriptor} from './runtime-targets.js';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,opendir,readFile,realpath,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {canonicalBundlePath,validatePathSet} from './core.js';
const roots=['@videoml/cli','@videoml/toolchain','@videoml/renderer','@videoml/shared','@videoml/stdlib','@videoml/player'];
const compare=(a:string,b:string)=>{const x=Array.from(a,c=>c.codePointAt(0)!),y=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
/** Hash one trusted installed package's regular-file payload, excluding nested node_modules. */
export async function hashInstalledPackage(packageDirectory:string,signal?:AbortSignal):Promise<{name:string;version:string;digest:string;manifest:any;root:string}>{
 if(signal?.aborted)throw new Error('BUNDLE_CANCELLED');
 const root=await realpath(packageDirectory),files:Array<{path:string;sha256:string}>=[];let total=0,totalBytes=0;
 const visit=async(directory:string,prefix:string,depth:number):Promise<void>=>{if(signal?.aborted)throw new Error('BUNDLE_CANCELLED');if(depth>128)throw new Error('BUNDLE_RUNTIME_MISMATCH: package depth');for await(const entry of await opendir(directory)){const name=entry.name;if(name==='node_modules')continue;const path=prefix?`${prefix}/${name}`:name;canonicalBundlePath(path);const full=join(directory,name),stat=await lstat(full);if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw new Error(`BUNDLE_RUNTIME_MISMATCH: unsupported package entry ${path}`);if(stat.isDirectory())await visit(full,path,depth+1);else{totalBytes+=stat.size;if(++total>100000||stat.size>250*1024*1024||totalBytes>1024*1024*1024)throw new Error('BUNDLE_RUNTIME_MISMATCH: package limit');const hash=createHash('sha256'),fd=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);try{const held=await fd.stat();if(!held.isFile()||held.ino!==stat.ino||held.dev!==stat.dev||held.size!==stat.size)throw new Error('BUNDLE_RUNTIME_MISMATCH: package file changed');const buffer=Buffer.alloc(1024*1024);let position=0;while(position<held.size){if(signal?.aborted)throw new Error('BUNDLE_CANCELLED');const {bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,held.size-position),position);if(!bytesRead)throw new Error('BUNDLE_RUNTIME_MISMATCH: short package read');hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}}finally{await fd.close();}files.push({path,sha256:hash.digest('hex')});}}};
 await visit(root,'',0);validatePathSet(files.map(file=>file.path));files.sort((a,b)=>compare(a.path,b.path));const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(!manifest||typeof manifest.name!=='string'||typeof manifest.version!=='string')throw new Error('BUNDLE_RUNTIME_MISMATCH: invalid package manifest');return {root,name:manifest.name,version:manifest.version,manifest,digest:`sha256:${createHash('sha256').update(JSON.stringify(files),'utf8').digest('hex')}`};
}
/** Find an installed package using Node's ancestor node_modules resolution. */
async function findPackage(name:string,from:string,optional=false):Promise<string|undefined>{if(!/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/.test(name))throw new Error('BUNDLE_RUNTIME_MISMATCH: invalid dependency name');let current=resolve(from);for(;;){const candidate=join(current,'node_modules',...name.split('/'));try{await lstat(candidate);try{return await realpath(candidate);}catch(error){throw new Error(`BUNDLE_RUNTIME_MISMATCH: unreadable package ${name}: ${String(error)}`);}}catch(error:any){if(error?.code!=='ENOENT')throw error;}const parent=dirname(current);if(parent===current)break;current=parent;}if(optional)return undefined;throw new Error(`BUNDLE_RUNTIME_MISMATCH: missing package ${name}`);}
async function containingToolchain(from:string):Promise<string|undefined>{let current=resolve(from);for(;;){try{const pkg=JSON.parse(await readFile(join(current,'package.json'),'utf8'));if(pkg.name==='@videoml/toolchain')return await realpath(current);}catch(error:any){if(error?.code!=='ENOENT'&&error?.code!=='ENOTDIR')throw error;}const parent=dirname(current);if(parent===current)return undefined;current=parent;}}
/** Verify the same native binary esbuild will resolve, with no fallback. */
async function verifyInstalledNativeEsbuild(esbuilds:Array<{root:string;version:string}>,closure:Record<string,string>,target:string,signal?:AbortSignal):Promise<void>{
 const platform=target==='darwin-arm64'?'darwin-arm64':target==='linux-arm64-glibc'?'linux-arm64':null;
 if(!platform)throw new Error('BUNDLE_RUNTIME_TARGET: unsupported native target');
 for(const pkg of esbuilds){
  if(signal?.aborted)throw new Error('BUNDLE_CANCELLED');
  const name=`@esbuild/${platform}`,path=await findPackage(name,pkg.root,true);
  if(!path)throw new Error(`BUNDLE_RUNTIME_MISMATCH: missing native esbuild ${pkg.version}`);
  const native=await hashInstalledPackage(path,signal);
  if(native.name!==name||native.version!==pkg.version||closure[`${name}@${native.version}`]!==native.digest)throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild identity');
  const binary=join(native.root,'bin','esbuild');let stat;
  try{stat=await lstat(binary);}catch{throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild binary missing');}
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o111)===0)throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild binary missing or not executable');
  let resolvedBinary:string;
  try{resolvedBinary=await realpath(createRequire(join(pkg.root,'lib','main.js')).resolve(`${name}/bin/esbuild`));}
  catch{throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild cannot be resolved without fallback');}
  if(resolvedBinary!==await realpath(binary))throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild resolution mismatch');
  const fd=await open(binary,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const held=await fd.stat(),head=Buffer.alloc(20),{bytesRead}=await fd.read(head,0,head.length,0);
   if(held.dev!==stat.dev||held.ino!==stat.ino||bytesRead<20)throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild binary changed');
   const correct=platform==='darwin-arm64'?head.readUInt32LE(0)===0xfeedfacf&&head.readUInt32LE(4)===0x0100000c:head[0]===0x7f&&head.toString('ascii',1,4)==='ELF'&&head[4]===2&&head[5]===1&&head.readUInt16LE(18)===183;
   if(!correct)throw new Error('BUNDLE_RUNTIME_MISMATCH: native esbuild architecture');
  }finally{await fd.close();}
 }
}
/** Compute the fixed runtime closure from installed roots and their non-dev dependencies and required peers. */
export async function collectRuntimeLock(from:string,options:{requireTarget?:string;signal?:AbortSignal}={}):Promise<Record<string,string>>{
 if(options.signal?.aborted)throw new Error('BUNDLE_CANCELLED');
 const esbuilds:Array<{root:string;version:string}>=[];const result:Record<string,string>={},visited=new Set<string>(),self=await containingToolchain(from),queue:Array<{name:string;from:string;optional?:boolean;fixedPath?:string}>=roots.map(name=>({name,from,...(name==='@videoml/toolchain'&&self?{fixedPath:self}:{})}));
 while(queue.length){if(options.signal?.aborted)throw new Error('BUNDLE_CANCELLED');if(visited.size>10000)throw new Error('BUNDLE_RUNTIME_MISMATCH: package count');const next=queue.shift()!,path=next.fixedPath??await findPackage(next.name,next.from,next.optional);if(!path)continue;if(visited.has(path))continue;visited.add(path);const pkg=await hashInstalledPackage(path,options.signal);if(pkg.name!==next.name)throw new Error(`BUNDLE_RUNTIME_MISMATCH: package identity ${next.name}`);if(pkg.name==='esbuild')esbuilds.push({root:pkg.root,version:pkg.version});const key=`${pkg.name}@${pkg.version}`;if(result[key]&&result[key]!==pkg.digest)throw new Error(`BUNDLE_RUNTIME_MISMATCH: divergent package ${key}`);result[key]=pkg.digest;
  const required=new Set(Object.keys(pkg.manifest.dependencies??{}).filter(name=>!Object.hasOwn(pkg.manifest.optionalDependencies??{},name)));for(const name of Object.keys(pkg.manifest.peerDependencies??{}))if(!pkg.manifest.peerDependenciesMeta?.[name]?.optional)required.add(name);for(const name of required)queue.push({name,from:pkg.root});const optional=new Set([...Object.keys(pkg.manifest.optionalDependencies??{}),...Object.keys(pkg.manifest.peerDependencies??{}).filter(name=>pkg.manifest.peerDependenciesMeta?.[name]?.optional)]);for(const name of optional)if(!required.has(name))queue.push({name,from:pkg.root,optional:true});
 }
 if(options.requireTarget)await verifyInstalledNativeEsbuild(esbuilds,result,options.requireTarget,options.signal);
 return Object.fromEntries(Object.entries(result).sort(([a],[b])=>compare(a,b)));
}
export async function verifyRuntimeLock(expected:Record<string,string>,from:string,signal?:AbortSignal):Promise<void>{const actual=await collectRuntimeLock(from,{signal});if(JSON.stringify(actual)!==JSON.stringify(Object.fromEntries(Object.entries(expected).sort(([a],[b])=>compare(a,b)))))throw new Error('BUNDLE_RUNTIME_MISMATCH: installed dependency closure differs from bundle');}
/** Resolve an external import from the executing toolchain context and verify its pinned payload. */
export async function resolvePinnedRuntimePackage(name:string,from:string,expected:Record<string,string>):Promise<string>{const self=name==='@videoml/toolchain'?await containingToolchain(from):undefined;const path=self??await findPackage(name,from);if(!path)throw new Error(`BUNDLE_RUNTIME_MISMATCH: missing ${name}`);const pkg=await hashInstalledPackage(path),key=`${pkg.name}@${pkg.version}`;if(pkg.name!==name||expected[key]!==pkg.digest)throw new Error(`BUNDLE_RUNTIME_MISMATCH: unpinned external package ${name}`);return path;}

/** Collect the actual executing runtime's complete closure, without installation or network access. */
export async function collectRuntimeTargetDescriptor(signal?:AbortSignal):Promise<RuntimeTargetDescriptor>{
 const target=currentRuntimeTarget();return {schemaVersion:1,target,dependencies:await collectRuntimeLock(dirname(fileURLToPath(import.meta.url)),{requireTarget:target,signal})};
}

/** Verify a v2 closure and require native esbuild binaries without executing them. */
export async function verifyRuntimeTargetLock(expected:Record<string,string>,from:string,target:string,signal?:AbortSignal):Promise<void>{const actual=await collectRuntimeLock(from,{requireTarget:target,signal});if(JSON.stringify(actual)!==JSON.stringify(Object.fromEntries(Object.entries(expected).sort(([a],[b])=>compare(a,b)))))throw new Error('BUNDLE_RUNTIME_MISMATCH: installed dependency closure differs from bundle');}

export async function verifyBundleRuntime(lock:{schemaVersion?:number;dependencies?:Record<string,string>;runtimeTargets?:unknown},from:string,signal?:AbortSignal):Promise<Record<string,string>> {
 const target=lock.schemaVersion===2?currentRuntimeTarget():undefined;
 const dependencies=selectRuntimeDependencies(lock,target);
 if(target)await verifyRuntimeTargetLock(dependencies,from,target,signal);else await verifyRuntimeLock(dependencies,from,signal);
 return dependencies;
}
