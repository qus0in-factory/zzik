import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
/** Wrangler performs refresh and writes its own default profile. stdout/stderr are
 * captured and discarded, never forwarded to logs or alerts.
 * @param {{execute?:(args:string[])=>Promise<number>}} [options]
 * @returns {import('../../domain/usage/d1-sender-types.ts').OAuthRefreshPort} */
export function createWranglerOAuthRefresh({execute}={}){
 const run=execute??(args=>new Promise(resolve=>{
  const env={...process.env,CI:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'}
  for(const key of ['DB_URL','ZZIK_D1_API_TOKEN','ZZIK_D1_ACCOUNT_ID','ZZIK_D1_DATABASE_ID','CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_API_KEY','CF_API_KEY','CLOUDFLARE_EMAIL','CF_EMAIL','CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID','CLOUDFLARE_PROFILE','CLOUDFLARE_AUTH_PROFILE','WRANGLER_API_ENVIRONMENT'])delete /** @type {Record<string,string|undefined>} */(env)[key]
  execFile(process.execPath,[fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),...args],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8',env,timeout:10000,maxBuffer:1024*1024},error=>resolve(error?1:0))
 }))
 return {async run(){try{return await run(['whoami','--json'])===0?{ok:true,value:undefined}:{ok:false,reason:'oauth_refresh_failed'}}catch{return {ok:false,reason:'oauth_refresh_failed'}}}}
}
