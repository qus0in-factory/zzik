import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {DEFAULT_COLLECTOR_OAUTH_PROFILE,isCollectorOAuthProfile} from '../../domain/usage/d1-oauth-profile.mjs'
/** @typedef {{file:string,args:string[],cwd:string,env:NodeJS.ProcessEnv}} Invocation */
/** Captured noninteractive refresh of the collector's named plaintext profile.
 * whoami rejects --profile in Wrangler4.159: its explicit env overrides directory binding.
 * @param {{profile?:string,env?:NodeJS.ProcessEnv,execute?:(request:Invocation)=>Promise<number>}} [options]
 * @returns {import('../../domain/usage/d1-sender-types.ts').OAuthRefreshPort} */
export function createWranglerOAuthRefresh({profile=DEFAULT_COLLECTOR_OAUTH_PROFILE,env=process.env,execute}={}){
 /** @param {Invocation} request @returns {Promise<number>} */
 const run=execute??(request=>new Promise(resolve=>{
  execFile(request.file,request.args,{cwd:request.cwd,encoding:'utf8',env:request.env,timeout:10000,maxBuffer:1024*1024},error=>resolve(error?1:0))
 }))
 return {async run(){
  try{
   if(!isCollectorOAuthProfile(profile))return {ok:false,reason:'oauth_refresh_failed'}
   /** @type {NodeJS.ProcessEnv} */const child={}
   // Runtime/network configuration only. DB/Discord/API credentials and endpoint
   // override variables are never inherited by this OAuth child.
   for(const key of ['HOME','PATH','XDG_CONFIG_HOME','XDG_CACHE_HOME','TMPDIR','TMP','TEMP','APPDATA','LOCALAPPDATA','SYSTEMROOT','LANG','LC_ALL','LC_CTYPE','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','NODE_EXTRA_CA_CERTS','NODE_USE_ENV_PROXY','SSL_CERT_FILE','SSL_CERT_DIR'])if(env[key]!==undefined)child[key]=env[key]
   Object.assign(child,{CI:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',WRANGLER_API_ENVIRONMENT:'production',CLOUDFLARE_AUTH_USE_KEYRING:'false',CLOUDFLARE_AUTH_PROFILE:profile})
   const result=await run({file:process.execPath,args:[fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'whoami','--json'],cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:child})
   return result===0?{ok:true,value:undefined}:{ok:false,reason:'oauth_refresh_failed'}
  }catch{return {ok:false,reason:'oauth_refresh_failed'}}
 }}
}
