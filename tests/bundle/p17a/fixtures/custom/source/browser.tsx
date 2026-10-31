import React from 'react';
import {useCurrentFrame} from '@videoml/renderer/context';
import {gsap} from 'gsap';
export function registerComponents(host:any){
 host.registerComponent({id:'P17Canvas',version:'1',Component:()=>{const frame=useCurrentFrame();return <div data-frame={frame}><canvas width={320} height={240}/></div>;},createController:({root,signal}:{root:HTMLElement;signal:AbortSignal})=>({
  async settle({frame,props}:{frame:number;props:{accent:string}}){await Promise.resolve();if(signal.aborted)return;const canvas=root.querySelector('canvas')!,ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,320,240);ctx.fillStyle=props.accent;ctx.fillRect(gsap.utils.interpolate(30,170,(frame%30)/30),70,45,45);},
  dispose(){}
 })});
}
