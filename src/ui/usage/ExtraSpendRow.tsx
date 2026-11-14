import type { ExtraSpendView } from '@app/usage/extra-spend'
import { Badge } from '@ui/components/ui/badge'
export function ExtraSpendRow({ view }: { view: ExtraSpendView }) {
  return <div data-testid="extra-spend" className="flex min-w-0 flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
    <span className="font-medium">{view.title}</span>
    {view.badges.map(badge => <Badge key={badge.text} variant={badge.danger ? 'destructive' : 'outline'}>{badge.text}</Badge>)}
    <span>{view.detail}</span>
  </div>
}
