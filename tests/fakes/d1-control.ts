import type {D1ControlPort,D1ControlState} from '../../collector/domain/usage/d1-sender-types'
export function fakeD1Control():D1ControlPort {
 let value:D1ControlState={credentialKey:null,authStopped:false,lastHealthCheckAtMs:null,nextRequestAtMs:0,paused:{}}
 return {read:()=>({ok:true,value:structuredClone(value)}),write:s=>{value=structuredClone(s);return {ok:true,value:undefined}}}
}
