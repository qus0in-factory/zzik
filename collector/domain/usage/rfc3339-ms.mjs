/** RFC3339 expiry to milliseconds. Fractional precision beyond ms is discarded.
 * @param {unknown} value @returns {number|null}
 */
export function rfc3339Ms(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const ms = Date.parse(value.replace(/\.(\d{3})\d+/, '.$1'))
  return Number.isFinite(ms) ? ms : null
}
