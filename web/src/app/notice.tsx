import type { ReactNode } from "react"

import { Card, CardContent } from "~/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from "~/components/ui/empty"
import { Skeleton } from "~/components/ui/skeleton"

/** A page that can't go on: what happened and what to do next (`Empty role='alert'` in a card). */
export function Problem({ icon, title, next, action }: { icon: ReactNode; title: string; next?: string; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-group">
        <Empty role="alert" size="sm">
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {next !== undefined && <EmptyDescription>{next}</EmptyDescription>}
          {action !== undefined && <EmptyContent>{action}</EmptyContent>}
        </Empty>
      </CardContent>
    </Card>
  )
}

/** A page header and its main button, loading: the title, a line, the button. */
export function QuestionSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-page">
      <div className="flex flex-col gap-related py-1">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <Skeleton className="h-control-lg w-full rounded-control-lg" />
    </div>
  )
}
