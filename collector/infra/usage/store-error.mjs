/** Only error codes/names, never driver messages containing connection details.
 * @param {unknown} error @returns {string}
 */
export function safeStoreError(error) {
  if (error === null || typeof error !== 'object') return 'StoreError'
  const object = /** @type {{code?:unknown,name?:unknown}} */ (error)
  if (typeof object.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(object.code)) return object.code
  if (typeof object.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(object.name)) return object.name
  return 'StoreError'
}
