import { createQuiescer } from './quiesce.mjs'
/** A single shutdown route for startup reconciliation and then the active runtime.
 * @param {{timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer,reconcile:(stop:()=>boolean)=>Promise<unknown>,closeStartup:()=>Promise<void>|void,onReady:()=>({shutdown():Promise<{timedOut:boolean}>})}} options */
export function createStartupGate(options){
 let phase='startup',stopping=false
 /** @type {Promise<unknown>|null} */let reconcilePromise=null
 /** @type {{shutdown():Promise<{timedOut:boolean}>}|null} */let runtime=null
 const startup=createQuiescer({timer:options.timer,stop:()=>{stopping=true},pending:()=>reconcilePromise===null?[]:[reconcilePromise],close:async()=>{await options.closeStartup()}})
 return {
  start(){reconcilePromise=options.reconcile(()=>stopping);return reconcilePromise},
  stopping:()=>stopping,
  activate(){runtime=options.onReady();phase='active';return runtime},
  shutdown:()=>phase==='startup'||runtime===null?startup.shutdown():runtime.shutdown(),
 }
}
