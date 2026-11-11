import { Badge } from '@ui/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui/card'
import { Skeleton } from '@ui/components/ui/skeleton'

export default function App() {
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <span className="text-sm font-semibold tracking-tight">zzik</span>
          <Badge variant="secondary">개인 대시보드</Badge>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Hello Young-In</h1>
        <p className="mt-3 text-sm text-muted-foreground">사용량을 한눈에 확인할 공간입니다.</p>
        <section aria-label="사용량 미리보기" className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {['이번 달 사용량', '서비스별 사용량', '사용 한도'].map((title) => (
            <Card key={title} className="min-w-0">
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>데이터 연결 준비 중</CardDescription>
              </CardHeader>
              <CardContent>
                <div aria-hidden="true" className="space-y-3 motion-reduce:[&_*]:animate-none">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <p className="mt-5 text-xs text-muted-foreground">아직 연결된 데이터가 없습니다.</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  )
}
