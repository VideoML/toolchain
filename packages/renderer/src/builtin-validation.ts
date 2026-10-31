import {createBuiltinEffectRegistry} from '@videoml/stdlib/effects/xml';
import {shaderNames,validateTransitionOptions} from '@videoml/stdlib/effects/transitions';
/** Validate only the fixed built-in registry; this creates no DOM or effect mount. */
export function validateBuiltinEffect(id:string,version:string,parameters:Record<string,unknown>):void {createBuiltinEffectRegistry().create({id,version,parameters,startFrame:0,endFrame:0});}
export function validateBuiltinTransition(id:string,parameters:unknown):void {if(!shaderNames.includes(id as any))throw new Error('TRANSITION_INVALID: unknown shader');validateTransitionOptions(parameters);}
