import { planSceneSnapshots, type SceneSnapshotRequest } from '@videoml/stdlib/effects';
export type SceneInputDescriptor = {
    id: string;
    version: string;
    sceneInputs: ReadonlyArray<{
        sceneIdParameter: string;
        frameParameter: string;
    }>;
};
/** Read only declarative descriptors; no browser code or effect factories are invoked. */
export function prepareSceneSnapshotPlan(script: any, descriptors: ReadonlyArray<SceneInputDescriptor>): SceneSnapshotRequest[] {
    if (!script || !Array.isArray(script.scenes))
        throw new Error('SCENE_CAPTURE_INVALID: scenes');
    const index = new Map<string, SceneInputDescriptor>();
    for (const descriptor of descriptors) {
        const k = JSON.stringify([descriptor.id, descriptor.version]);
        if (index.has(k))
            throw new Error('SCENE_CAPTURE_INVALID: duplicate descriptor');
        index.set(k, descriptor);
    }
    const graph: Record<string, SceneSnapshotRequest[]> = Object.create(null), roots: SceneSnapshotRequest[] = [];
    for (const scene of script.scenes) {
        if (!scene || typeof scene.id !== 'string' || !scene.id || Object.hasOwn(graph, scene.id))
            throw new Error('SCENE_CAPTURE_INVALID: scene identity');
        graph[scene.id] = [];
    }
    const visit = (item: any, owner?: string) => {
        if (!item || typeof item !== 'object')
            throw new Error('SCENE_CAPTURE_INVALID: component');
        if (item.type === 'FrameEffect') {
            const props = item.props ?? {}, descriptor = index.get(JSON.stringify([props.effectId, props.effectVersion])), params = props.parameters ?? {};
            if (!descriptor) {
                if (Object.hasOwn(params, 'sourceSceneId') || Object.hasOwn(params, 'sourceFrame'))
                    throw new Error('SCENE_CAPTURE_UNDECLARED');
            }
            else
                for (const input of descriptor.sceneInputs) {
                    const id = params[input.sceneIdParameter], frame = params[input.frameParameter];
                    if (id === undefined && frame === undefined)
                        continue;
                    if (typeof id !== 'string' || !id || !Number.isSafeInteger(frame) || frame < 0)
                        throw new Error('SCENE_CAPTURE_INVALID: reference');
                    const ref = { sceneId: id, frame };
                    if (owner)
                        graph[owner].push(ref);
                    roots.push(ref);
                }
        }
        for (const key of ['components', 'layers', 'children'])
            if (item[key] !== undefined) {
                if (!Array.isArray(item[key]))
                    throw new Error('SCENE_CAPTURE_INVALID: children');
                for (const child of item[key])
                    visit(child, owner);
            }
    };
    for (const scene of script.scenes)
        for (const key of ['components', 'layers'])
            for (const item of scene[key] ?? [])
                visit(item, scene.id);
    for (const item of script.timeline ?? [])
        if (item?.kind === 'transition')
            visit(item);
    return planSceneSnapshots(graph, roots);
}
