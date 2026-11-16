import {readFileSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,rmSync,existsSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {homedir} from 'node:os'
import {randomUUID} from 'node:crypto'
/** Mirrors Wrangler legacy-home precedence and macOS/XDG config placement. */
export function defaultWranglerOAuthPath(){
 const home=homedir(),legacy=join(home,'.wrangler')
 const base=existsSync(legacy)?legacy:join(process.env.XDG_CONFIG_HOME??(process.platform==='darwin'?join(home,'Library','Preferences'):process.platform==='win32'?join(process.env.APPDATA??join(home,'AppData','Roaming'),'xdg.config'):join(home,'.config')),'.wrangler')
 return join(base,'config','default.toml')
}
/** Narrow top-level string fields from Wrangler's own plaintext TOML layout.
 * @param {string} raw */
function parse(raw){
 /** @param {string} key */
 const field=key=>{
  const top=raw.split(/^\s*\[/m)[0],matches=[...top.matchAll(new RegExp('^'+key+'\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|\'[^\']*\')\\s*(?:#.*)?$','gm'))]
  if(matches.length!==1)throw Error('invalid_oauth_file')
  const text=matches[0][1];return text.startsWith("'")?text.slice(1,-1):JSON.parse(text)
 }
 const token=field('oauth_token'),expiresAtMs=Date.parse(field('expiration_time'))
 if(typeof token!=='string'||!token.trim()||/[\r\n\0]/.test(token)||!Number.isFinite(expiresAtMs))throw Error('invalid_oauth_file')
 return {token,expiresAtMs}
}
/** @param {{path:string}} options @returns {import('../../domain/usage/d1-sender-types.ts').WranglerOAuthFilePort} */
export function createWranglerOAuthFile({path}){
 return {
  read(){try{return {ok:true,value:parse(readFileSync(path,'utf8'))}}catch{return {ok:false,reason:'oauth_file_unavailable'}}},
  expire(expectedToken){
   const temp=path+'.zzik-expiry-'+randomUUID()
   try{
    const raw=readFileSync(path,'utf8'),current=parse(raw)
    if(current.token!==expectedToken)return {ok:false,reason:'oauth_file_changed'}
    const next=raw.replace(/^expiration_time\s*=.*$/m,'expiration_time = "2000-01-01T00:00:00.000Z"')
    if(next===raw)return {ok:true,value:undefined}
    writeFileSync(temp,next,{mode:0o600,flag:'wx'})
    const fd=openSync(temp,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
    if(readFileSync(path,'utf8')!==raw)return {ok:false,reason:'oauth_file_changed'}
    renameSync(temp,path)
    const directory=openSync(dirname(path),'r');try{fsyncSync(directory)}finally{closeSync(directory)}
    return {ok:true,value:undefined}
   }catch{return {ok:false,reason:'oauth_expiry_update_failed'}}
   finally{try{rmSync(temp,{force:true})}catch{}}
  },
 }
}
