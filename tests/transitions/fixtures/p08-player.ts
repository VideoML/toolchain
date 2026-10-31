import {createVmlPlayerController} from '../../../../player/src/runtime';
(window as any).checkP08Player=async (effect:string,defaultDuration=false)=>{
 const root=document.createElement('div');document.body.append(root);let disposals=0;
 const xml=`<vml id="p08" fps="30" width="64" height="64"><scene id="a" duration="2s"><div>first</div></scene><transition id="t" effect="${effect}" ${defaultDuration ? "" : 'duration="1s"'}/><scene id="b" duration="2s"><div>second</div></scene></vml>`;
 const factory=(id:string)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d')!;return {seek(frame:number){ctx.fillStyle=id==='a'?'#224466':'#88aa66';ctx.fillRect(0,0,64,64);ctx.fillStyle='#fff';ctx.fillRect(frame%32,10,8,8);},async capture(){return canvas;},dispose(){disposals++;}}};
 try {const player=createVmlPlayerController(root,{xml,autoPlay:false,transitionSourceFactory:factory});const values:string[]=[];for(const frame of [30,45,59,45,31]){await player.seek(frame);const canvas=root.querySelector('transition canvas') as HTMLCanvasElement;if(!canvas)throw Error('missing canvas');values.push(canvas.toDataURL());}player.dispose();return {values,disposals};} finally{root.remove();}
};
(window as any).checkP08PlayerErrors=()=>{
 const root=document.createElement('div');document.body.append(root);
 const xml=(attributes:string)=>`<vml id="errors" fps="30" width="64" height="64"><scene id="a" duration="2s"/><transition id="t" effect="domain-warp" duration="1s" ${attributes}/><scene id="b" duration="2s"/></vml>`;
 const source=()=>({seek(){},async capture(){const canvas=document.createElement('canvas');canvas.width=canvas.height=64;return canvas;},dispose(){}});
 const result:string[]=[];for(const [attrs,factory] of [['',undefined],['ease="not-real"',source],['props=\'{"accent":[2,0,0]}\'',source]] as const){try{const p=createVmlPlayerController(root,{xml:xml(attrs),autoPlay:false,transitionSourceFactory:factory});p.dispose();result.push('accepted');}catch(error){result.push(`${(error as any)?.code ?? ""} ${String(error)}`);}}root.remove();return result;
};
(window as any).checkP08Autoplay=async()=>{
 const root=document.createElement('div');document.body.append(root);
 const xml='<vml id="auto" fps="30" width="64" height="64"><scene id="a" duration="1s"/><transition id="t" effect="domain-warp" duration="1s"/><scene id="b" duration="2s"/></vml>';
 let seeks=0;const factory=(id:string)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d')!;return {seek(frame:number){seeks++;ctx.fillStyle=id==='a'?'red':'blue';ctx.fillRect(0,0,64,64);ctx.fillStyle='white';ctx.fillRect(frame%32,0,4,4);},async capture(){return canvas;},dispose(){}};};
 const player=createVmlPlayerController(root,{xml,autoPlay:true,transitionSourceFactory:factory});await new Promise(resolve=>setTimeout(resolve,200));const count=seeks;player.pause();await new Promise(resolve=>setTimeout(resolve,100));const paused=seeks;player.dispose();root.remove();return {count,paused};
};
(window as any).checkP08Insert=async()=>{
 const root=document.createElement('div');document.body.append(root);const xml='<vml id="insert" fps="30" width="64" height="64"><scene id="a" duration="2s"/><transition id="t" effect="domain-warp" mode="insert" duration="1s"/><scene id="b" duration="2s"/></vml>';const factory=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;return {seek(){},async capture(){return canvas;},dispose(){}};};const player=createVmlPlayerController(root,{xml,autoPlay:false,transitionSourceFactory:factory});const states=[];for(const frame of [59,75,90,149]){await player.seek(frame);states.push([...root.querySelectorAll('scene')].map(e=>getComputedStyle(e).display));}player.dispose();root.remove();return states;
};
(window as any).checkP08Solid=async (effect:string)=>{
 const root=document.createElement('div');document.body.append(root);const xml=`<vml id="solid" fps="30" width="64" height="64"><scene id="from" duration="2s"/><transition id="transition" effect="${effect}" duration="1s"/><scene id="to" duration="2s"/></vml>`;const factory=(id:string)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d')!;return {seek(){ctx.fillStyle=id==='from'?'#224466':'#88aa66';ctx.fillRect(0,0,64,64);},async capture(){return canvas;},dispose(){}};};const player=createVmlPlayerController(root,{xml,autoPlay:false,transitionSourceFactory:factory});await player.seek(45);const image=(root.querySelector('transition canvas') as HTMLCanvasElement).toDataURL();player.dispose();root.remove();return image;
};
