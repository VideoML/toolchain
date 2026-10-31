import {isDeepStrictEqual} from 'node:util';
import {implicitTransitionId,qualifiedTimingId,type ResolvedTiming} from '@videoml/shared/resolved-timing';
import type {CompositionSpec,TransitionSpec} from '../dsl/types.js';
import type {Script} from '../models.js';
import {projectAuthoredTransition,transitionTiming} from '../script-projection.js';
/** Verify source order and authored transition fields. Explicit timing constraints and child interval verification remain separate. */
export function verifyAuthoredTimeline(composition:CompositionSpec,script:Script,timing:ResolvedTiming,shiftBefore:number[]):void {
 if(!Array.isArray(script.timeline))throw new Error('BUNDLE_SOURCE: missing timeline');
 const timeline=composition.timeline, actual=script.timeline,transitionIds:string[]=[];let cursor=0;
 const find=(index:number,step:number)=>{for(let i=index+step;i>=0&&i<timeline.length;i+=step){const item=timeline[i];if(!('kind' in item))return item.id;}return undefined;};
 const transition=(source:TransitionSpec,prev:string|undefined,next:string|undefined,index:number)=>{
  const item=actual[cursor++];if(!item||item.kind!=='transition')throw new Error('BUNDLE_SOURCE: transition missing');
  transitionIds.push(qualifiedTimingId('transition',[source.id]));
  const frame=timing.transitions.find(entry=>entry.id===qualifiedTimingId('transition',[source.id]));
  if(!frame||!Number.isFinite(item.startSec)||!Number.isFinite(item.endSec)||item.endSec<item.startSec||Math.floor(item.startSec*timing.fps)!==frame.startFrame||(item.startSec===item.endSec?frame.startFrame:Math.ceil(item.endSec*timing.fps))!==frame.endFrame)throw new Error('BUNDLE_TIMING: transition mismatch');
  const mode=source.mode??(prev&&next?'overlap':'insert');
  const previous=script.scenes.find(scene=>scene.id===prev),following=script.scenes.find(scene=>scene.id===next);const shift=shiftBefore[index];if(!Number.isFinite(shift))throw new Error('BUNDLE_TIMING: missing transition shift');const adjusted=source.time?{...source,time:{...source.time,start:source.time.start+shift,end:source.time.end===undefined?undefined:source.time.end+shift}}:source;const calculated=transitionTiming(adjusted,previous,following);if(item.startSec!==calculated.startSec||item.endSec!==calculated.endSec)throw new Error('BUNDLE_TIMING: authored transition time mismatch');
  const expected=projectAuthoredTransition(source,item.startSec,item.endSec,mode,prev,next);
  if(!isDeepStrictEqual(JSON.parse(JSON.stringify(expected)),item))throw new Error('BUNDLE_SOURCE: authored transition mismatch');
 };
 for(let i=0;i<timeline.length;i++){
  const source=timeline[i];if(!('kind' in source)){
   const item=actual[cursor++],scene=script.scenes.find(scene=>scene.id===source.id);
   if(!scene||!item||item.kind!=='scene'||!isDeepStrictEqual(item,{kind:'scene',sceneId:source.id,startSec:scene.startSec,endSec:scene.endSec}))throw new Error('BUNDLE_SOURCE: scene timeline mismatch');
   if(source.transitionToNext&&!(timeline[i+1]&&'kind' in timeline[i+1]&&(timeline[i+1] as any).kind==='transition')){const next=find(i,1);transition({kind:'transition',id:implicitTransitionId(source.id,next??null),...source.transitionToNext},source.id,next,i);}
  }else if(source.kind==='transition'){transition(source,find(i,-1),find(i,1),i);}
  else if(source.kind==='mark'){
   const item=actual[cursor++];if(!item||item.kind!=='mark'||item.id!==source.id||Object.keys(item).some(key=>!['kind','id','atSec'].includes(key))||item.atSec!==source.at+shiftBefore[i])throw new Error('BUNDLE_SOURCE: mark mismatch');
  }
 }
 if(cursor!==actual.length)throw new Error('BUNDLE_SOURCE: extra timeline entries');
 if(JSON.stringify(transitionIds)!==JSON.stringify(timing.transitions.map(item=>item.id)))throw new Error('BUNDLE_TIMING: transition order mismatch');
}
