// 같은 selector가 반복된 이전 측정도 DOM 순서로 각각 짝짓는다.
export function compareCase(before, current) {
  const groups = new Map()
  for (const element of before.elements) {
    const group = groups.get(element.selector) ?? []
    group.push(element)
    groups.set(element.selector, group)
  }
  const seen = new Map(), newOverflow = [], lineChanges = []
  for (const element of current.elements) {
    const index = seen.get(element.selector) ?? 0
    seen.set(element.selector, index + 1)
    const previous = groups.get(element.selector)?.[index]
    if (element.scrollWidth > element.clientWidth && !(previous?.scrollWidth > previous?.clientWidth)) newOverflow.push(element)
    if (element.text && previous?.text === element.text && Math.abs(element.lines - previous.lines) >= 2) lineChanges.push({ ...element, beforeLines: previous.lines, beforeHeight: previous.height })
  }
  return { name: current.name, width: current.width, newDocumentOverflow: current.documentScrollWidth > current.innerWidth && before.documentScrollWidth <= before.innerWidth, newOverflow, lineChanges }
}
