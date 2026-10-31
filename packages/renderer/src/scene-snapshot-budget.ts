const MAX_TOTAL=64*1024*1024;
/** Before capture reserve both maximum screenshot buffers; before transport reserve actual copies. */
export function assertTransitionTransferBudget(cachedBytes:number,screenshots?:readonly [number,number]):void {
 if(!Number.isSafeInteger(cachedBytes)||cachedBytes<0)throw new Error('SCENE_CAPTURE_LIMIT: transition transfer budget');
 const copies=screenshots ? 16*1024*1024+(screenshots[0]+screenshots[1])*16 : 48*1024*1024;
 if(screenshots&&screenshots.some(size=>!Number.isSafeInteger(size)||size<0||size>16*1024*1024))throw new Error('SCENE_CAPTURE_LIMIT: transition PNG');
 if(cachedBytes*24+copies>MAX_TOTAL)throw new Error('SCENE_CAPTURE_LIMIT: transition transfer budget');
}
/** Validate measured sizes before creating any base64 transport copies. */
export function encodeTransitionSnapshots(cachedBytes:number,a:Buffer,b:Buffer):[string,string] {
 assertTransitionTransferBudget(cachedBytes,[a.byteLength,b.byteLength]);
 return [a.toString('base64'),b.toString('base64')];
}
