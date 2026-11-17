import {credentialExpired} from '../../domain/usage/credential-choice.mjs'
import {fetchUsageJson} from '../usage/fetch-usage-json.mjs'
import {GROK_CLIENT_HEADERS} from '../usage/grok-usage-client.mjs'

/** @param {{fetchImpl:typeof fetch,readCredentials:()=>Promise<import('../../domain/usage/ports.mjs').CredentialRead|null>,nowMs?:()=>number}} deps */
export function createGrokModelsClient({fetchImpl,readCredentials,nowMs=Date.now}){
 return {async read(){
  const credential=await readCredentials()
  if(!credential||credentialExpired(credential,nowMs()))return null
  const result=await fetchUsageJson({fetchImpl,url:'https://cli-chat-proxy.grok.com/v1/models',headers:{Authorization:'Bearer '+credential.token,Accept:'application/json',...GROK_CLIENT_HEADERS},timeoutMs:10_000,nowMs})
  return result.ok?result.bodyText:null
 }}
}
