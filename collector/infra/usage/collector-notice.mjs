/** A separate safe operational notice, never a provider envelope or exception body. */
/** @param {{webhookUrl?:string,enabled?:boolean,fetchImpl?:typeof fetch,log?:(line:string)=>void}} options @returns {import('../../domain/usage/d1-sender-types.ts').D1NoticePort} */
export function createCollectorNotice({webhookUrl,enabled=true,fetchImpl=globalThis.fetch,log=()=>{}}){
 return {async notify(event){
  const reason=/^[a-z][a-z0-9_]{0,79}$/.test(event.reason)?event.reason:'collector_error'
  const provider=event.provider&&['claude','codex','antigravity','opencode','grok','ollama'].includes(event.provider)?` provider=${event.provider}`:''
  const status=typeof event.status==='number'&&Number.isInteger(event.status)?` status=${event.status}`:''
  const content=`[zzik collector] reason=${reason}${provider}${status}`
  log(content)
  if(!enabled||!webhookUrl?.trim())return
  try{await fetchImpl(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(5000)})}catch{}
 }}
}
