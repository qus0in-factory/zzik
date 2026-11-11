import type { ReactNode } from 'react'
import { Card } from '@ui/components/ui/card'
import type { UsageOther } from '@domain/usage/types'

/** 기타 항목: 한도 형태가 아닌 객체·원시값·배열을 보여 준다(D9). */
export function OtherItems({ others }: { others: readonly UsageOther[] }): ReactNode {
  if (others.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">기타 항목</h3>
      <div className="space-y-2">
        {others.map((other) => (
          <Card key={other.id} data-testid="usage-other" className="min-w-0 gap-2 p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <code className="break-all text-xs text-muted-foreground">{other.id}</code>
            </div>
            {'fields' in other.value
              ? (
                  <dl className="space-y-1">
                    {other.value.fields.map((field) => (
                      <div key={field.key} className="flex flex-wrap min-w-0 gap-2 text-sm">
                        <dt className="break-all font-medium">{field.key}</dt>
                        <dd className="break-all text-muted-foreground">{field.text}</dd>
                      </div>
                    ))}
                  </dl>
                )
              : (
                  <p className="break-all text-sm text-muted-foreground">{other.value.text}</p>
                )}
          </Card>
        ))}
      </div>
    </div>
  )
}
