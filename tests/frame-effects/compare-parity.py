"""Compare every decoded RGBA byte, including repeats and reversed/random seeks."""
import hashlib, json, sys
from pathlib import Path
from PIL import Image
out=Path(sys.argv[1]);project=Path(sys.argv[2]);fps=int(sys.argv[3]) if len(sys.argv)>3 else 30;frames=(0,15,fps*2,fps*4-1,fps*2,15,37);results=[]
for kind in ('text','image','echo'):
    for ordinal,frame in enumerate(frames):
        paths=[out/f'{kind}-direct-{ordinal}-{frame}.png',out/f'{kind}-player-{ordinal}-{frame}.png',project/'.videoml/out'/kind/'frames'/f'frame-{frame:06}.png']
        pixels=[Image.open(p).convert('RGBA').tobytes() for p in paths]
        if pixels[0]!=pixels[1] or pixels[0]!=pixels[2]: raise AssertionError(f'{kind} ordinal {ordinal} frame {frame} differs')
        results.append({'effect':kind,'ordinal':ordinal,'frame':frame,'rgbaSha256':hashlib.sha256(pixels[0]).hexdigest()})
print(json.dumps({'comparisons':len(results)*2,'pixelFormat':'RGBA flattened on opaque #fdfdfd','results':results},indent=2))
