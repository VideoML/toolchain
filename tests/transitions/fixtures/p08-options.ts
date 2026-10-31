import {createPixelRenderer} from '../../../../stdlib/src/effects/transitions/renderer';
(window as any).checkP08Options=()=>{
 const input=document.createElement('canvas');input.width=input.height=1;const ctx=input.getContext('2d')!;ctx.fillStyle='rgba(255,0,0,.5)';ctx.fillRect(0,0,1,1);
 const renderer=createPixelRenderer(document.body,{width:1,height:1,shader:'domain-warp',parameters:{backgroundColor:'#0000ff'}});renderer.render(input,input,0);const output=document.createElement('canvas');output.width=output.height=1;const out=output.getContext('2d')!;out.drawImage(renderer.canvas,0,0);const pixel=[...out.getImageData(0,0,1,1).data];renderer.dispose();
 const original=HTMLCanvasElement.prototype.getContext;let diagnostics:string[]=[];let strict=false;try{(HTMLCanvasElement.prototype as any).getContext=function(kind:string,...args:any[]){return kind==='webgl'?null:(original as any).call(this,kind,...args)};try{createPixelRenderer(document.body,{width:1,height:1,shader:'domain-warp'});}catch(e){strict=String(e).includes('SHADER_UNAVAILABLE');}const fallback=createPixelRenderer(document.body,{width:1,height:1,shader:'domain-warp',allowCrossfadeFallback:true,onDiagnostic:d=>diagnostics.push(d)});fallback.render(input,input,.5);fallback.dispose();}finally{HTMLCanvasElement.prototype.getContext=original;}
 return {pixel,strict,diagnostics};
};
