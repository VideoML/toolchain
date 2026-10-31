import type {SceneSnapshotProvider, OwnedSceneSnapshot} from '@videoml/stdlib/effects';
type Encoded = {sceneId:string; frame:number; png:string};
const MAX_PNG = 16 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_DECODE_COPIES = 8 * 1024 * 1024;

/** Each capture returns a new owned bitmap; disposal closes all outstanding handles. */
export function createEncodedSceneSnapshotProvider(
  entries:ReadonlyArray<Encoded>,
  decode:(blob:Blob)=>Promise<ImageBitmap> = blob=>createImageBitmap(blob),
  decodedLimit = MAX_TOTAL,
  dimensions?:{width:number;height:number},
):SceneSnapshotProvider & {dispose():void} {
  if(!Number.isSafeInteger(decodedLimit)||decodedLimit<1||decodedLimit>MAX_TOTAL)
    throw new Error('SCENE_CAPTURE_LIMIT: decoded budget');
  const values=new Map<string,{bytes:Uint8Array;width:number;height:number}>();
  const owned=new Set<OwnedSceneSnapshot>();
  const aborter=new AbortController();
  let decoded=0,total=0,encodedInFlight=0,disposed=false;
  for(const entry of entries) {
    if(!entry||typeof entry.sceneId!=='string'||!entry.sceneId||!Number.isSafeInteger(entry.frame)||entry.frame<0||typeof entry.png!=='string'||entry.png.length>Math.ceil(MAX_PNG/3)*4||(entry.png.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.png)))
      throw new Error('SCENE_CAPTURE_INVALID: encoded snapshot');
    const key=JSON.stringify([entry.sceneId,entry.frame]);
    if(values.has(key)) throw new Error('SCENE_CAPTURE_INVALID: duplicate snapshot');
    const estimated=entry.png.length/4*3-(entry.png.endsWith('==')?2:entry.png.endsWith('=')?1:0);
    if(estimated>MAX_PNG||total+estimated>MAX_TOTAL)throw new Error('SCENE_CAPTURE_LIMIT: encoded budget');
    const text=atob(entry.png),bytes=Uint8Array.from(text,c=>c.charCodeAt(0));
    total+=bytes.length;
    if(bytes.length<33||[137,80,78,71,13,10,26,10].some((x,i)=>bytes[i]!==x))throw new Error('SCENE_CAPTURE_INVALID: PNG');
    const view=new DataView(bytes.buffer);
    if(view.getUint32(8)!==13||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw new Error('SCENE_CAPTURE_INVALID: IHDR');
    const width=view.getUint32(16),height=view.getUint32(20);
    if(!width||!height||width>4096||height>4096||width*height>4194304)throw new Error('SCENE_CAPTURE_LIMIT: dimensions');
    if(dimensions&&(width!==dimensions.width||height!==dimensions.height))throw new Error('SCENE_CAPTURE_INVALID: composition dimensions');
    values.set(key,{bytes,width,height});
  }
  return {
    async capture({sceneId,frame,signal}) {
      if(disposed||signal.aborted)throw new Error('SCENE_CAPTURE_CANCELLED');
      const item=values.get(JSON.stringify([sceneId,frame]));
      if(!item)throw new Error('SCENE_CAPTURE_UNAVAILABLE');
      const size=item.width*item.height*8,encodedReservation=item.bytes.byteLength*2;
      if(decoded+size>decodedLimit)throw new Error('SCENE_CAPTURE_LIMIT: decoded budget');
      if(encodedInFlight+encodedReservation>MAX_DECODE_COPIES)throw new Error('SCENE_CAPTURE_LIMIT: encoded decode copies');
      decoded+=size;encodedInFlight+=encodedReservation;
      const job=Promise.resolve().then(()=>decode(new Blob([item.bytes as BlobPart],{type:'image/png'}))).finally(()=>{encodedInFlight-=encodedReservation});
      let bitmap:ImageBitmap,timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
      const interrupted=new Promise<never>((_,reject)=>{
        onAbort=()=>reject(new Error('SCENE_CAPTURE_CANCELLED'));
        signal.addEventListener('abort',onAbort,{once:true});aborter.signal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(()=>reject(new Error('SCENE_CAPTURE_TIMEOUT')),10000);
        if(signal.aborted||disposed)onAbort();
      });
      try{bitmap=await Promise.race([job,interrupted]);}
      catch(error){void job.then(late=>{try{late.close()}catch{}decoded-=size},()=>{decoded-=size});throw error;}
      finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);aborter.signal.removeEventListener('abort',onAbort);}
      if(disposed||signal.aborted){try{bitmap.close()}catch{}decoded-=size;throw new Error('SCENE_CAPTURE_CANCELLED');}
      if(bitmap.width!==item.width||bitmap.height!==item.height){try{bitmap.close()}catch{}decoded-=size;throw new Error('SCENE_CAPTURE_INVALID: decoded size');}
      let released=false;
      const handle:OwnedSceneSnapshot={bitmap,close(){if(released)return;released=true;owned.delete(handle);decoded-=size;bitmap.close();}};
      owned.add(handle);return handle;
    },
    dispose(){if(disposed)return;disposed=true;aborter.abort();for(const handle of [...owned])try{handle.close()}catch{}owned.clear();values.clear();total=0;},
  };
}
