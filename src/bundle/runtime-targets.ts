import {isDeepStrictEqual} from 'node:util';

const supported=new Set(['darwin-arm64','linux-arm64-glibc']);
const packageKey=/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)@(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const required=['cli','toolchain','renderer','shared','stdlib','player'];
export type RuntimeTargetDescriptor={schemaVersion:1;target:string;dependencies:Record<string,string>};

function plain(value:unknown):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}

/** Linux libc identity comes from Node's runtime report, not a filename. */
export function runtimeTargetFor(platform:string,arch:string,header:Record<string,unknown>):string {
  const glibc=typeof header.glibcVersionRuntime==='string'&&/^\d+\.\d+(?:\.\d+)?$/.test(header.glibcVersionRuntime);
  const target=platform==='darwin'&&arch==='arm64'?'darwin-arm64':platform==='linux'&&arch==='arm64'&&glibc?'linux-arm64-glibc':'';
  if(!target||!supported.has(target))throw new Error('BUNDLE_RUNTIME_TARGET: unsupported platform or libc');
  return target;
}

export function currentRuntimeTarget():string {
  const report=process.report?.getReport();
  const header=report&&typeof report!=='string'?(report as {header:Record<string,unknown>}).header:{};
  return runtimeTargetFor(process.platform,process.arch,header);
}

export function validateRuntimeTargets(value:unknown):Record<string,Record<string,string>> {
  if(!plain(value)||Object.keys(value).length<1||Object.keys(value).length>8)throw new Error('BUNDLE_RUNTIME_TARGET: invalid target map');
  let reference:Record<string,string>|undefined;
  for(const [target,raw] of Object.entries(value)){
    if(!supported.has(target)||!plain(raw)||Object.keys(raw).length<1||Object.keys(raw).length>10000)
      throw new Error('BUNDLE_RUNTIME_TARGET: unsupported target or closure');
    for(const [key,digest] of Object.entries(raw))
      if(!packageKey.test(key)||typeof digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(digest))
        throw new Error('BUNDLE_RUNTIME_TARGET: invalid package pin');
    const keys=Object.keys(raw);
    const versions=keys.filter(key=>key.startsWith('esbuild@')).map(key=>key.slice('esbuild@'.length));
    const native=target==='darwin-arm64'?'@esbuild/darwin-arm64@':'@esbuild/linux-arm64@';
    if(versions.length===0||versions.some(version=>!Object.hasOwn(raw,native+version)))
      throw new Error('BUNDLE_RUNTIME_TARGET: missing matching esbuild native package');
    if(keys.some(key=>key.startsWith('@esbuild/')&&(!key.startsWith(native)||!versions.includes(key.slice(native.length)))))
      throw new Error('BUNDLE_RUNTIME_TARGET: contradictory esbuild native package');
    const video=Object.fromEntries(Object.entries(raw).filter(([key])=>key.startsWith('@videoml/')).sort(([a],[b])=>a.localeCompare(b))) as Record<string,string>;
    for(const name of required)
      if(!Object.keys(video).some(key=>key.startsWith(`@videoml/${name}@`)))
        throw new Error(`BUNDLE_RUNTIME_TARGET: missing VideoML ${name}`);
    if(reference&&!isDeepStrictEqual(reference,video))throw new Error('BUNDLE_RUNTIME_TARGET: VideoML package pins differ');
    reference=video;
  }
  return value as Record<string,Record<string,string>>;
}

export function mergeRuntimeTargets(current:RuntimeTargetDescriptor,foreign:RuntimeTargetDescriptor[]):Record<string,Record<string,string>> {
  const targets:Record<string,Record<string,string>>={};
  for(const item of [current,...foreign]){
    if(Buffer.byteLength(JSON.stringify(item)??'')>1024*1024)throw new Error('BUNDLE_RUNTIME_TARGET: descriptor exceeds 1 MiB');
    if(!plain(item)||Object.keys(item).length!==3||item.schemaVersion!==1||typeof item.target!=='string'||!Object.hasOwn(item,'dependencies')||Object.hasOwn(targets,item.target))
      throw new Error('BUNDLE_RUNTIME_TARGET: invalid or duplicate descriptor');
    Object.defineProperty(targets,item.target,{value:item.dependencies,enumerable:true,writable:true,configurable:true});
  }
  return validateRuntimeTargets(targets);
}

/** Legacy v1 selection never invokes v2 platform detection. */
export function selectRuntimeDependencies(lock:{schemaVersion?:number;dependencies?:Record<string,string>;runtimeTargets?:unknown},target?:string):Record<string,string> {
  if(lock.schemaVersion===2){
    const selected=target??currentRuntimeTarget(),targets=validateRuntimeTargets(lock.runtimeTargets);
    if(!Object.hasOwn(targets,selected))throw new Error(`BUNDLE_RUNTIME_TARGET: missing ${selected}`);
    return targets[selected];
  }
  if(lock.schemaVersion!==undefined&&lock.schemaVersion!==1)throw new Error('BUNDLE_RUNTIME_TARGET: unsupported schema');
  if(!lock.dependencies)throw new Error('BUNDLE_LOCK: dependencies missing');
  return lock.dependencies;
}
