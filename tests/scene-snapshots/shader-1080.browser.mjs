import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareSceneSnapshots} from '../../packages/renderer/src/prepare-scene-snapshots.ts';
import {captureTransitionFrames} from '../../packages/renderer/src/transition-capture.ts';
const executablePath=process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if(!executablePath)throw Error('VIDEOML_CHROMIUM_EXECUTABLE_PATH required');
test('low-entropy 1080p authored scene snapshots survive the P07 shader compositor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p03b-1080-'));
 try {
  const plugin={name:'stdlib-source',setup(build){build.onResolve({filter:/^@videoml\/stdlib\//},args=>({path:resolve('../stdlib/src',args.path.slice('@videoml/stdlib/'.length),'index.ts').replace('/effects/xml/index.ts','/effects/xml.ts')}));}};
  const output=await Promise.all(['packages/renderer/src/frame-effect-browser.tsx','packages/renderer/src/shader-compositor-browser.ts'].map(entry=>build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife',plugins:[plugin],nodePaths:[resolve('node_modules')]})));
  const scene=join(dir,'scene.js'),compositor=join(dir,'compositor.js');await writeFile(scene,output[0].outputFiles[0].contents);await writeFile(compositor,output[1].outputFiles[0].contents);
  const script={scenes:[{id:'source',startSec:0,endSec:2,components:[{id:'bg',type:'Background',props:{color:'#c02060'}}]},{id:'sink',startSec:0,endSec:2,components:[{id:'fx',type:'FrameEffect',props:{effectId:'videoml/scene-snapshot',effectVersion:'1',parameters:{sourceSceneId:'source',sourceFrame:5}},timing:{startSec:0,endSec:2}}]}]};
  const settings={script,width:1920,height:1080,fps:30,seed:0,assets:{},durationFrames:60,bundle:output[0].outputFiles[0].text};
  const snapshots=await prepareSceneSnapshots(settings);assert.equal(snapshots.length,1);
  const files=await captureTransitionFrames({fromBundlePath:scene,toBundlePath:scene,compositorBundlePath:compositor,width:1920,height:1080,fps:30,seed:0,assets:{},frames:[15],startFrame:0,endFrame:30,fromSceneId:'sink',toSceneId:'source',shader:'crossfade',sceneScript:script,durationFrames:60,snapshots,outDir:dir,executablePath});
  assert.equal(files.length,1);assert.ok((await readFile(files[0])).length>1000);console.log('1080p evidence:',dir);
 } finally {if(!process.env.P03B_KEEP_ARTIFACTS)await rm(dir,{recursive:true,force:true});}
});
