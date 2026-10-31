import {qualifiedTimingId,type ResolvedTiming} from '@videoml/shared/resolved-timing';
import type {CompositionSpec,PauseSpec,SceneSpec} from '../dsl/types.js';
import type {Script} from '../models.js';
import {makeRng,normalizePauseSpec,samplePause} from '../script-pauses.js';
import {transitionDuration} from '../script-projection.js';
/** Reconstruct the generator's scene cursor, pauses and insertion shifts without synthesis. */
export function verifySourceCursor(composition:CompositionSpec,script:Script,timing:ResolvedTiming):number[] {
 const timeline=composition.timeline,voice=composition.voiceover??{},rate=voice.sampleRateHz??24000;if(rate!==timing.sampleRateHz)throw new Error('BUNDLE_TIMING: sample rate mismatch');
 const random=makeRng(timing.generationSeed),choices=new Map<object,number[]>();
 const record=(key:object,spec:PauseSpec)=>{const n=Math.floor(samplePause(spec,random)*rate+0.5),values=choices.get(key)??[];values.push(n);choices.set(key,values);};
 for(const item of timeline){if(!('items' in item))continue;item.items.forEach((entry,index)=>{const between=index>0?normalizePauseSpec(voice.pauseBetweenItems):null;if(between)record(entry,between);if(entry.kind==='pause')record(entry,entry);else for(const segment of entry.segments)if(segment.kind==='pause')record(segment,segment.pause);});}
 const take=(key:object)=>{const count=choices.get(key)?.shift();if(count===undefined)throw new Error('BUNDLE_TIMING: missing pause');return count/rate;};
 const sceneItems=timeline.filter(item=>!('kind' in item));const narrationItems=timeline.filter(item=>'kind' in item&&item.kind==='narration');
 const sourceSegments=[...sceneItems,...narrationItems].flatMap(item=>'items' in item?item.items.flatMap(entry=>entry.kind==='cue'?entry.segments.flatMap((segment,index)=>segment.kind==='text'?[qualifiedTimingId('segment',[entry.id,index])]:[]):[]):[]);
 if(JSON.stringify(sourceSegments)!==JSON.stringify(timing.segments.map(segment=>segment.id)))throw new Error('BUNDLE_TIMING: segment order mismatch');
 const sourceCues=timeline.flatMap(item=>'items' in item?item.items.filter(entry=>entry.kind==='cue').map(cue=>qualifiedTimingId('cue',[cue.id])):[]);
 if(JSON.stringify(sourceCues)!==JSON.stringify(timing.cues.map(cue=>cue.id)))throw new Error('BUNDLE_TIMING: cue order mismatch');
 const frozen=new Map(timing.segments.map(segment=>[segment.id,segment]));const sceneSource=timeline.filter((item):item is SceneSpec=>!('kind' in item));let now=Math.floor((voice.leadInSeconds??0)*rate+0.5)/rate;const initial=new Map<string,{start:number;end:number;cues:Array<{id:string;start:number;end:number}>}>();
 if(now&&sceneSource.some(scene=>scene.time))throw new Error('BUNDLE_TIMING: lead-in with explicit scenes');
 for(const scene of sceneSource){
  const start=scene.time?(scene.time.startIsRelative?now+(scene.time.start??0):scene.time.start):now;if(scene.time?.start!=null&&!scene.time.startIsRelative&&start>now)now=start;
  const cues:Array<{id:string;start:number;end:number}>=[];
  scene.items.forEach((item,index)=>{if(index>0&&normalizePauseSpec(voice.pauseBetweenItems))now+=take(item);if(item.kind==='pause'){now+=take(item);return;}const cueStart=now;item.segments.forEach((segment,position)=>{if(segment.kind==='pause')now+=take(segment);else{const info=frozen.get(qualifiedTimingId('segment',[item.id,position]));if(!info)throw new Error('BUNDLE_TIMING: missing narration segment');now+=(info.endSample-info.startSample)/rate;}});cues.push({id:item.id,start:cueStart,end:now});});
  const endHint=scene.time?.end!=null?(scene.time.startIsRelative?start+(scene.time.end-(scene.time.start??0)):scene.time.end):null;now=Math.max(now,endHint??now);initial.set(scene.id,{start,end:now,cues});
 }
 const sceneBefore=(index:number,step:number)=>{for(let i=index+step;i>=0&&i<timeline.length;i+=step)if(!('kind' in timeline[i]))return timeline[i].id;return undefined;};let cumulative=0;const shifts=new Map<string,number>(),shiftBefore:number[]=[];
 for(let i=0;i<timeline.length;i++){shiftBefore[i]=cumulative;const item=timeline[i];if(!('kind' in item)){shifts.set(item.id,cumulative);continue;}if(item.kind==='transition'&&(item.mode??'overlap')==='insert'){const duration=transitionDuration(item),prev=sceneBefore(i,-1),next=sceneBefore(i,1);let extra=duration;if(prev&&next){const a=initial.get(prev),b=initial.get(next);if(a&&b)extra=Math.max(0,a.end+(shifts.get(prev)??0)+duration-(b.start+cumulative));}cumulative+=extra;}}
 const rounded=(v:number)=>Math.floor(v*rate+0.5)/rate;
 for(const scene of sceneSource){const expected=initial.get(scene.id)!,actual=script.scenes.find(s=>s.id===scene.id);if(!actual)throw new Error('BUNDLE_TIMING: missing scene');const shift=shifts.get(scene.id)??0;const preStart=expected.start+shift;const incoming=(script.timeline??[]).find(item=>item.kind==='transition'&&item.mode==='overlap'&&item.toSceneId===scene.id);const finalStart=incoming&&incoming.kind==='transition'&&incoming.startSec<preStart?incoming.startSec:preStart;
  if(actual.startSec!==finalStart||actual.endSec!==expected.end+shift)throw new Error('BUNDLE_TIMING: scene cursor mismatch');
  for(const layer of actual.layers??[])for(const component of layer.components)if(component.props?.sceneStartSec!==preStart)throw new Error('BUNDLE_TIMING: pre-overlap scene start mismatch');
  for(let i=0;i<expected.cues.length;i++){const cue=actual.cues[i],source=expected.cues[i];if(!cue||cue.id!==source.id||cue.startSec!==rounded(source.start+shift)||cue.endSec!==rounded(source.end+shift))throw new Error('BUNDLE_TIMING: cue cursor mismatch');}
 }
 for(let i=0;i<timeline.length;i++){
  const item=timeline[i];if(!('kind' in item)||item.kind!=='narration')continue;const next=sceneBefore(i,1);let cursor=item.time?.start!=null?item.time.start+shiftBefore[i]:next?(initial.get(next)!.start+(shifts.get(next)??0)):undefined;if(cursor===undefined)throw new Error('BUNDLE_TIMING: narration start unavailable');
  item.items.forEach((entry,index)=>{if(index>0&&normalizePauseSpec(voice.pauseBetweenItems))cursor!+=take(entry);if(entry.kind==='pause'){cursor!+=take(entry);return;}const start=rounded(cursor!);entry.segments.forEach((segment,position)=>{if(segment.kind==='pause'){cursor!+=take(segment);return;}const info=frozen.get(qualifiedTimingId('segment',[entry.id,position]));const expanded=(voice.pronunciations??[]).reduce((value,rule)=>rule.alias?value.split(rule.grapheme).join(rule.alias):value,segment.text);if(!info||info.originalText!==segment.text||info.expandedText!==expanded||info.trimSamples!==Math.floor((segment.trimEndSec??voice.trimEndSeconds??0)*rate+0.5)||info.startSample!==Math.floor(cursor!*rate+0.5))throw new Error('BUNDLE_TIMING: standalone narration segment mismatch');cursor!+=(info.endSample-info.startSample)/rate;});const end=rounded(cursor!);const cue=timing.cues.find(cue=>cue.id===qualifiedTimingId('cue',[entry.id]));if(!cue||Math.floor(start*timing.fps)!==cue.startFrame||(start===end?cue.startFrame:Math.ceil(end*timing.fps))!==cue.endFrame)throw new Error('BUNDLE_TIMING: standalone narration cue mismatch');});
 }
 return shiftBefore;
}
