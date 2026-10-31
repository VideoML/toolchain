import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFfmpegArgs} from '../../packages/renderer/src/encode.ts';

test('frame-limited audio uses shared duration so FFmpeg drains audio', () => {
  const args = buildFfmpegArgs({framesDir:'/frames',fps:30,outputPath:'/out.mp4',audioPath:'/audio.wav',frameCount:22});
  assert.equal(args[args.indexOf('-t')+1], String(22/30));
  assert.equal(args.includes('-frames:v'), false);
  const silent = buildFfmpegArgs({framesDir:'/frames',fps:30,outputPath:'/out.mp4',frameCount:22});
  assert.equal(silent[silent.indexOf('-frames:v')+1], '22');
});
