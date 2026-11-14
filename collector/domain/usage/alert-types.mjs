/** @typedef {'normal'|'caution'|'danger'|'limit'} AlertLevel */
/** @typedef {{id:string,label:string,usedPercent:number,elapsedPercent:number|null,resetsAt:string|null,cycleSeconds:number|null,expired:boolean}} AlertLimit */
/** @typedef {{provider:string,nowMs:number,limits:AlertLimit[],primaryId:string|null,spendLimitReached?:boolean|null}} AlertReport */
/** @typedef {{provider:string,id:string,label:string,kind:'level'|'reset'|'spend',from:AlertLevel,to:AlertLevel,usedPercent:number|null,elapsedPercent:number|null,resetsAt:string|null,nowMs:number}} AlertEvent */
/** @typedef {{level:AlertLevel,notifiedLevel:AlertLevel,notifiedAt:number|null,usedPercent:number,resetsAt:string|null,cycleSeconds:number|null}} AlertCheckpoint */
/** @typedef {{version:1,primaryId:string|null,windows:Record<string,AlertCheckpoint>,spendLimitReached?:boolean|null}} AlertState */
/** @typedef {{send(events:AlertEvent[],options?:{dryRun?:boolean}):Promise<{status:string,count:number}>}} AlertSink */
export {}
