export function registerEffects(registry:any) {
  registry.register({schemaVersion:1,id:'custom/snapshot',version:'1',parametersSchema:{type:'object',required:['sourceSceneId','sourceFrame'],additionalProperties:false,properties:{sourceSceneId:{type:'string',minLength:1},sourceFrame:{type:'integer',minimum:0}}},sceneInputs:[{sceneIdParameter:'sourceSceneId',frameParameter:'sourceFrame'}]},()=>true,(parameters:any)=>{
    const abort=new AbortController();let handle:any;
    return {
      async mount(root:HTMLElement,context:any){
        if(!context.sceneSnapshots)throw new Error('SCENE_CAPTURE_UNAVAILABLE');
        handle=await context.sceneSnapshots.capture({sceneId:parameters.sourceSceneId,frame:parameters.sourceFrame,signal:abort.signal});
        const canvas=document.createElement('canvas');canvas.width=context.width;canvas.height=context.height;
        canvas.getContext('2d')!.drawImage(handle.bitmap,0,0);root.append(canvas);
      },
      async seek(){},cancel(){abort.abort()},dispose(){abort.abort();handle?.close();handle=undefined;},
    };
  });
}
