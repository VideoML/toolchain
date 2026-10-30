import { normalizeSourceTree, normalizedSourceIds, type SourceNode } from '@videoml/shared/resolved-timing';
import type { CompositionSpec, ComponentSpec, LayerSpec, TimelineItemSpec } from './types.js';

/** Raw TS compositions are normalized once; XML compositions arrive pre-normalized before flattening. */
export function normalizeCompositionIds(source: CompositionSpec): CompositionSpec {
  if ((source as any)[normalizedSourceIds]) return source;
  const component = (value: ComponentSpec) => ({...value});
  const layer = (value: LayerSpec) => ({...value, components: value.components.map(component)});
  const timeline: TimelineItemSpec[] = source.timeline.map(item => {
    if ('kind' in item && item.kind !== 'transition') {
      if (item.kind === 'narration') return {...item, items:item.items.map(entry=>({...entry}))};
      return {...item};
    }
    if ('kind' in item) return {...item, layers:item.layers?.map(layer), components:item.components?.map(component)};
    return {...item, items:item.items.map(entry=>({...entry})), layers:item.layers?.map(layer), components:item.components?.map(component)};
  });
  const result: CompositionSpec = {...source,timeline};
  const refs: Array<{id?:string}> = [];
  const make = (kind:SourceNode['kind'], value:{id?:string}, children:Array<() => SourceNode> = []): SourceNode => {
    refs.push(value); return {kind,id:value.id,children:children.map(child=>child())};
  };
  const tree = make('root',result,timeline.filter(item=>!('kind' in item) || item.kind !== 'mark').map(item=>()=>{
    const kind = !('kind' in item) ? 'scene' : item.kind;
    const visual = item as {id:string; layers?:LayerSpec[]; components?:ComponentSpec[]; items?:Array<{id?:string; kind:string}>};
    const makers:Array<()=>SourceNode> = [];
    for(const entry of visual.items ?? []) if(entry.kind==='cue') makers.push(()=>make('cue',entry));
    for(const l of visual.layers ?? []) makers.push(()=>make('layer',l,l.components.map(c=>()=>make('component',c))));
    for(const c of visual.components ?? []) makers.push(()=>make('component',c));
    return make(kind as SourceNode['kind'],visual,makers);
  }));
  const normalized=normalizeSourceTree(tree);let cursor=0;
  const apply=(item: typeof normalized) => {const target=refs[cursor++];if(item.generated) target.id=item.id;item.children.forEach(apply);};
  apply(normalized);Object.defineProperty(result,normalizedSourceIds,{value:true});return result;
}
