import {readFile,writeFile,mkdir,chmod,open,rename,rm} from 'node:fs/promises'
import {dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
/** @param {{path:string}} options */
export function createOffpeakState({path}){
 return {
  async read(){
   try{return /** @type {unknown} */(JSON.parse(await readFile(path,'utf8')))}
   catch(error){if(/** @type {{code?:string}} */(error).code==='ENOENT')return null;throw Error('OffpeakStateUnavailable')}
  },
  /** @param {import('../../domain/usage/offpeak-notification.mjs').OffpeakNoticeState} state */
  async write(state){
   const directory=dirname(path),temp=path+'.'+randomUUID()+'.tmp'
   try{
    await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700)
    await writeFile(temp,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'})
    const file=await open(temp,'r');try{await file.sync()}finally{await file.close()}
    await rename(temp,path)
    const dir=await open(directory,'r');try{await dir.sync()}finally{await dir.close()}
   }finally{await rm(temp,{force:true}).catch(()=>{})}
  },
 }
}
