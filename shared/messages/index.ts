import { ko } from './ko'

/** 메시지 키. 없는 키를 쓰면 타입 오류다. */
export type MessageKey = keyof typeof ko

/** 값 문자열의 `{이름}` 자리에서 이름들을 뽑는다. */
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never

/** 매개변수가 필요 없는 문구는 인자 없이, 있는 문구는 모든 자리 이름을 채운 객체를 요구한다. */
type MessageArgs<K extends MessageKey> = [Placeholders<(typeof ko)[K]>] extends [never]
  ? []
  : [params: { [Name in Placeholders<(typeof ko)[K]>]: string | number }]

/** 문구를 가져온다: `t('card.elapsed', { percent: 56 })`. 키·매개변수 누락은 타입 오류다. */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  const params = (args[0] ?? {}) as Record<string, string | number>
  const template = (ko as Record<string, string>)[key] ?? key // 타입 검사를 우회한 호출(any)에서도 던지지 않고 키를 그대로 보여 준다
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? `{${name}}`))
}

export { ko }
