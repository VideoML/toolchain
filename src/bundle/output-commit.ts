import {renameSync} from 'node:fs';
/** Synchronous commit point: cancellation before this call leaves the destination untouched. */
export function commitPortableOutput(source:string,destination:string,signal?:AbortSignal):void {if(signal?.aborted)throw new Error('RENDER_CANCELLED');try{renameSync(source,destination);}catch(error:any){if(error?.code==='EXDEV')throw new Error('RENDER_OUTPUT_UNAVAILABLE: output staging and destination must share a filesystem');throw error;}}
