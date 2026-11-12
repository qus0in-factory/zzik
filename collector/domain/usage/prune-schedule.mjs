/** @param {string|null|undefined} lastPruneAt @param {number} now */
export function shouldPrune(lastPruneAt, now) {
  const previous = lastPruneAt ? Date.parse(lastPruneAt) : NaN
  return !Number.isFinite(previous) || now - previous >= 86_400_000
}
