import {createVmlPlayerController,createVerifiedVmlPlayerController} from '../../../player/src/runtime.ts';
(window as any).startFrozen=(xml:string,timing:any)=>createVerifiedVmlPlayerController(document.getElementById('root')!,{xml,resolvedTiming:timing,autoPlay:false},async()=>{throw Error('unexpected audio')});
(window as any).startPlayer=(xml:string,options:any={})=>createVmlPlayerController(document.getElementById('root')!,{xml,autoPlay:false,...options});
