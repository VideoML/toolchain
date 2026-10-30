/** Stable, unambiguous qualified IDs. Original source IDs are never rewritten. */
export function qualifiedTimingId(kind: string, path: Array<string | number>): string {
  if (!/^(scene|cue|layer|component|transition|segment|transition-layer|transition-component)$/.test(kind) || !path.length || path.some((id, index) => typeof id === 'number' ? kind !== 'segment' || index !== path.length - 1 || !Number.isSafeInteger(id) || id < 0 : typeof id !== 'string' || !id)) throw new Error('Invalid timing ID');
  return `${kind}:${JSON.stringify(path)}`;
}
export type FrozenInterval = {id: string; startFrame: number; endFrame: number};
export type FrozenSegment = FrozenInterval & {
  cueId: string; track: string; originalText: string; expandedText: string; startSample: number; endSample: number;
  trimSamples: number; pauseSamples: number; audioPath: string; audioSha256: string; pcmSha256: string;
  provenance: Record<string, unknown>;
};
export type ResolvedTiming = {
  schemaVersion: 1; fps: number; sampleRateHz: number; durationFrames: number;
  generationSeed: number; leadInSamples: number; audioTotalSamples: number; scenes: FrozenInterval[]; cues: FrozenInterval[];
  layers: FrozenInterval[]; components: FrozenInterval[]; transitions: FrozenInterval[]; segments: FrozenSegment[];
};
/** Structural and cross-field validation; callers must additionally verify audio bytes. */
export function validateResolvedTiming(input: unknown): asserts input is ResolvedTiming {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid resolved timing');
  const t = input as ResolvedTiming;
  const exactKeys = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const sha = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  const extensionMap = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, item]) => /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(key) && !!item && typeof item === 'object' && !Array.isArray(item));
  if (!exactKeys(t, ['schemaVersion','fps','sampleRateHz','durationFrames','generationSeed','leadInSamples','audioTotalSamples','scenes','cues','layers','components','transitions','segments'])) throw new Error('Unknown or missing resolved timing fields');
  if (t.schemaVersion !== 1 || !Number.isFinite(t.fps) || t.fps <= 0 || !Number.isSafeInteger(t.sampleRateHz) || t.sampleRateHz <= 0 || !Number.isSafeInteger(t.durationFrames) || t.durationFrames < 0 || !Number.isSafeInteger(t.generationSeed) || t.generationSeed < 0 || t.generationSeed > 0xffffffff || !Number.isSafeInteger(t.leadInSamples) || t.leadInSamples < 0 || !Number.isSafeInteger(t.audioTotalSamples) || t.audioTotalSamples < t.leadInSamples) throw new Error('Invalid resolved timing header');
  if (Math.ceil(t.audioTotalSamples / t.sampleRateHz * t.fps) > t.durationFrames) throw new Error('Resolved duration does not cover composition audio');
  const kinds = ['scenes','cues','layers','components','transitions','segments'] as const;
  const names = ['scene','cue','layer','component','transition','segment'];
  const ids = new Set<string>();
  for (const [i, kind] of kinds.entries()) {
    if (!Array.isArray(t[kind])) throw new Error(`Missing resolved ${kind}`);
    for (const entry of t[kind]) {
      const expectedKeys = kind === 'segments' ? ['id','cueId','track','originalText','expandedText','startSample','endSample','startFrame','endFrame','trimSamples','pauseSamples','audioPath','audioSha256','pcmSha256','provenance'] : ['id','startFrame','endFrame'];
      if (!exactKeys(entry, expectedKeys)) throw new Error('Unknown or missing resolved interval fields');
      const actualKind = kind === 'layers' && entry.id?.startsWith('transition-layer:') ? 'transition-layer' : kind === 'components' && entry.id?.startsWith('transition-component:') ? 'transition-component' : names[i];
      const prefix = actualKind + ':';
      if (!entry || typeof entry.id !== 'string' || !entry.id.startsWith(prefix) || ids.has(entry.id)) throw new Error('Invalid or duplicate resolved ID');
      let path: unknown;
      try {path = JSON.parse(entry.id.slice(prefix.length));} catch {throw new Error('Invalid resolved ID encoding');}
      if (!Array.isArray(path) || qualifiedTimingId(actualKind, path) !== entry.id) throw new Error('Invalid resolved ID encoding');
      const validArity = kind === 'layers' ? path.length === 2 : kind === 'components' ? path.length === 2 || path.length === 3 : kind === 'segments' ? path.length === 2 && typeof path[1] === 'number' : path.length === 1;
      if (!validArity) throw new Error('Invalid resolved ID path');
      if (!Number.isSafeInteger(entry.startFrame) || !Number.isSafeInteger(entry.endFrame) || entry.startFrame < 0 || entry.endFrame < entry.startFrame || entry.endFrame > t.durationFrames) throw new Error('Invalid resolved frame interval');
      ids.add(entry.id);
    }
  }
  const cueIds = new Set(t.cues.map(c => c.id));
  const byTrack = new Map<string, FrozenSegment[]>();
  for (const segment of t.segments) {
    const provenance = segment.provenance;
    const common = ['provider','simulated','audioSha256','pcmSha256','extensions'];
    const auritus = ['backend','modelId','modelRevision','auritusVersion','voice','speed','seed','referenceAudioSha256','referenceTranscriptSha256','cacheDisabledReason','requestKey','contentHash'];
    if (!provenance || typeof provenance !== 'object') throw new Error('Missing resolved provenance');
    const provider = provenance.provider;
    if (typeof provider !== 'string' || !provider || !exactKeys(provenance, provider === 'auritus' ? [...common,...auritus] : common) || !extensionMap(provenance.extensions) || provenance.audioSha256 !== segment.audioSha256 || provenance.pcmSha256 !== segment.pcmSha256 || provenance.simulated !== (provider === 'dry-run')) throw new Error('Invalid resolved provenance');
    if (provider === 'auritus') {
      if (!['backend','modelId','auritusVersion','voice'].every(key => typeof provenance[key] === 'string' && !!provenance[key]) || !(provenance.modelRevision === null || typeof provenance.modelRevision === 'string' && !!provenance.modelRevision) || !(provenance.cacheDisabledReason === null || typeof provenance.cacheDisabledReason === 'string' && !!provenance.cacheDisabledReason) || (provenance.modelRevision === null && !provenance.cacheDisabledReason) || typeof provenance.speed !== 'number' || !Number.isFinite(provenance.speed) || provenance.speed <= 0 || !Number.isSafeInteger(provenance.seed) || Number(provenance.seed) < 0 || Number(provenance.seed) > 0xffffffff || !sha(provenance.requestKey) || !(provenance.contentHash === null || sha(provenance.contentHash)) || ![provenance.referenceAudioSha256,provenance.referenceTranscriptSha256].every(value => value === null || sha(value))) throw new Error('Invalid Auritus provenance');
    }
    if (typeof segment.originalText !== 'string' || !segment.originalText || typeof segment.expandedText !== 'string' || !segment.expandedText || !Number.isSafeInteger(segment.trimSamples) || segment.trimSamples < 0 || !Number.isSafeInteger(segment.pauseSamples) || segment.pauseSamples < 0) throw new Error('Invalid segment text or sample counts');
    const safePath = typeof segment.audioPath === 'string' && segment.audioPath.length > 0 && !segment.audioPath.startsWith('/') && !segment.audioPath.includes('\\') && !segment.audioPath.split('/').some(x => !x || x === '.' || x === '..') && !/^[A-Za-z]:/.test(segment.audioPath);
    const segmentPath = JSON.parse(segment.id.slice('segment:'.length));
    const cuePath = typeof segment.cueId === 'string' && segment.cueId.startsWith('cue:') ? JSON.parse(segment.cueId.slice('cue:'.length)) : [];
    if (!Array.isArray(cuePath) || segmentPath[0] !== cuePath[0]) throw new Error('Segment cue identity mismatch');
    if (!cueIds.has(segment.cueId) || !segment.track || !safePath || !/^[0-9a-f]{64}$/.test(segment.audioSha256) || !/^[0-9a-f]{64}$/.test(segment.pcmSha256) || !Number.isSafeInteger(segment.startSample) || !Number.isSafeInteger(segment.endSample) || segment.startSample < 0 || segment.endSample < segment.startSample) throw new Error('Invalid resolved segment');
    const start = Math.floor(segment.startSample / t.sampleRateHz * t.fps);
    const end = segment.startSample === segment.endSample ? start : Math.ceil(segment.endSample / t.sampleRateHz * t.fps);
    if (segment.endSample + segment.pauseSamples > t.audioTotalSamples) throw new Error('Segment extends beyond composition audio');
    if (segment.startFrame !== start || segment.endFrame !== end) throw new Error('Resolved sample/frame mismatch');
    const track = byTrack.get(segment.track) ?? [];
    if (track.some(other => segment.startSample < other.endSample && other.startSample < segment.endSample)) throw new Error('Overlapping narration on the same voice track');
    track.push(segment); byTrack.set(segment.track, track);
  }
}

