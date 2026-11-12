/** @param {{status:string,rawSha256:string|null}|null} previous @param {{status:string,rawSha256:string|null}} current */
export function snapshotChanged(previous, current) {
  return previous === null || previous.status !== current.status || previous.rawSha256 !== current.rawSha256
}
