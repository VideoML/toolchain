import React, { useLayoutEffect, useRef } from 'react';
import { createVmlPlayerController, mountVmlPlayer } from '../../../player/src/runtime.js';
import { createEffectRegistry, mountEffect } from '../../../stdlib/src/effects/index.js';
import { createReactEffect } from '../../packages/renderer/src/effects.js';
import { useCurrentFrame } from '../../packages/renderer/src/context.js';
(window as any).runPlayerReactChecks=async()=>{
 const host=document.createElement('div');document.body.append(host);
 const xml=`<vml id="test" fps="30"><scene id="a" start="0s" end="1s"><div id="clicker" on:click="target.dataset.clicked = 'yes'"></div></scene><scene id="b" start="1s" end="2s"></scene></vml>`;
 const player=createVmlPlayerController(host,{xml,autoPlay:false});
 for (const frame of [0,45,1,1,59]) { await player.seek(frame); const root=host.querySelector('vml') as HTMLElement; if(root.style.getPropertyValue('--video-frame')!==String(frame)) throw Error(`seek ${frame}`); }
 const clicker=host.querySelector('#clicker') as HTMLElement; clicker.click();if(clicker.dataset.clicked!=='yes')throw Error('handler did not bind');
 player.pause();player.dispose();player.dispose();delete clicker.dataset.clicked;clicker.click();if(clicker.dataset.clicked)throw Error('inline handler leaked');
 try {await player.seek(0);throw Error('disposed seek accepted')} catch(e:any){if(!String(e.message).includes('disposed'))throw e;}
 let releaseFirst!:()=>void, firstStarted!:()=>void;
 const started=new Promise<void>(resolve=>firstStarted=resolve);
 const blocked=new Promise<void>(resolve=>releaseFirst=resolve);
 const concurrent=createVmlPlayerController(host,{xml,autoPlay:true,settleFrame:async frame=>{if(frame===4){firstStarted();await blocked;}}});
 const first=concurrent.seek(4);await started;const second=concurrent.seek(8);releaseFirst();await Promise.all([first,second]);
 const pausedRoot=host.querySelector('vml') as HTMLElement;
 if(pausedRoot.style.getPropertyValue('--video-frame')!=='8')throw Error('concurrent seeks ended at wrong frame');
 await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 if(pausedRoot.style.getPropertyValue('--video-frame')!=='8')throw Error('seek did not stop timeline');
 concurrent.dispose();
 let releaseAfterDispose!:()=>void, disposeStarted!:()=>void;
 const startedDispose=new Promise<void>(resolve=>disposeStarted=resolve), blockDispose=new Promise<void>(resolve=>releaseAfterDispose=resolve);
 const pendingPlayer=createVmlPlayerController(host,{xml,autoPlay:false,settleFrame:async()=>{disposeStarted();await blockDispose;}});
 const pending=pendingPlayer.seek(1);await startedDispose;pendingPlayer.dispose();releaseAfterDispose();
 try {await pending;throw Error('pending seek survived dispose')} catch(e:any){if(!String(e.message).includes('disposed'))throw e;}
 const hostA=document.createElement('div'),hostB=document.createElement('div');document.body.append(hostA,hostB);
 let releaseGroup!:()=>void, startedGroup!:()=>void;
 const groupBlocked=new Promise<void>(resolve=>releaseGroup=resolve), groupStarted=new Promise<void>(resolve=>startedGroup=resolve);
 let releaseOther!:()=>void, otherStarted!:()=>void;
 const otherBlocked=new Promise<void>(resolve=>releaseOther=resolve), otherStart=new Promise<void>(resolve=>otherStarted=resolve);
 let releaseQueued!:()=>void, queuedStarted!:()=>void;
 const queuedBlocked=new Promise<void>(resolve=>releaseQueued=resolve), queuedStart=new Promise<void>(resolve=>queuedStarted=resolve);
 let releaseDisposed!:()=>void, disposedStarted!:()=>void;
 const disposedBlocked=new Promise<void>(resolve=>releaseDisposed=resolve), disposedStart=new Promise<void>(resolve=>disposedStarted=resolve);
 const groupA=createVmlPlayerController(hostA,{xml,autoPlay:false,syncGroup:'p04-test-group',settleFrame:async frame=>{if(frame===4){startedGroup();await groupBlocked;}if(frame===18){queuedStarted();await queuedBlocked;}}});
 const groupB=createVmlPlayerController(hostB,{xml,autoPlay:false,syncGroup:'p04-test-group',settleFrame:async frame=>{if(frame===4){otherStarted();await otherBlocked;}if(frame===12){disposedStarted();await disposedBlocked;}}});
 const readFrame=(root:HTMLElement)=>(root.querySelector('vml') as HTMLElement).style.getPropertyValue('--video-frame');
 const seekA=groupA.seek(4);await Promise.all([groupStarted,otherStart]);
 let firstCompleted=false;
 const observedA=seekA.then(()=>{firstCompleted=true;if(readFrame(hostA)!=='4'||readFrame(hostB)!=='4')throw Error('first group seek completed at wrong frame');});
 const seekB=groupB.seek(8).then(()=>{if(readFrame(hostA)!=='8'||readFrame(hostB)!=='8')throw Error('second group seek completed at wrong frame');});
 releaseGroup();await Promise.resolve();await Promise.resolve();if(firstCompleted)throw Error('group seek did not wait for other participant');releaseOther();await Promise.all([observedA,seekB]);
 const dying=groupB.seek(12);await disposedStart;groupB.dispose();
 try {await dying;throw Error('disposed initiator completed')} catch(e:any){if(!String(e.message).includes('disposed'))throw e;}
 await groupA.seek(15);if(readFrame(hostA)!=='15')throw Error('surviving group member failed');releaseDisposed();
 const groupC=createVmlPlayerController(hostB,{xml,autoPlay:false,syncGroup:'p04-test-group'});
 const blocking=groupA.seek(18);await queuedStart;const queued=groupC.seek(22).then(()=>{throw Error('disposed queued initiator completed')},(e:any)=>{if(!String(e.message).includes('disposed'))throw e;});groupC.dispose();releaseQueued();await blocking;await queued;
 await groupA.seek(20);if(readFrame(hostA)!=='20')throw Error('survivor failed after queued dispose');groupA.dispose();hostA.remove();hostB.remove();
 const cleanup=mountVmlPlayer(host,{xml,autoPlay:false});if(typeof cleanup!=='function')throw Error('legacy cleanup missing');cleanup();
 let unmount=0;let resolveCanvas!:()=>void;let canvasReady:Promise<void>;
 function Canvas() {const ref=useRef<HTMLCanvasElement>(null);const frame=useCurrentFrame();useLayoutEffect(()=>{requestAnimationFrame(()=>{const c=ref.current!.getContext('2d')!;c.fillStyle='#ff0000';c.fillRect(frame,0,1,1);resolveCanvas();});return()=>{unmount++}},[frame]);return <canvas width={64} height={64} ref={ref}/>;}
 const registry=createEffectRegistry();registry.register({schemaVersion:1,id:'react',version:'1',parametersSchema:{type:'object'}},()=>true,()=>createReactEffect(Canvas,{},60,{settleFrame:()=>canvasReady}));
 const c=mountEffect(host,registry,{id:'react',version:'1',parameters:{},startFrame:0,endFrame:60},{width:64,height:64,fps:30,seed:0,assets:{}});
 canvasReady=new Promise<void>(resolve=>resolveCanvas=resolve);
 await c.seek(4);const pixel=host.querySelector('canvas')!.getContext('2d')!.getImageData(4,0,1,1).data;if(pixel[0]!==255||pixel[3]!==255)throw Error('delayed React canvas not rendered');
 c.dispose();if(host.childNodes.length || !unmount)throw Error('React cleanup failed'); host.remove();return {unmount};
};
