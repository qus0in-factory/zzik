export interface MeasurementElement {
  selector: string
  scrollWidth: number
  clientWidth: number
  text: string
  lines: number
  height: number
}
export interface MeasurementCase {
  name: string
  width: number
  innerWidth: number
  documentScrollWidth: number
  elements: MeasurementElement[]
}
export function compareCase(before: MeasurementCase, current: MeasurementCase): {
  name: string
  width: number
  newDocumentOverflow: boolean
  newOverflow: MeasurementElement[]
  lineChanges: (MeasurementElement & { beforeLines: number; beforeHeight: number })[]
}
