/** Caller must hold B1's process-lifetime state-directory lock. No token is persisted. */
import {readFileSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,mkdirSync,chmodSync} from 'node:fs'
import {dirname} from 'node:path'
/** @typedef {import('../../domain/usage/d1-sender-types.ts').D1ControlState} State */
/** @param {unknown} input @returns {input is State} */
function valid(input){
  if(input===null||typeof input!=='object')return false
  const s=/** @type {State} */(input)
  return (s.credentialKey===null||typeof s.credentialKey==='string'&&/^[a-f0-9]{64}$/.test(s.credentialKey)) && typeof s.authStopped==='boolean'&&Number.isSafeInteger(s.nextRequestAtMs)&&s.nextRequestAtMs>=0
    && (s.lastHealthCheckAtMs===null||Number.isSafeInteger(s.lastHealthCheckAtMs))
    && s.paused!==null&&typeof s.paused==='object'&&!Array.isArray(s.paused)&&Object.entries(s.paused).every(([p,id])=>['claude','codex','antigravity','opencode','grok','ollama','zai'].includes(p)&&typeof id==='string')
}
/** @param {{path:string}} options @returns {import('../../domain/usage/d1-sender-types.ts').D1ControlPort} */
export function createD1ControlFile({path}){
 return {
  read(){try{const s=JSON.parse(readFileSync(path,'utf8'));return valid(s)?{ok:true,value:s}:{ok:false,reason:'invalid_sender_control'}}catch(error){if(/** @type {{code?:string}} */(error).code==='ENOENT')return {ok:true,value:{credentialKey:null,authStopped:false,lastHealthCheckAtMs:null,nextRequestAtMs:0,paused:{}}};return {ok:false,reason:'sender_control_read_failed'}}},
  write(state){
   if(!valid(state))return {ok:false,reason:'invalid_sender_control'}
   try{
    mkdirSync(dirname(path),{recursive:true,mode:0o700});chmodSync(dirname(path),0o700)
    writeFileSync(path+'.tmp',JSON.stringify(state),{mode:0o600});chmodSync(path+'.tmp',0o600)
    const fd=openSync(path+'.tmp','r');try{fsyncSync(fd)}finally{closeSync(fd)}
    renameSync(path+'.tmp',path)
    const dir=openSync(dirname(path),'r');try{fsyncSync(dir)}finally{closeSync(dir)}
    return {ok:true,value:undefined}
   }catch{return {ok:false,reason:'sender_control_write_failed'}}
  },
 }
}
