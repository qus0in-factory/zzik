/** @typedef {{id:string,name:string}} Model */
/** @param {string|null} output @returns {{ok:true,value:Model[]}|{ok:false,reason:string}} */
export function parseAgyModels(output){
 if(!output?.trim())return {ok:false,reason:'empty_models'}
 /** @type {Map<string,Model>} */const models=new Map()
 for(const line of output.trim().split(/\r?\n/)){
  const [rawId,rawName]=line.split('\t')
  if(!rawName||!/^[a-z0-9][a-z0-9._/-]*$/i.test(rawId))return {ok:false,reason:'invalid_models'}
  const id=rawId.replace(/-(?:low|medium|high|xhigh)$/i,'')
  const name=rawName.trim().replace(/\s+(?:low|medium|high|xhigh)$/i,'')
  if(!name)return {ok:false,reason:'invalid_models'}
  if(!models.has(id))models.set(id,{id,name})
 }
 return models.size?{ok:true,value:[...models.values()]}:{ok:false,reason:'empty_models'}
}
/** @param {string|null} raw @returns {{ok:true,value:Model[]}|{ok:false,reason:string}} */
export function parseClaudeModels(raw){
 if(!raw)return {ok:false,reason:'missing_usage'}
 try{
  const parsed=JSON.parse(raw)
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {ok:false,reason:'invalid_usage'}
  /** @type {Map<string,Model>} */const models=new Map()
  /** @param {unknown} scope */
  const add=scope=>{
   const model=/** @type {any} */(scope)?.model
   if(typeof model?.id!=='string'||!/^claude-[a-z0-9][a-z0-9.-]*$/i.test(model.id)||typeof model.display_name!=='string'||!model.display_name.trim())return
   models.set(model.id,{id:model.id,name:model.display_name.trim()})
  }
  for(const [key,value] of Object.entries(parsed)){
   if(/^seven_day_[a-z0-9_]+$/.test(key)&&value&&typeof value==='object')add(/** @type {any} */(value).scope)
  }
  if(Array.isArray(parsed.limits))for(const limit of parsed.limits){
   if(limit?.kind==='weekly_scoped')add(limit.scope)
  }
  const result=[...models.values()]
  return result.length?{ok:true,value:result}:{ok:false,reason:'empty_models'}
 }catch{return {ok:false,reason:'invalid_usage'}}
}
/** @param {string} plan @param {string} source @param {Model[]} models @param {number} at @returns {import('../../../shared/d1-contract.ts').D1SqlStatement} */
export function planStatement(plan,source,models,at){
 const rows=models.map(()=> 'SELECT ? AS model_id, ? AS display_name').join(' UNION ALL ')
 return {sql:`WITH initial AS MATERIALIZED (SELECT NOT EXISTS (SELECT 1 FROM trend_plan_observation WHERE plan=?) AS baseline) INSERT INTO trend_plan_observation (plan,model_id,display_name,source,confidence,first_seen_at,last_seen_at,baseline) SELECT ?,models.model_id,models.display_name,?,'account',?,?,initial.baseline FROM (${rows}) AS models CROSS JOIN initial WHERE true ON CONFLICT(plan,model_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`,params:[plan,plan,source,at,at,...models.flatMap(m=>[m.id,m.name])]}
}
