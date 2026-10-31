#!/usr/bin/env python3
"""Compare two completed run.sh exercise directories using a supplied ffprobe."""
import hashlib, json, pathlib, subprocess, sys, wave
if len(sys.argv) != 4:
    raise SystemExit('usage: compare.py MAC_DIR LINUX_DIR FFPROBE')
a, b = map(pathlib.Path, sys.argv[1:3]); probe = sys.argv[3]
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def streams(path):
    data = subprocess.check_output([probe, '-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration,nb_frames', '-of', 'json', str(path)])
    return {s['codec_type']: s for s in json.loads(data)['streams']}
for case, frames, video_sec, audio_frames, audio_sec, suffix in [('xml',22,22/30,19,.727,'xml'),('custom',60,2,25,1,'ts')]:
    z1, z2 = a / (case+'.zip'), b / (case+'.zip')
    assert sha(z1) == sha(z2), f'{case}: archive differs'
    paths = ['source/main.'+suffix, 'script/main.json', 'timing/main.resolved.json', 'assembled.wav' if case == 'xml' else 'public/videoml/custom-demo.wav']
    if case == 'xml': paths.append('source/fonts/Geist.woff2')
    for rel in paths:
        p1, p2 = a / (case+'-imported') / rel, b / (case+'-imported') / rel
        assert sha(p1) == sha(p2), f'{case}: {rel} differs'
    if case == 'xml':
        with wave.open(str(a / 'xml-imported/assembled.wav'), 'rb') as w:
            assert (w.getnframes(),w.getframerate()) == (17455,24000)
            assert hashlib.sha256(w.readframes(w.getnframes())).hexdigest() == 'ddd10a961c923665bd9641d52ce7cf5d6dcb53ecb576900f7dbdffe83ff50a06'
    for directory in (a,b):
        s = streams(directory/(case+'.mp4')); v=s['video']; audio=s['audio']
        assert (v['width'],v['height'],int(v['nb_frames'])) == (320,240,frames)
        assert abs(float(v['duration'])-video_sec) < .002
        assert int(audio['nb_frames']) == audio_frames and abs(float(audio['duration'])-audio_sec) < .002
    print(case, 'archive', sha(z1), 'identities and streams match')
print('Pixel differences are intentionally evaluated separately.')
