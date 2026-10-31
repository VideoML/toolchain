import {mountCapturedSceneCompositor} from '@videoml/stdlib/effects/transitions';
import gsapModule from 'gsap';
(window as any).mountVideoMLTransition=(_root:HTMLElement,config:any)=>{
 const gsap=(gsapModule as any).gsap ?? gsapModule;
 if(config.easeName&&!/^[A-Za-z][A-Za-z0-9]*(?:\.(?:in|out|inOut))?$/.test(config.easeName))throw new Error(`TRANSITION_INVALID: unknown easing ${config.easeName}`);
 const ease=config.easeName?gsap.parseEase(config.easeName):undefined;
 if(config.easeName&&typeof ease!=='function')throw new Error(`TRANSITION_INVALID: unknown easing ${config.easeName}`);
 return mountCapturedSceneCompositor(_root,{...config,ease});
};
