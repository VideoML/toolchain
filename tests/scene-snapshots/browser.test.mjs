import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSceneSnapshots } from '../../packages/renderer/src/prepare-scene-snapshots.ts';
import { captureSceneSnapshotPng } from '../../packages/renderer/src/scene-snapshot-capture.ts';
const executablePath = process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if (!executablePath)
    throw Error('VIDEOML_CHROMIUM_EXECUTABLE_PATH required');
test('isolated browser snapshot preserves authored HTML and canvas at its fixed source frame', async () => { const dir = await mkdtemp(join(tmpdir(), 'p03b-browser-')); try {
    const plugin = { name: 'stdlib-source', setup(build) { build.onResolve({ filter: /^@videoml\/stdlib\// }, args => ({ path: resolve('../stdlib/src', args.path.slice('@videoml/stdlib/'.length), 'index.ts').replace('/effects/xml/index.ts', '/effects/xml.ts') })); } };
    const built = await build({ entryPoints: ['packages/renderer/src/frame-effect-browser.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', plugins: [plugin], nodePaths: [resolve('node_modules')] });
    const factory = join(dir, 'factory.js');
    await writeFile(factory, `window.registerVideoMLFrameEffects=r=>{r.register({schemaVersion:1,id:'test/source',version:'1',parametersSchema:{type:'object'}},()=>true,()=>({async mount(root,ctx){const font=new FontFace('P03BFixture',await(await fetch(ctx.assets.font)).arrayBuffer());await font.load();document.fonts.add(font);let c=document.createElement('canvas');c.width=160;c.height=90;root.append(c);let text=document.createElement('span');text.textContent='AUTHORED';Object.assign(text.style,{position:'absolute',left:'20px',top:'20px',color:'#fff',fontFamily:'P03BFixture'});root.append(text)},async seek(frame){let c=document.querySelector('canvas').getContext('2d');c.fillStyle=frame===36?'#a62060':'#2040a0';c.fillRect(0,0,160,90)},dispose(){}}));r.register({schemaVersion:1,id:'test/snapshot',version:'1',parametersSchema:{type:'object'},sceneInputs:[{sceneIdParameter:'sourceSceneId',frameParameter:'sourceFrame'}]},()=>true,p=>{let s;return {async mount(root,ctx){if(!ctx.sceneSnapshots)throw Error('SCENE_CAPTURE_UNAVAILABLE');s=await ctx.sceneSnapshots.capture({sceneId:p.sourceSceneId,frame:p.sourceFrame,signal:new AbortController().signal});const c=document.createElement('canvas');c.width=160;c.height=90;c.getContext('2d').drawImage(s.bitmap,0,0);root.append(c)},async seek(){},dispose(){s?.close()}}});}`);
    const customEffects = [{ id: 'test/snapshot', version: '1', sceneInputs: [{ sceneIdParameter: 'sourceSceneId', frameParameter: 'sourceFrame' }] }];
    const script = { scenes: [{ id: 'source', startSec: 2, endSec: 4, components: [{ id: 'source-canvas', type: 'FrameEffect', props: { effectId: 'test/source', effectVersion: '1', parameters: {} }, timing: { startSec: 0, endSec: 4 } }, {id:'ordinary-title',type:'VideoTitle',props:{text:'Scene title',fontSize:14,color:'#111111',position:{x:10,y:60}},timing:{startSec:0,endSec:4}}] }, { id: 'sink', startSec: 0, endSec: 2, components: [{ id: 'snapshot', type: 'FrameEffect', props: { effectId: 'test/snapshot', effectVersion: '1', parameters: { sourceSceneId: 'source', sourceFrame: 36 } }, timing: { startSec: 0, endSec: 2 } }] }] };
    const base = { script, width: 160, height: 90, fps: 24, seed: 5, assets: { font: 'data:font/woff2;base64,' + (await readFile('../stdlib/fixtures/particles/Geist-Latin.woff2')).toString('base64') }, durationFrames: 96, encodedTransferAllowance: 64 * 1024 * 1024, bundle: built.outputFiles[0].text, portableBundlePath: factory, customEffects };
    const snapshots = await prepareSceneSnapshots(base);
    assert.deepEqual(snapshots.map(({ sceneId, frame }) => ({ sceneId, frame })), [{ sceneId: 'source', frame: 36 }]);
    const controller = new AbortController();
    const a = await captureSceneSnapshotPng({ ...base, request: { sceneId: 'sink', frame: 2 }, signal: controller.signal, snapshots, executablePath }), b = await captureSceneSnapshotPng({ ...base, request: { sceneId: 'sink', frame: 8 }, signal: controller.signal, snapshots, executablePath });
    assert.deepEqual(a, b);
    await writeFile(join(dir, 'captured.png'), a);
    const script30 = structuredClone(script);
    script30.scenes[0].id = 'source-b';
    script30.scenes[1].components[0].props.parameters.sourceSceneId = 'source-b';
    script30.scenes[1].components[0].props.parameters.sourceFrame = 45;
    const base30 = { ...base, script: script30, fps: 30, durationFrames: 120 };
    const snapshots30 = await prepareSceneSnapshots(base30);
    assert.deepEqual({ sceneId: snapshots30[0].sceneId, frame: snapshots30[0].frame }, { sceneId: 'source-b', frame: 45 });
    const c = await captureSceneSnapshotPng({ ...base30, request: { sceneId: 'sink', frame: 8 }, signal: controller.signal, snapshots: snapshots30, executablePath });
    assert.notDeepEqual(a, c);
    await writeFile(join(dir, 'captured-30.png'), c);
    const guardFactory=join(dir,'guard.js');
    await writeFile(guardFactory, `window.createImageBitmap=()=>{throw Error('DECODE_CALLED')};\n`+(await readFile(factory,'utf8')));
    await assert.rejects(captureSceneSnapshotPng({...base,portableBundlePath:guardFactory,request:{sceneId:'source',frame:36},signal:controller.signal,snapshots:[],encodedTransferAllowance:1,executablePath}),/SCENE_CAPTURE_LIMIT: transfer budget/);
    console.log('snapshot evidence:', dir);
}
finally {
    if (!process.env.P03B_KEEP_ARTIFACTS)
        await rm(dir, { recursive: true, force: true });
} });
