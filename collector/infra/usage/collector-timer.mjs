/** @returns {import('../../domain/usage/scheduler-types.ts').CollectorTimer} */
export function createCollectorTimer(){return {schedule(ms,run){const timer=setTimeout(run,ms);return ()=>clearTimeout(timer)}}}
