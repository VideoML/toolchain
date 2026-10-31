import {createRequire} from 'node:module';
import type * as Esbuild from 'esbuild';

const owned=new Map<string,typeof Esbuild>();
/** Load a fresh esbuild instance after rejecting environment binary overrides. */
export function loadSafeEsbuild(callerUrl:string):typeof Esbuild {
  if(process.env.ESBUILD_BINARY_PATH)throw new Error('BUNDLE_RUNTIME_MISMATCH: ESBUILD_BINARY_PATH is not permitted');
  const require=createRequire(callerUrl),path=require.resolve('esbuild');
  const existing=owned.get(path);if(existing)return existing;
  // A module loaded earlier may have captured an override. Load an independent instance,
  // then restore its prior cache entry so unrelated consumers retain their original instance.
  const previous=require.cache[path];delete require.cache[path];
  try {const fresh=require(path) as typeof Esbuild;owned.set(path,fresh);return fresh;}
  finally {if(previous)require.cache[path]=previous;else delete require.cache[path];}
}
