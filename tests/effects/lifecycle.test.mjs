import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEffectRegistry, mountEffect } from '../../../stdlib/src/effects/index.ts';
test('registry enforces version and parameter validation; seek waits and disposal releases once', async () => {
 let release, disposed=0, frames=[]; const ready=new Promise(r=>release=r);
 const registry=createEffectRegistry();
 registry.register({schemaVersion:1,id:'fixture',version:'1',parametersSchema:{type:'object'}}, p=>p.ok===true, () => ({mount(){},async seek(f){await ready;frames.push(f)},dispose(){disposed++}}));
 assert.throws(()=>registry.create({id:'fixture',version:'2',parameters:{ok:true},startFrame:0,endFrame:2}),/unknown/i);
 assert.throws(()=>registry.create({id:'fixture',version:'1',parameters:{ok:false},startFrame:0,endFrame:2}),/parameter/i);
 const root={style:{},replaceChildren(){}};
 const effect=mountEffect(root, registry, {id:'fixture',version:'1',parameters:{ok:true},startFrame:0,endFrame:2}, {width:10,height:10,fps:30,seed:0,assets:{}});
 const pending=effect.seek(1); await Promise.resolve(); assert.deepEqual(frames,[]); release(); await pending; assert.deepEqual(frames,[1]);
 await effect.seek(2); assert.equal(root.style.visibility,'hidden'); await effect.seek(0); assert.equal(root.style.visibility,'');
 effect.dispose();effect.dispose();assert.equal(disposed,1); await assert.rejects(effect.seek(0),/disposed/);
});
test('dispose fences in-flight asynchronous seek and cleans up after it settles', async () => {
 let release, disposed=0; const waiting=new Promise(r=>release=r);
 const registry=createEffectRegistry();
 registry.register({schemaVersion:1,id:'wait',version:'1',parametersSchema:{}},()=>true,()=>({mount(){},async seek(){await waiting},dispose(){disposed++}}));
 const root={style:{},replaceChildren(){}};
 const controller=mountEffect(root,registry,{id:'wait',version:'1',parameters:{},startFrame:0,endFrame:5},{width:10,height:10,fps:30,seed:0,assets:{}});
 const seeking=controller.seek(1);await Promise.resolve();controller.dispose();assert.equal(disposed,0);release();await assert.rejects(seeking,/disposed/);assert.equal(disposed,1);
});
test('registry validates data against descriptor schema even if supplied callback accepts it', () => {
 const registry=createEffectRegistry();
 registry.register({schemaVersion:1,id:'schema',version:'1',parametersSchema:{type:'object',properties:{amount:{type:'number',minimum:1}},required:['amount'],additionalProperties:false}},()=>true,()=>({mount(){},async seek(){},dispose(){}}));
 assert.throws(()=>registry.create({id:'schema',version:'1',parameters:{amount:0},startFrame:0,endFrame:2}),/parameter/i);
 assert.throws(()=>registry.create({id:'schema',version:'1',parameters:{amount:2,extra:true},startFrame:0,endFrame:2}),/parameter/i);
 assert.doesNotThrow(()=>registry.create({id:'schema',version:'1',parameters:{amount:2},startFrame:0,endFrame:2}));
});
test('registry rejects invalid schemas and unresolved references', () => {
 const registry=createEffectRegistry(); const create=()=>({mount(){},async seek(){},dispose(){}});
 assert.throws(()=>registry.register({schemaVersion:1,id:'invalid',version:'1',parametersSchema:{type:'not-a-type'}},()=>true,create));
 assert.throws(()=>registry.register({schemaVersion:1,id:'ref',version:'1',parametersSchema:{$ref:'https://example.invalid/schema'}},()=>true,create));
});
test('asynchronous mount failure remains terminal across seeks and disposes once', async () => {
 let seeks=0,disposed=0;const registry=createEffectRegistry();
 registry.register({schemaVersion:1,id:'failed',version:'1',parametersSchema:{}},()=>true,()=>({async mount(){throw new Error('mount failed')},async seek(){seeks++},dispose(){disposed++}}));
 const root={style:{},replaceChildren(){}};const controller=mountEffect(root,registry,{id:'failed',version:'1',parameters:{},startFrame:0,endFrame:2},{width:10,height:10,fps:30,seed:0,assets:{}});
 await assert.rejects(controller.seek(0),/mount failed/);await assert.rejects(controller.seek(1),/mount failed/);controller.dispose();controller.dispose();assert.equal(seeks,0);assert.equal(disposed,1);
});
test('mount rejection cleans partial resources without seek or dispose and preserves the original error', async () => {
 let fail, cleanup=0, cleared=0; const pending=new Promise((_,reject)=>fail=reject);const registry=createEffectRegistry();
 registry.register({schemaVersion:1,id:'partial',version:'1',parametersSchema:{}},()=>true,()=>({mount(){return pending},async seek(){throw Error('must not seek')},dispose(){cleanup++;throw Error('cleanup failed')}}));
 const root={style:{},replaceChildren(){cleared++}};const controller=mountEffect(root,registry,{id:'partial',version:'1',parameters:{},startFrame:0,endFrame:2},{width:10,height:10,fps:30,seed:0,assets:{}});
 fail(Error('original mount failure'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cleanup,1);assert.equal(cleared,1);
 await assert.rejects(controller.seek(0),/original mount failure/);controller.dispose();assert.equal(cleanup,1);
});
test('synchronous mount failure preserves original error even if cleanup throws', () => {
 let cleared=0;const registry=createEffectRegistry();registry.register({schemaVersion:1,id:'sync-fail',version:'1',parametersSchema:{}},()=>true,()=>({mount(){throw Error('original')},async seek(){},dispose(){throw Error('cleanup')}}));
 assert.throws(()=>mountEffect({style:{},replaceChildren(){cleared++}},registry,{id:'sync-fail',version:'1',parameters:{},startFrame:0,endFrame:1},{width:10,height:10,fps:30,seed:0,assets:{}}),/original/);assert.equal(cleared,1);
});
