import type {CompositionSpec} from '../dsl/types.js';
import {selectComposition} from './selection.js';
/** Select one composition from an already data-validated trusted source result. */
export function selectSourceValue(value:unknown,selector?:string):CompositionSpec {const doc=Array.isArray(value)?{compositions:value}:value&&typeof value==='object'&&Array.isArray((value as any).compositions)?value:{compositions:[value]};return selectComposition(doc as {compositions:CompositionSpec[]},selector);}