/** Verify frozen segment and assembled composition bytes before playback or export. */
export async function verifyResolvedAudio(timing: ResolvedTiming, load: (path: string) => Promise<ArrayBuffer>, loadComposition?: () => Promise<ArrayBuffer>): Promise<ArrayBuffer | null> {
  validateResolvedTiming(timing);
  const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
  const hash = async (bytes: Uint8Array) => hex(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
  const decode = (buffer: ArrayBuffer): {data: Uint8Array; pcm: Uint8Array} => {
    const data = new Uint8Array(buffer), view = new DataView(buffer);
    const tag = (offset: number) => String.fromCharCode(...data.slice(offset, offset + 4));
    if (data.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Invalid WAV');
    if (view.getUint32(4,true)+8 !== data.length) throw new Error('Invalid WAV RIFF length');
    let offset=12, pcm: Uint8Array | undefined, sampleRate=0, format=0, channels=0, bits=0, hasFormat=false;
    while (offset < data.length) {
      if (offset+8>data.length) throw new Error('Truncated WAV chunk header');
      const id=tag(offset), size=view.getUint32(offset+4,true), start=offset+8;
      if (start+size+size%2>data.length) throw new Error('Truncated WAV');
      if (id==='fmt ') {
        if (hasFormat || size<16) throw new Error('Invalid WAV format');
        hasFormat=true;
        format=view.getUint16(start,true); channels=view.getUint16(start+2,true);
        sampleRate=view.getUint32(start+4,true); bits=view.getUint16(start+14,true);
        if (view.getUint16(start+12,true)!==2 || view.getUint32(start+8,true)!==sampleRate*2) throw new Error('Invalid WAV PCM rate');
      } else if (id==='data') { if (!hasFormat || pcm) throw new Error('Duplicate or unordered WAV data'); pcm=data.slice(start,start+size); }
      offset=start+size+size%2;
    }
    if (!pcm || format!==1 || channels!==1 || bits!==16 || sampleRate!==timing.sampleRateHz || pcm.length%2) throw new Error('Invalid WAV PCM');
    return {data,pcm};
  };
  const samples = new Map<string, Uint8Array>();
  for (const segment of timing.segments) {
    const {data,pcm}=decode(await load(segment.audioPath));
    if (pcm.length/2 !== segment.endSample-segment.startSample || await hash(data)!==segment.audioSha256 || await hash(pcm)!==segment.pcmSha256) throw new Error(`Resolved audio integrity mismatch: ${segment.audioPath}`);
    samples.set(segment.id,pcm);
  }
  if (timing.audioTotalSamples === 0) return null;
  if (!loadComposition) throw new Error('Frozen timing requires composition audio verification');
  const {pcm}=decode(await loadComposition());
  if (pcm.length/2 !== timing.audioTotalSamples) throw new Error('Composition audio duration differs from frozen timing');
  let cursor=0;
  for (const segment of [...timing.segments].sort((a,b)=>a.startSample-b.startSample)) {
    const start=segment.startSample*2,end=segment.endSample*2, expected=samples.get(segment.id)!;
    if (start<cursor) throw new Error('Overlapping tracks are not supported by frozen audio verification');
    for (let i=cursor;i<start;i++) if (pcm[i]!==0) throw new Error('Composition audio differs from frozen silence');
    for (let i=start;i<end;i++) if (pcm[i]!==expected[i-start]) throw new Error('Composition audio differs from frozen segment');
    cursor=end;
  }
  for (let i=cursor;i<pcm.length;i++) if (pcm[i]!==0) throw new Error('Composition audio differs from frozen silence');
  const canonical = new Uint8Array(44 + pcm.length), view = new DataView(canonical.buffer);
  const tag = (at: number, value: string) => { for (let i=0;i<value.length;i++) canonical[at+i]=value.charCodeAt(i); };
  tag(0,'RIFF'); view.setUint32(4,36+pcm.length,true); tag(8,'WAVEfmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,timing.sampleRateHz,true); view.setUint32(28,timing.sampleRateHz*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); tag(36,'data'); view.setUint32(40,pcm.length,true); canonical.set(pcm,44);
  return canonical.buffer;
}

/** Apply frozen frame intervals to a script; source IDs must match exactly. */
export function applyResolvedTimingToScript<T extends Record<string, any>>(source: T, timing: ResolvedTiming, timeline?: {items?: Array<Record<string, unknown>>; sourceCueOrder?: string[]} | null): T {
  validateResolvedTiming(timing);
  const script: Record<string, any> = structuredClone(source);
  const lookup = new Map([...timing.scenes, ...timing.cues, ...timing.layers, ...timing.components, ...timing.transitions].map(x => [x.id, x]));
  const seen = new Set<string>();
  const ordered = new Map<string, string[]>();
  const interval = (kind: string, path: string[]) => {
    const id = qualifiedTimingId(kind, path), value = lookup.get(id);
    if (!value || seen.has(id)) throw new Error(`Missing or duplicate frozen interval: ${id}`);
    seen.add(id);
    const category = kind === 'transition-layer' ? 'layer' : kind === 'transition-component' ? 'component' : kind;
    const values = ordered.get(category) ?? []; values.push(id); ordered.set(category, values);
    return {startSec: value.startFrame / timing.fps, endSec: value.endFrame / timing.fps};
  };
  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  for (const scene of scenes) {
    Object.assign(scene, interval('scene', [scene.id]));
    for (const cue of scene.cues ?? []) Object.assign(cue, interval('cue', [cue.id]));
    for (const layer of scene.layers ?? []) {
      layer.timing = interval('layer', [scene.id, layer.id]);
      for (const component of layer.components ?? []) component.timing = interval('component', [scene.id, layer.id, component.id]);
    }
    for (const component of scene.components ?? []) component.timing = interval('component', [scene.id, component.id]);
  }
  // Narration cues need not occur in a visual scene, but must occur in the generated timeline.
  for (const item of timeline?.items ?? []) {
    if (item.type !== 'tts' || typeof item.cueId !== 'string') continue;
    const id = qualifiedTimingId('cue', [item.cueId]);
    if (!seen.has(id)) interval('cue', [item.cueId]);
  }
  for (const item of script.timeline ?? []) {
    if (item.kind === 'transition') {
      Object.assign(item, interval('transition', [item.id]));
      for (const layer of item.layers ?? []) {
        layer.timing = interval('transition-layer', [item.id, layer.id]);
        for (const component of layer.components ?? []) component.timing = interval('transition-component', [item.id, layer.id, component.id]);
      }
      for (const component of item.components ?? []) component.timing = interval('transition-component', [item.id, component.id]);
    }
    if (item.kind === 'scene') {
      const scene = scenes.find((candidate: any) => candidate.id === item.sceneId);
      if (!scene) throw new Error(`Missing source scene: ${item.sceneId}`);
      item.startSec = scene.startSec; item.endSec = scene.endSec;
    }
  }
  if (seen.size !== lookup.size) throw new Error('Resolved timeline does not match source IDs');
  for (const [kind, entries] of [['scene', timing.scenes], ['layer', timing.layers], ['component', timing.components], ['transition', timing.transitions]] as const) {
    if (JSON.stringify(ordered.get(kind) ?? []) !== JSON.stringify(entries.map(entry => entry.id))) throw new Error(`Resolved ${kind} order does not match source`);
  }
  const actualCueIds = ordered.get('cue') ?? [];
  const sceneCueIds = scenes.flatMap((scene: any) => (scene.cues ?? []).map((cue: any) => qualifiedTimingId('cue', [cue.id])));
  const frozenCueIds = timing.cues.map(cue => cue.id);
  if (JSON.stringify(sceneCueIds) !== JSON.stringify(frozenCueIds.filter(id => sceneCueIds.includes(id)))) throw new Error('Resolved cue order does not match source scenes');
  const narrativeCueIds = (timeline?.items ?? []).filter(item => item.type === 'tts' && typeof item.cueId === 'string').map(item => qualifiedTimingId('cue', [String(item.cueId)])).filter(id => !sceneCueIds.includes(id));
  if (JSON.stringify(narrativeCueIds) !== JSON.stringify(frozenCueIds.filter(id => narrativeCueIds.includes(id)))) throw new Error('Resolved narration cue order does not match source');
  const sourceOrder = timeline?.sourceCueOrder?.map(cueId => qualifiedTimingId('cue', [cueId]));
  if (sourceOrder ? JSON.stringify(sourceOrder) !== JSON.stringify(frozenCueIds) : JSON.stringify(actualCueIds) !== JSON.stringify(frozenCueIds)) throw new Error('Resolved cue order does not match source');
  script.fps = timing.fps;
  script.meta = {...script.meta, fps:timing.fps, durationSeconds:timing.durationFrames / timing.fps};
  return script as T;
}

/** Project narration cue and segment times into the legacy timeline view. */
export function projectResolvedTimeline<T extends Record<string, any>>(source: T, timing: ResolvedTiming): T {
  validateResolvedTiming(timing);
  const timeline: Record<string, any> = structuredClone(source);
  const cueMap = new Map(timing.cues.map(cue => [cue.id,cue]));
  const segmentMap = new Map(timing.segments.map(segment => [segment.id,segment]));
  const seen = new Set<string>();
  for (const item of timeline.items ?? []) {
    if (item.type !== 'tts') continue;
    if (typeof item.cueId !== 'string') throw new Error('Narration timeline cue lacks an explicit ID');
    const cueId = qualifiedTimingId('cue',[item.cueId]);
    const cue = cueMap.get(cueId);
    if (!cue || seen.has(cueId)) throw new Error(`Missing or duplicate frozen narration cue: ${cueId}`);
    seen.add(cueId); item.startSec=cue.startFrame/timing.fps; item.endSec=cue.endFrame/timing.fps;
    for (const segment of item.segments ?? []) {
      if (segment.type !== 'tts') continue;
      if (!Number.isSafeInteger(segment.segmentIndex) || segment.segmentIndex < 0) throw new Error('Narration segment lacks its source position');
      const resolved=segmentMap.get(qualifiedTimingId('segment',[item.cueId,segment.segmentIndex]));
      if (!resolved) throw new Error('Missing frozen narration segment');
      segment.startSec=resolved.startSample/timing.sampleRateHz; segment.endSec=resolved.endSample/timing.sampleRateHz;
      segment.durationSec=(resolved.endSample-resolved.startSample)/timing.sampleRateHz;
    }
  }
  return timeline as T;
}

export type SourceNodeKind = 'root' | 'scene' | 'cue' | 'narration' | 'layer' | 'component' | 'transition' | 'sequence' | 'stack' | 'other';
export type SourceNode = {kind: SourceNodeKind; id?: string | null; children: SourceNode[]};
export type NormalizedSourceNode = {kind: SourceNodeKind; id?: string; generated: boolean; children: NormalizedSourceNode[]};
const builtins = new Set(['video','vml','videoml','video-ml','pause','voice','bullet','voiceover','pronunciation','mark','audio','sfx','music']);
export function sourceNodeKind(tag: string): SourceNodeKind {
  const name=tag.toLowerCase();
  if (['vml','videoml','video-ml'].includes(name)) return 'root';
  if (['scene','cue','narration','layer','transition','sequence','stack'].includes(name)) return name as SourceNodeKind;
  return builtins.has(name) ? 'other' : 'component';
}
export function implicitTransitionId(fromSceneId: string, toSceneId: string | null): string {
  if (!fromSceneId || toSceneId === '') throw new Error('Implicit transition requires stable scene IDs');
  return '@videoml:auto:' + JSON.stringify(['implicit-transition',fromSceneId,toSceneId]);
}
/** Pure normalization before XML flattening. Sibling ordinals count same-kind element nodes. */
export function normalizeSourceTree(root: SourceNode): NormalizedSourceNode {
  if (root.kind !== 'root') throw new Error('Normalization requires a source root');
  const visit = (node: SourceNode, parent: string, wrappers: Array<[string,number]>, ordinal: number, implicitCandidate?: string): NormalizedSourceNode => {
    if (!node || !Array.isArray(node.children)) throw new Error('Invalid source tree');
    const eligible = node.kind === 'component' || node.kind === 'layer' || node.kind === 'transition';
    const expected = eligible ? '@videoml:auto:' + JSON.stringify([parent,wrappers,node.kind,ordinal]) : null;
    let id = node.id || undefined, generated = false;
    if (id?.startsWith('@videoml:auto:')) {
      if (!eligible || (id !== expected && id !== implicitCandidate)) throw new Error('Invalid or stale reserved generated ID');
      generated = true;
    } else if (!id && eligible) { id = expected!; generated = true; }
    if (['scene','cue','narration'].includes(node.kind) && !id) throw new Error(`Source ${node.kind} requires an ID`);
    const semantic = ['scene','narration','layer','transition'].includes(node.kind);
    const nextParent = semantic ? JSON.stringify([parent,node.kind,id]) : parent;
    const nextWrappers: Array<[string,number]> = semantic ? [] : node.kind === 'sequence' || node.kind === 'stack' ? [...wrappers,[node.kind,ordinal]] : wrappers;
    const counts = new Map<SourceNodeKind,number>();
    const children = node.children.map((child,index) => {
      const count=counts.get(child.kind) ?? 0; counts.set(child.kind,count+1);
      let implicit: string | undefined;
      if (child.kind === 'transition') {
        const before=node.children.slice(0,index).reverse().find(item=>item.kind==='scene');
        const after=node.children.slice(index+1).find(item=>item.kind==='scene');
        if (before?.id) implicit=implicitTransitionId(before.id,after?.id ?? null);
      }
      return visit(child,nextParent,nextWrappers,count,implicit);
    });
    return {kind:node.kind,id,generated,children};
  };
  return visit(root,JSON.stringify(['root',root.id ?? '']),[],0);
}

/** The same DOM-agnostic adapter works for xmldom and browser XML elements. */
export type SourceElement = {
  tagName: string;
  childNodes: ArrayLike<{nodeType: number}>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
};
export const normalizedSourceIds = Symbol.for('@videoml/normalized-source-ids');
export function normalizeSourceElement(root: SourceElement): void {
  const elements: SourceElement[] = [];
  const read = (element: SourceElement): SourceNode => {
    elements.push(element);
    return {kind:sourceNodeKind(element.tagName),id:element.getAttribute('id'),children:Array.from(element.childNodes).filter(node=>node.nodeType===1).map(node=>read(node as unknown as SourceElement))};
  };
  const normalized = normalizeSourceTree(read(root));
  let cursor=0;
  const apply = (node: NormalizedSourceNode) => {
    const element=elements[cursor++];
    if (node.id && node.generated) element.setAttribute('id',node.id);
    node.children.forEach(apply);
  };
  apply(normalized);
}
