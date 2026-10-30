import {mountPlayerCaptureScene} from '../../../../player/src/transitions';
const xml=`<vml id="sample" fps="24" width="320" height="240"><scene id="scene-a" start="0s" duration="1s"><div style="background:#126789;color:white">First scene</div></scene><scene id="scene-b" start="1s" duration="1s"><div style="background:#b75020;color:white">Second scene</div></scene></vml>`;
(window as any).mountVideoMLScene=(root:HTMLElement,config:any)=>mountPlayerCaptureScene(root,{xml,captureSceneId:config.captureSceneId,autoPlay:false,clockMode:'bounded'});
