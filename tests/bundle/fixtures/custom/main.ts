import {pause} from '@videoml/toolchain/dsl';
import {gsap} from 'gsap';
const title=`Custom ${gsap.utils.clamp(0,10,7)}`;
export default {id:'custom-demo',meta:{width:320,height:240,fps:30},timeline:[
 {id:'a',title,time:{start:0,end:1},items:[pause(0)],components:[{id:'shape-a',type:'P17Canvas',props:{accent:'#f08030'}}]},
 {kind:'transition',id:'warp',effect:'domain-warp',durationSeconds:0.3},
 {id:'b',title:'Second',time:{start:1,end:2},items:[pause(0)],components:[{id:'shape-b',type:'P17Canvas',props:{accent:'#30b0e0'}}]}
]};
