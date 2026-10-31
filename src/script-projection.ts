import type {CueSpec, SceneSpec, TransitionSpec} from './dsl/types.js';
import {makeBullet, type CuePoint, type Scene, type TransitionTimelineItem} from './models.js';

/** The generator's authored cue projection, with timing supplied by generation. */
export function projectAuthoredCue(cue:CueSpec, startSec:number, endSec:number, segments:CuePoint['segments']):CuePoint {
  return {id:cue.id,label:cue.label,startSec,endSec,text:cue.segments.filter(segment=>segment.kind==='text').map(segment=>segment.text).join(' ').trim(),bullets:cue.bullets.map(makeBullet),markup:cue.markup,segments};
}
/** The generator's authored scene projection, with timing supplied by generation. */
export function projectAuthoredScene(scene:SceneSpec, startSec:number, endSec:number, cues:CuePoint[]):Scene {
  const layers=scene.layers?.map(layer=>({...layer,components:layer.components.map(component=>({...component,props:{...(component.props||{}),sceneStartSec:startSec}}))}));
  return {id:scene.id,title:scene.title,startSec,endSec,cues,markup:scene.markup,styles:scene.styles,layers,components:scene.components,enter:scene.enter,exit:scene.exit,transitionToNext:scene.transitionToNext};
}

/** Authored transition fields; generation determines temporal and neighboring-scene values. */
export function projectAuthoredTransition(transition:Pick<TransitionSpec,'id'|'effect'|'ease'|'props'|'overflow'|'overflowAudio'|'styles'|'markup'|'layers'|'components'>, startSec:number, endSec:number, mode:TransitionSpec['mode'], fromSceneId?:string, toSceneId?:string):TransitionTimelineItem {
  return {kind:'transition',id:transition.id,startSec,endSec,effect:transition.effect,ease:transition.ease,props:transition.props,mode,overflow:transition.overflow,overflowAudio:transition.overflowAudio,fromSceneId,toSceneId,styles:transition.styles,markup:transition.markup,layers:transition.layers,components:transition.components};
}

/** Generation-time transition duration, including optional audio overflow. */
export function transitionDuration(transition:TransitionSpec):number {
 let maxAudioEnd=0;
 if(transition.overflowAudio==='extend'&&transition.audio?.length)for(const audio of transition.audio){const offset=audio.time?.start??0;let duration=audio.durationSeconds??null;if(duration==null&&audio.time?.start!=null&&audio.time?.end!=null)duration=Math.max(0,audio.time.end-audio.time.start);if(duration!=null)maxAudioEnd=Math.max(maxAudioEnd,offset+duration);}
 if(transition.time?.start!=null&&transition.time?.end!=null)return Math.max(0,transition.time.end-transition.time.start);
 return Math.max(transition.durationSeconds??1,maxAudioEnd);
}
export function transitionTiming(transition:TransitionSpec,previous:Pick<Scene,'endSec'>|undefined,next:Pick<Scene,'startSec'>|undefined){
 const duration=transitionDuration(transition),mode=transition.mode??(previous&&next?'overlap':'insert');
 const startSec=transition.time?.start!=null?transition.time.start:mode==='overlap'&&previous?Math.max(0,previous.endSec-duration):previous?.endSec??0;
 return {mode,startSec,endSec:transition.time?.end??startSec+duration};
}
