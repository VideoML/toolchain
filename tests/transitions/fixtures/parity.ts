import {createPixelRenderer} from '../../../../stdlib/src/effects/transitions/renderer';
import {mountCapturedSceneCompositor} from '../../../../stdlib/src/effects/transitions/index';
(window as any).comparePreviewExport=async(a:string,b:string)=>{
 const decode=async(s:string)=>createImageBitmap(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))],{type:'image/png'}));
 const first=await decode(a),second=await decode(b);const root=document.createElement('div');document.body.append(root);
 const preview=createPixelRenderer(root,{width:320,height:240,shader:'domain-warp'});preview.render(first,second,.5);const previewBytes=preview.canvas.toDataURL();
 const exported=mountCapturedSceneCompositor(root,{width:320,height:240,shader:'domain-warp',startFrame:0,endFrame:24});await exported.render(12,a,b);
 const exportBytes=root.querySelectorAll('canvas')[1].toDataURL();preview.dispose();exported.dispose();first.close();second.close();root.remove();return [previewBytes,exportBytes];
};
