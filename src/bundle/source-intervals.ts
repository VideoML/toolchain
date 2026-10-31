import {qualifiedTimingId,type ResolvedTiming} from '@videoml/shared/resolved-timing';
import type {Script} from '../models.js';
/** Recompute generation's scene/transition child interval projection against frozen frames. */
export function verifyChildIntervals(script:Script,timing:ResolvedTiming):void {
 const actualLayers:string[]=[],actualComponents:string[]=[];const map=new Map([...timing.layers,...timing.components].map(i=>[i.id,i]));
 const check=(kind:string,path:string[],start:number,end:number,ids:string[])=>{const id=qualifiedTimingId(kind,path),value=map.get(id);ids.push(id);if(!value||!Number.isFinite(start)||!Number.isFinite(end)||end<start||Math.floor(start*timing.fps)!==value.startFrame||(start===end?value.startFrame:Math.ceil(end*timing.fps))!==value.endFrame)throw new Error(`BUNDLE_TIMING: child interval mismatch ${id}`);};
 const owner=(kind:'scene'|'transition',item:any)=>{
  const layerKind=kind==='scene'?'layer':'transition-layer',componentKind=kind==='scene'?'component':'transition-component';
  for(const layer of item.layers??[]){const start=item.startSec+(layer.timing?.startSec??0),end=layer.timing?.endSec===undefined?item.endSec:item.startSec+layer.timing.endSec;check(layerKind,[item.id,layer.id],start,end,actualLayers);for(const component of layer.components??[]){const from=start+(component.timing?.startSec??0),to=component.timing?.endSec===undefined?end:start+component.timing.endSec;check(componentKind,[item.id,layer.id,component.id],from,to,actualComponents);}}
  for(const component of item.components??[]){const start=item.startSec+(component.timing?.startSec??0),end=component.timing?.endSec===undefined?item.endSec:item.startSec+component.timing.endSec;check(componentKind,[item.id,component.id],start,end,actualComponents);}
 };
 for(const scene of script.scenes)owner('scene',scene);for(const item of script.timeline??[])if(item.kind==='transition')owner('transition',item);
 if(JSON.stringify(actualLayers)!==JSON.stringify(timing.layers.map(i=>i.id))||JSON.stringify(actualComponents)!==JSON.stringify(timing.components.map(i=>i.id)))throw new Error('BUNDLE_TIMING: child interval order mismatch');
}
