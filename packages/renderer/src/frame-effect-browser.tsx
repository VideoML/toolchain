import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {RendererProvider} from './context.js';
import {ComposableRenderer} from './ComposableRenderer.js';
import {createBuiltinEffectRegistry,mountFrameEffects} from '@videoml/stdlib/effects/xml';
const root=document.getElementById('root')!;
const reactRoot=createRoot(root);
const registry=createBuiltinEffectRegistry();
const registerCustom=(window as any).registerVideoMLFrameEffects;if(registerCustom!==undefined){if(typeof registerCustom!=='function')throw new Error('FRAME_EFFECT_INVALID: invalid custom registry hook');registerCustom(registry);}
const effects=new Map<HTMLElement,{signature:string;controller:ReturnType<typeof mountFrameEffects>}>();
let disposed=false;
(window as any).videomlFrameEffectRender=async ({script,frame,config,assets,seed}:any)=>{
 if(disposed)throw new Error('Renderer disposed');
 flushSync(()=>reactRoot.render(<RendererProvider frame={frame} config={config}><ComposableRenderer script={script}/></RendererProvider>));
 const elements=Array.from(root.querySelectorAll('frame-effect')) as HTMLElement[];
 for(const [element,effect] of effects)if(!elements.includes(element)){effect.controller.dispose();effects.delete(element);}
 for(const element of elements){
  const signature=JSON.stringify(['id','effect-id','effect-version','props','data-start','data-end'].map(name=>element.getAttribute(name)));
  const existing=effects.get(element);if(existing?.signature===signature)continue;if(existing){existing.controller.dispose();effects.delete(element);}
  Object.assign(element.style,{display:"block",position:"absolute",inset:"0",width:"100%",height:"100%"});
  const start=Number(element.getAttribute('data-start')),end=Number(element.getAttribute('data-end'));
  if(!Number.isFinite(start)||!Number.isFinite(end))throw new Error('FRAME_EFFECT_INVALID: invalid interval');
  const controller=mountFrameEffects([element],registry,{width:config.width,height:config.height,fps:config.fps,seed,assets},()=>({startFrame:Math.floor(start*config.fps),endFrame:Math.ceil(end*config.fps)}));effects.set(element,{signature,controller});
 }
 await Promise.all([...effects.values()].map(effect=>effect.controller.seek(frame)));
 await document.fonts.ready;await Promise.all(Array.from(root.querySelectorAll('img')).map(image=>image.decode()));
 await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};
(window as any).videomlFrameEffectDispose=()=>{disposed=true;let failure:unknown;for(const effect of effects.values())try{effect.controller.dispose();}catch(error){failure??=error;}effects.clear();reactRoot.unmount();if(failure)throw failure;};
