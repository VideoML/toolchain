import {isDeepStrictEqual} from 'node:util';
import {qualifiedTimingId,type ResolvedTiming} from '@videoml/shared/resolved-timing';
import type {CompositionSpec,SceneSpec} from '../dsl/types.js';
import {projectAuthoredCue,projectAuthoredScene} from '../script-projection.js';
import type {Script} from '../models.js';

/** Compare generator-owned scene/cue fields to source; full bundle validation additionally checks timeline, assets and segment semantics. */
export function verifyAuthoredScenes(composition:CompositionSpec,script:Script,timing:ResolvedTiming):void {
 const source=composition.timeline.filter((item):item is SceneSpec=>!('kind' in item));
 if(!Array.isArray(script.scenes)||script.scenes.length!==source.length)throw new Error('BUNDLE_SOURCE: scene count mismatch');
 const expectedSceneIds=source.map(scene=>qualifiedTimingId('scene',[scene.id]));
 if(JSON.stringify(expectedSceneIds)!==JSON.stringify(timing.scenes.map(scene=>scene.id)))throw new Error('BUNDLE_TIMING: scene order mismatch');
 const expectedCueIds=source.flatMap(scene=>scene.items.filter(item=>item.kind==='cue').map(cue=>qualifiedTimingId('cue',[cue.id])));
 if(JSON.stringify(expectedCueIds)!==JSON.stringify(timing.cues.map(cue=>cue.id).filter(id=>expectedCueIds.includes(id))))throw new Error('BUNDLE_TIMING: cue order mismatch');
 const intervals=new Map([...timing.scenes,...timing.cues].map(i=>[i.id,i]));
 const check=(kind:string,path:string[],start:number,end:number)=>{const expected=intervals.get(qualifiedTimingId(kind,path));if(!expected||!Number.isFinite(start)||!Number.isFinite(end)||end<start||Math.floor(start*timing.fps)!==expected.startFrame||(start===end?expected.startFrame:Math.ceil(end*timing.fps))!==expected.endFrame)throw new Error('BUNDLE_TIMING: scene or cue mismatch');};
 const frozenSegments=new Map(timing.segments.map(segment=>[segment.id,segment]));
 const projected=source.map((scene,i)=>{
  const actual=script.scenes[i];if(!actual||!Array.isArray(actual.cues))throw new Error('BUNDLE_SOURCE: invalid scene');
  check('scene',[scene.id],actual.startSec,actual.endSec);
  // Without transitions there are no insertion shifts or overlap rewrites.
  // Relative starts require the previous generation cursor and are checked by the full timeline verifier.
  if(!composition.timeline.some(item=>'kind' in item&&item.kind==='transition') && !source.some(item=>item.transitionToNext) && scene.time && !scene.time.startIsRelative && scene.time.start!==actual.startSec)throw new Error('BUNDLE_TIMING: explicit scene start mismatch');
  const cues=scene.items.filter(item=>item.kind==='cue');if(cues.length!==actual.cues.length)throw new Error('BUNDLE_SOURCE: cue count mismatch');
  const propsStarts=(actual.layers??[]).flatMap(layer=>layer.components.map(component=>component.props?.sceneStartSec)).filter((value):value is number=>typeof value==='number');
  const projectionStart=propsStarts[0]??actual.startSec;
  const incoming=(script.timeline??[]).find(item=>item.kind==='transition'&&item.toSceneId===scene.id&&item.mode==='overlap');
  if((!incoming&&projectionStart!==actual.startSec)||!Number.isFinite(projectionStart)||projectionStart<actual.startSec||projectionStart>actual.endSec||propsStarts.some(value=>value!==projectionStart))throw new Error('BUNDLE_SOURCE: invalid pre-overlap start');
  const projectedScene=projectAuthoredScene(scene,projectionStart,actual.endSec,cues.map((cue,j)=>{const target=actual.cues[j];if(!target)throw new Error('BUNDLE_SOURCE: missing cue');check('cue',[cue.id],target.startSec,target.endSec);
   if(!Array.isArray(target.segments)||target.segments.length!==cue.segments.length)throw new Error('BUNDLE_SOURCE: segment count mismatch');
   for(let k=0;k<cue.segments.length;k++){
    const authored=cue.segments[k], segment=target.segments[k];
    if(!segment||!Number.isFinite(segment.startSec)||!Number.isFinite(segment.endSec)||segment.endSec<segment.startSec||segment.startSec<target.startSec||segment.endSec>target.endSec||(k>0&&segment.startSec<target.segments![k-1].endSec))throw new Error('BUNDLE_SOURCE: invalid segment');
    if(authored.kind==='text'){
     if(Object.keys(segment).some(key=>!['type','startSec','endSec','text'].includes(key)))throw new Error('BUNDLE_SOURCE: unknown narration field');
     const frozen=frozenSegments.get(qualifiedTimingId('segment',[cue.id,k]));
     const expanded=(composition.voiceover?.pronunciations??[]).reduce((value,rule)=>rule.alias?value.split(rule.grapheme).join(rule.alias):value,authored.text);
     if(!frozen||frozen.originalText!==authored.text||frozen.expandedText!==expanded||frozen.trimSamples!==Math.floor((authored.trimEndSec??composition.voiceover?.trimEndSeconds??0)*timing.sampleRateHz+0.5)||segment.type!=='tts'||segment.text!==authored.text||segment.startSec!==frozen.startSample/timing.sampleRateHz||segment.endSec!==frozen.endSample/timing.sampleRateHz)throw new Error('BUNDLE_SOURCE: narration segment mismatch');
    }else if(Object.keys(segment).some(key=>!['type','startSec','endSec','durationSec'].includes(key))||segment.type!=='pause'||typeof segment.durationSec!=='number'||Math.round(segment.durationSec*timing.sampleRateHz)!==Math.round((segment.endSec-segment.startSec)*timing.sampleRateHz)||(authored.pause.mode==='fixed'&&Math.round(authored.pause.seconds*timing.sampleRateHz)!==Math.round((segment.endSec-segment.startSec)*timing.sampleRateHz)))throw new Error('BUNDLE_SOURCE: pause mismatch');
   }
   return projectAuthoredCue(cue,target.startSec,target.endSec,target.segments);}));
  projectedScene.startSec=actual.startSec;return projectedScene;
 });
 const expected=JSON.parse(JSON.stringify(projected));const actual=JSON.parse(JSON.stringify(script.scenes));
 if(!isDeepStrictEqual(expected,actual))throw new Error('BUNDLE_SOURCE: authored scene mismatch');
}
