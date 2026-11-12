import { safeStoreError } from './store-error.mjs'
/** @typedef {import('../../domain/usage/ports.mjs').StoreWriterPort} StoreWriterPort */
/** @param {StoreWriterPort[]} writers @returns {StoreWriterPort} */
export function createFanoutWriter(writers) {
  return {
    async write(value, meta) {
      const failures = []
      for (const writer of writers) {
        try {
          const result = await writer.write(value, meta)
          if (!result.ok) failures.push(result.message)
        } catch (error) { failures.push(safeStoreError(error)) }
      }
      return failures.length ? {ok:false,httpStatus:null,message:failures.join('; ')} : {ok:true}
    },
  }
}
