import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {TransitionShader,TransitionOptions} from '@videoml/stdlib/effects/transitions';

export interface TransitionCaptureOptions {
  fromBundlePath:string; toBundlePath:string; compositorBundlePath:string;
  width:number; height:number; frames:number[]; startFrame:number; endFrame:number;
  fps:number; seed:number; assets:Readonly<Record<string,unknown>>;
  fromSceneId:string; toSceneId:string;
  shader:TransitionShader; parameters?:TransitionOptions; easeName?:string; sceneScript?:unknown; durationFrames?:number; allowCrossfadeFallback?:boolean;
  onDiagnostic?:(diagnostic:'CROSSFADE_FALLBACK')=>void;
  outDir:string; executablePath?:string; signal?:AbortSignal; stageTimeoutMs?:number;
}

/** Capture browser-painted, explicitly selected local scenes into a third compositor page. */
export async function captureTransitionFrames(options:TransitionCaptureOptions):Promise<string[]> {
  const {width,height,frames,startFrame,endFrame,signal}=options;
  if (![width,height,startFrame,endFrame,...frames].every(Number.isSafeInteger) || width<1 || height<1 || width>4096 || height>4096 || width*height>4194304 || startFrame<0 || endFrame<=startFrame || frames.some(f=>f<0)) throw new Error('Invalid capture dimensions or frames');
  if(!Number.isFinite(options.fps)||options.fps<=0||!Number.isInteger(options.seed)||options.seed<0||options.seed>0xffffffff||!options.assets||typeof options.assets!=='object'||Array.isArray(options.assets)||typeof options.fromSceneId!=='string'||!options.fromSceneId||typeof options.toSceneId!=='string'||!options.toSceneId) throw new Error('Invalid scene capture configuration');
  if(options.allowCrossfadeFallback && typeof options.onDiagnostic!=='function') throw new Error('A diagnostic handler is required for crossfade fallback');
  if (signal?.aborted) throw new Error('Transition capture aborted');
  const {chromium}=createRequire(import.meta.url)('playwright') as typeof import('playwright');
  const timeout=options.stageTimeoutMs ?? 30000;
  if(!Number.isInteger(timeout)||timeout<1||timeout>300000) throw new Error('Invalid stage timeout');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  async function stage<T>(name:string,work:Promise<T>,closeOnFailure=true):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined; let cancel:(()=>void)|undefined;
    const interrupted=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Transition capture ${name} timed out`)),timeout);cancel=()=>reject(new Error('Transition capture aborted'));signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
    try{return await Promise.race([work,interrupted]);}catch(error){if(closeOnFailure)void browser?.close().catch(()=>{});throw error;}finally{if(timer)clearTimeout(timer);if(cancel)signal?.removeEventListener('abort',cancel);}
  }
  const launch=chromium.launch({executablePath:options.executablePath ?? process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH});
  try{browser=await stage('launch',launch);}catch(error){void launch.then(late=>late.close().catch(()=>{}),()=>{});throw error;}
  const abort=()=>{void browser?.close().catch(()=>{});}; signal?.addEventListener('abort',abort,{once:true});
  const contexts:import('playwright').BrowserContext[]=[];
  const blockedRequests:string[]=[];const sceneErrors:string[]=[];
  let failed=false;
  try {
    if(signal?.aborted) throw new Error('Transition capture aborted');
    async function open(bundle:string) {
      const context=await stage('context',browser!.newContext({viewport:{width,height},deviceScaleFactor:1})); contexts.push(context);
      await stage('route',context.route('**/*',route=>{blockedRequests.push(route.request().url());return route.abort();}));
      const page=await stage('page',context.newPage());
      page.on('console',message=>{if(message.type()==='warning' && message.text().includes('Component not found:'))sceneErrors.push(message.text());});
      await stage('content',page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0;padding:0;overflow:hidden}</style><div id="root"></div>'));
      await stage('bundle',page.addScriptTag({path:resolve(bundle)}));
      return page;
    }
    const from=await open(options.fromBundlePath),to=await open(options.toBundlePath),compositor=await open(options.compositorBundlePath);
    for(const [page,sceneId] of [[from,options.fromSceneId],[to,options.toSceneId]] as const) await stage('scene mount',page.evaluate(async config=>{
      const api=window as any;
      if(typeof api.mountVideoMLScene!=='function') throw new Error('SCENE_CAPTURE_UNAVAILABLE: bundle must expose mountVideoMLScene');
      api.__videomlScene=await api.mountVideoMLScene(document.querySelector('#root'),config);
      if(!api.__videomlScene || typeof api.__videomlScene.seek!=='function' || typeof api.__videomlScene.dispose!=='function') throw new Error('SCENE_CAPTURE_UNAVAILABLE: invalid scene source');
    },{width,height,fps:options.fps,seed:options.seed,assets:options.assets,captureSceneId:sceneId,selectedSceneVisible:true,script:options.sceneScript,durationFrames:options.durationFrames}));
    await stage('compositor mount',compositor.evaluate(async config=>{
      const api=window as any;
      if(typeof api.mountVideoMLTransition!=='function') throw new Error('Compositor bundle must expose mountVideoMLTransition');
      api.__videomlDiagnostics=[];
      api.__videomlTransition=await api.mountVideoMLTransition(document.querySelector('#root'),{...config,onDiagnostic:Function('diagnostic','window.__videomlDiagnostics.push(diagnostic)')});
      if(!api.__videomlTransition || typeof api.__videomlTransition.render!=='function' || typeof api.__videomlTransition.dispose!=='function') throw new Error('Invalid compositor');
    },{width,height,startFrame,endFrame,shader:options.shader,parameters:options.parameters,easeName:options.easeName,allowCrossfadeFallback:!!options.allowCrossfadeFallback}));
    for(const diagnostic of await compositor.evaluate(()=>(window as any).__videomlDiagnostics as string[])) {
      if(diagnostic==='CROSSFADE_FALLBACK') options.onDiagnostic?.(diagnostic);
    }
    await mkdir(options.outDir,{recursive:true}); const paths:string[]=[];
    for(let index=0;index<frames.length;index++) {
      if(signal?.aborted) throw new Error('Transition capture aborted');
      const frame=frames[index];
      for(const page of [from,to]) await stage('scene seek',page.evaluate(async frame=>{await (window as any).__videomlScene.seek(frame);},frame));
      if(blockedRequests.length)throw new Error(`SCENE_CAPTURE_UNAVAILABLE: blocked network request ${blockedRequests[0]}`);
      if(sceneErrors.length)throw new Error(`SCENE_CAPTURE_UNAVAILABLE: ${sceneErrors[0]}`);
      const [a,b]=await stage('scene screenshot',Promise.all([from.screenshot(),to.screenshot()]));
      if(a.length>16777216||b.length>16777216) throw new Error('Scene capture exceeds PNG size limit');
      await stage('compositor render',compositor.evaluate(async ({frame,a,b})=>{await (window as any).__videomlTransition.render(frame,a,b);},{frame,a:a.toString('base64'),b:b.toString('base64')}));
      const png=await stage('compositor screenshot',compositor.screenshot());
      if(signal?.aborted) throw new Error('Transition capture aborted');
      const path=join(options.outDir,`frame-${String(index).padStart(6,'0')}-${String(frame).padStart(6,'0')}.png`);
      await writeFile(path,png); paths.push(path);
    }
    return paths;
  } catch(error) {failed=true; if(signal?.aborted) throw new Error('Transition capture aborted'); throw error;}
  finally {
    signal?.removeEventListener('abort',abort);
    let cleanupError:unknown;
    for(const context of contexts) {
      for(const page of context.pages()) try {await stage('dispose',page.evaluate(async()=>{const api=window as any;await api.__videomlScene?.dispose();await api.__videomlTransition?.dispose();}));} catch(error){cleanupError ??=error;}
      try {await stage('context close',context.close(),false);} catch(error){cleanupError ??=error;}
    }
    try {await stage('browser close',browser.close(),false);} catch(error){cleanupError ??=error;}
    if(!failed && cleanupError) throw cleanupError;
  }
}
