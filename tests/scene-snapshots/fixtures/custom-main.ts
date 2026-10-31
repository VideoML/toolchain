import {pause} from '@videoml/toolchain/dsl';
export default {
  id:'custom-snapshot-demo',
  meta:{width:320,height:240,fps:30},
  timeline:[
    {id:'sink',title:'Sink',time:{start:0,end:1},items:[pause(0)],components:[{id:'snapshot',type:'FrameEffect',props:{effectId:'custom/snapshot',effectVersion:'1',parameters:{sourceSceneId:'source',sourceFrame:45}}}]},
    {id:'source',title:'Authored source',time:{start:1,end:2},items:[pause(0)],components:[{id:'bg',type:'Background',props:{color:'#1860a0'}},{id:'title',type:'VideoTitle',props:{text:'Authored TS',fontSize:20,color:'#111111',position:{x:20,y:20}}}]},
  ],
};
