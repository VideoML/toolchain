import { createEffectRegistry } from '../../../stdlib/src/effects/index.js';
import { mountPlayerEffect } from '../../../player/src/effects.js';
import { mountRendererEffect } from '../../packages/renderer/src/effects.js';

declare const MODE:string;
const registry=createEffectRegistry();
registry.register({schemaVersion:1,id:'test/dom-canvas',version:'1',parametersSchema:{type:'object',properties:{color:{type:'string'}},required:['color']}}, p=>typeof p.color==='string', p=>{
  let root:HTMLElement, canvas:HTMLCanvasElement, listener:()=>void;
  let ready:Promise<void>;
  return {
    mount(element) {
      root=element; root.style.cssText='position:relative;width:100%;height:100%;background:#14283c';
      canvas=document.createElement('canvas'); canvas.width=1280; canvas.height=720; root.append(canvas);
      const label=document.createElement('div');label.textContent='shared effect';label.style.cssText='position:absolute;top:5px;left:5px;color:white';root.append(label);
      listener=()=>{document.body.dataset.leaked='yes'}; window.addEventListener('p04-resource',listener);
      ready=new Promise(resolve=>setTimeout(()=>{root.dataset.assetReady='yes';resolve();},30));
    },
    async seek(frame) {
      await ready; const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle=String(p.color);ctx.fillRect(40+frame*17,200,160,120);root.dataset.frame=String(frame);
    },
    dispose(){window.removeEventListener('p04-resource',listener);canvas.width=0;canvas.height=0;},
  };
});
(window as any).mountVideoMLEffect = (root:HTMLElement, config:any, context:any) => mountRendererEffect(root,registry,config,context);
for (const mount of [mountPlayerEffect,mountRendererEffect]) {
  try { mount(document.createElement('div'),registry,{id:'test/dom-canvas',version:'1',parameters:{color:42},startFrame:0,endFrame:30},{width:1280,height:720,fps:30,seed:0,assets:{}}); throw new Error('invalid parameters accepted'); }
  catch(error:any) { if (!String(error.message).includes('Invalid parameters')) throw error; }
}
let controller:ReturnType<typeof mountPlayerEffect>;
(window as any).fixture={
  mount(root:HTMLElement, context:any) { controller=(MODE==='player'?mountPlayerEffect:mountRendererEffect)(root,registry,{id:'test/dom-canvas',version:'1',parameters:{color:'#40c080'},startFrame:0,endFrame:30},context); },
  async seek(frame:number){await controller.seek(frame);if(document.querySelector('#root')?.getAttribute('data-asset-ready')!=='yes')throw Error('asset not settled');},
  dispose(){const canvas=document.querySelector('#root canvas') as HTMLCanvasElement;controller.dispose();if(canvas.width!==0||canvas.height!==0)throw Error('canvas resource leaked');window.dispatchEvent(new Event('p04-resource'));if(document.body.dataset.leaked)throw Error('listener leaked');if(document.querySelector('#root')?.childNodes.length)throw Error('DOM leaked');},
};
