/** Real existing-browser verification; caller supplies already-generated packed project and browser path. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const project=resolve(process.argv[2]); const browserPath=process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if(!project || !browserPath) throw new Error('Provide project path and existing Chromium executable');
const out=join(project,'.videoml/out/tone'), frozen=JSON.parse(readFileSync(join(project,'src/videos/tone/tone.timeline.resolved.json'),'utf8'));
const audioFile=join(out,'frozen-audio',process.argv[3]); const composition=readFileSync(audioFile).toString('base64');
const segments=Object.fromEntries(frozen.segments.map(s=>[s.audioPath,readFileSync(join(out,s.audioPath)).toString('base64')]));
const xml=readFileSync(join(project,'tone.xml'),'utf8').replace('<scene id="a"','<scene id="a" start="99" end="100"').replace('<scene id="b"','<scene id="b" start="101" end="102"');
const scratch=mkdtempSync(join(tmpdir(),'videoml-player-bundle-'));
const entry=join(process.cwd(),'player-browser-entry.ts');
try {
 writeFileSync(entry,`import {createVerifiedVmlPlayerController} from '@videoml/player';\n(globalThis as any).mountFrozen=async (xml:any,timing:any,segments:any,composition:any)=>{const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)).buffer;return createVerifiedVmlPlayerController(document.getElementById('root')!,{xml,resolvedTiming:timing,autoPlay:false},async path=>decode(segments[path]),async()=>decode(composition));};`);
 const bundle=join(scratch,'player.js');await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'browser',format:'iife',logLevel:'silent'});rmSync(entry,{force:true});
 const browser=await chromium.launch({executablePath:browserPath,headless:true});
 try {const page=await browser.newPage({viewport:{width:160,height:90}});await page.route('http://localhost/**', route => route.fulfill({status:200,contentType:'text/html',body:'<html><body style="margin:0"><div id="root" style="width:160px;height:90px"></div></body></html>'}));await page.goto('http://localhost/');await page.addScriptTag({path:bundle});
  const error=await page.evaluate(async ({xml,frozen,segments,composition})=>{try{window.controller=await window.mountFrozen(xml,frozen,segments,composition);return null;}catch(e){return String(e);}}, {xml,frozen,segments,composition});if(error)throw new Error(error);
  for(const frame of [0,2]){await page.evaluate(async frame=>window.controller.seek(frame),frame);await page.screenshot({path:join(project,`player-frame-${frame}.png`)});}
  const state=await page.evaluate(()=>Array.from(document.querySelectorAll('scene')).map(node=>({id:node.id,display:getComputedStyle(node).display})));
  console.log(JSON.stringify({state,frames:[0,2],durationFrames:frozen.durationFrames}));await page.evaluate(()=>window.controller.dispose());
 }finally{await browser.close();}
}finally{rmSync(entry,{force:true});rmSync(scratch,{recursive:true,force:true});}
