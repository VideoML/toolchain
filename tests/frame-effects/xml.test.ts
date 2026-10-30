import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadVideoFileFromXml} from '../../src/dsl/xml.js';
const xml=(attrs:string)=>`<vml id="v" fps="24" width="1280" height="720"><scene id="s" duration="4s"><frame-effect ${attrs}/></scene></vml>`;
test('frame effect XML keeps identity, plain parameters and fractional frame timing',()=>{
 const result=loadVideoFileFromXml(xml(`id="e" effect-id="videoml/echo-smear" effect-version="1" props='{"parameters":{"length":50}}' start="12f" duration="36f"`));
 const c=(result.compositions[0].timeline[0] as any).components[0];assert.equal(c.type,'FrameEffect');assert.equal(c.props.effectId,'videoml/echo-smear');assert.equal(c.props.effectVersion,'1');assert.deepEqual(c.props.parameters,{length:50});assert.equal(c.timing.startSec,.5);assert.equal(c.timing.endSec,2);
 const leading=loadVideoFileFromXml(xml(`id="e" effect-id="videoml/echo-smear" effect-version="01" props='{"parameters":{}}'`));assert.equal((leading.compositions[0].timeline[0] as any).components[0].props.effectVersion,'01');
});
test('frame effects reject missing identity and unsafe or malformed data',()=>{for(const attrs of [`effect-id="x" effect-version="1" props='{"parameters":{}}'`,`id="e" effect-id="x" effect-version="1" props='{"parameters":{"__proto__":{}}}'`,`id="e" effect-id="x" effect-version="1" props='{"parameters":[],"extra":1}'`])assert.throws(()=>loadVideoFileFromXml(xml(attrs)),/frame-effect/);});
