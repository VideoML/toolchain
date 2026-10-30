declare const SCENE_KIND:string;
(window as any).mountVideoMLScene=async (root:HTMLElement,config:{width:number;height:number;selectedSceneVisible:boolean;fps:number;seed:number;captureSceneId:string;assets:{accent:string}})=>{
 if(config.fps!==24||config.seed!==71||config.assets.accent!=='fixture'||config.captureSceneId!==(SCENE_KIND==='html'?'scene-a':'scene-b'))throw new Error('Incorrect scene context');
 if(!config.selectedSceneVisible) throw new Error('Selected scene must be visible');
 root.style.cssText=`width:${config.width}px;height:${config.height}px;position:relative;overflow:hidden;background:${SCENE_KIND==='html'?'#122340':'#201238'}`;
 const canvas=document.createElement('canvas');canvas.width=config.width;canvas.height=config.height;root.append(canvas);
 let label:HTMLElement|undefined;
 if(SCENE_KIND==='html') {label=document.createElement('div');label.textContent='HTML + canvas • scene A';label.style.cssText='position:absolute;top:36px;color:white;font:32px sans-serif';root.append(label);}
 const ctx=SCENE_KIND==='html'?canvas.getContext('2d'):null;
 const gl=SCENE_KIND==='webgl'?canvas.getContext('webgl',{preserveDrawingBuffer:true}):null;
 if(SCENE_KIND==='webgl'&&!gl)throw new Error('WebGL scene unavailable');
 await document.fonts.ready;
 return {async seek(frame:number){if(label)label.style.left=`${20+(frame*3+config.seed)%130}px`;if(ctx){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#42d6c6';ctx.fillRect(20+(frame*4+config.seed)%160,110,90,70);}if(gl){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.12,.05,.22,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(30+(frame*4+config.seed)%160,80,110,90);gl.clearColor(.94,.34,.22,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.SCISSOR_TEST);}},dispose(){root.replaceChildren();}};
};
