import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises'
import {dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
/** @param {{path:string}} options */
export function createPlanProbeState({path}){
 return {
  async read(){try{return /** @type {unknown} */(JSON.parse(await readFile(path,'utf8')))}catch(error){if(/** @type {{code?:string}} */(error).code==='ENOENT')return null;throw error}},
  /** @param {Record<string,number>} value */
  async write(value){const temp=path+'.'+randomUUID()+'.tmp';try{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(temp,path)}finally{await rm(temp,{force:true}).catch(()=>{})}},
 }
}
