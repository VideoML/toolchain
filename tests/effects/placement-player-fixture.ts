import {createVmlPlayerController} from '../../../player/src/runtime.js';
import {createEffectRegistry} from '../../../stdlib/src/effects/index.js';
(window as any).checkPlacement=async(fps:number)=>{
 const host=document.createElement('div');document.body.append(host);let placement:any;const seen:number[]=[];
 const fallbackHost=document.createElement('div');fallbackHost.innerHTML='<frame-effect></frame-effect><unknown-placement></unknown-placement>';document.body.append(fallbackHost);const {registerFallbackComponents}=await import('../../../stdlib/src/dom/index.js');registerFallbackComponents(fallbackHost);await Promise.resolve();if(fallbackHost.querySelector('frame-effect')!.childNodes.length)throw Error('frame-effect fallback placeholder leaked');if(!fallbackHost.querySelector('unknown-placement')!.textContent?.includes('unknown-placement'))throw Error('unknown fallback missing');fallbackHost.remove();
 const registry=createEffectRegistry();registry.register({schemaVersion:1,id:'test/placement',version:'1',parametersSchema:{type:'object'}},()=>true,()=>({mount(root,context){placement=context.timing;root.textContent='placement'},async seek(frame){seen.push(frame)},dispose(){}}));
 const xml=`<vml id="test" fps="${fps}" width="100" height="100"><scene id="s" duration="2s"><frame-effect id="effect" effect-id="test/placement" effect-version="1" props='{"parameters":{}}' start="0.31s" duration="0.23s"/></scene></vml>`;
 const player=createVmlPlayerController(host,{xml,autoPlay:false,effectRegistry:registry});const start=Math.floor(.31*fps),end=Math.ceil((.31+.23)*fps),observations=[];
 for(const frame of [0,start-1,start,end-1,end,start,start-1]){await player.seek(frame);const element=host.querySelector('#effect') as HTMLElement;let painted=true;for(let node:HTMLElement|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')painted=false;}observations.push({frame,visibility:element.style.visibility,display:element.style.display,painted});}
 const result={placement,frozen:Object.isFrozen(placement),seen,observations,start,end};player.dispose();host.remove();return result;
};
