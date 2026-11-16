import {readFileSync} from 'node:fs'
/** Pure policy validates content; this port treats unreadable/corrupt files as absent.
 * @param {string} path @returns {unknown} */
export function readIntervalCapability(path){try{return JSON.parse(readFileSync(path,'utf8'))}catch{return null}}
