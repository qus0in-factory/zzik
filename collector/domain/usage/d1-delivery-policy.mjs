/** D1 retries deliberately do not reuse provider Retry-After's five-minute minimum. */
/** @param {string|null} value @param {number} nowMs */
export function d1RetryAfterMs(value,nowMs) {
  if(value===null || value.trim()==='')return 0
  const raw=value.trim(),ms=/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-nowMs
  return Number.isSafeInteger(ms)&&ms>0?ms:0
}
/** @param {number} attempts @param {number} random @param {number} retryAfterMs */
export function d1RetryDelay(attempts,random,retryAfterMs) {
  const cap=Math.min(300000,5000*2**Math.min(Math.max(0,attempts),6))
  return Math.max(Math.floor(cap*Math.min(1,Math.max(0,random))),retryAfterMs)
}
