import {createPixelRenderer} from '../../../../stdlib/src/effects/transitions/renderer';
(window as any).checkAlpha=(name:any)=>{
 const source=(color:string)=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return c;};
 const a=source('rgba(255,0,0,0.25)'),b=source('rgba(0,0,255,0.5)');
 const renderer=createPixelRenderer(document.body,{width:1,height:1,shader:name});
 const read=(p:number)=>{renderer.render(a,b,p);const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')!;ctx.drawImage(renderer.canvas,0,0);return [...ctx.getImageData(0,0,1,1).data]};
 const result=[read(0),read(.5),read(1)];renderer.dispose();return result;
};
