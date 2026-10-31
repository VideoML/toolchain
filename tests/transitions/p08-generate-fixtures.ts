import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadVideoFileFromXml} from '../../src/dsl/xml.js';
import {generateComposition} from '../../src/generate.js';
const output=process.env.P08_OUTPUT;if(!output)throw new Error('P08_OUTPUT is required');
const fixtureRoot=process.env.P08_FIXTURES;if(!fixtureRoot)throw new Error('P08_FIXTURES is required');
for(const name of ['domain-warp','ridged-burn','whip-pan','sdf-iris','ripple-waves','gravitational-lens','cinematic-zoom','chromatic-split','glitch','swirl-vortex','thermal-distortion','flash-through-white','cross-warp-morph','light-leak']){
 const input=join(fixtureRoot,`${name}.xml`),outDir=join(output,name);mkdirSync(outDir,{recursive:true});const composition=loadVideoFileFromXml(readFileSync(input,'utf8')).compositions[0];await generateComposition({composition,dslPath:input,scriptOut:join(outDir,'script.json'),timelineOut:join(outDir,'timeline.json'),outDir,config:{},verboseLogs:false});console.log(name);
}
