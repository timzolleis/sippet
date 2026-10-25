import { IconChefHat } from "@tabler/icons-react"
import { StrictMode, useEffect, useRef, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "~/index.css"
import "virtual:theme.css"
import { LocaleProvider } from "~/components/ui/locale"
import { ToastProvider } from "~/components/ui/toast"
import { cn } from "~/lib/utils"

import { labels, lang, locale } from "./strings"

/** Renders a page into `#root` with the providers every page needs. */
export function mount(page: ReactNode): void {
  document.documentElement.lang = lang
  const root = document.getElementById("root")

  if (root === null) return
  createRoot(root).render(
    <StrictMode>
      <LocaleProvider locale={locale} labels={labels}>
        {page}
        <ToastProvider />
      </LocaleProvider>
    </StrictMode>,
  )
}

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-related text-body font-semibold">
      <span aria-hidden className="flex size-control-sm items-center justify-center rounded-control-sm bg-primary-solid text-primary-solid-foreground">
        <IconChefHat className="size-icon" />
      </span>
      Sippet
    </span>
  )
}

/**
 * The page: the wordmark on top, one column below it. `narrow` for a single question (join, connect, sign in),
 * `wide` for the account's cards.
 */
export function Frame({ width, actions, children }: { width: "narrow" | "wide"; actions?: ReactNode; children: ReactNode }) {
  const column = width === "narrow" ? "max-w-sm" : "max-w-xl"

  return (
    <div className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
      <header className={cn("mx-auto flex h-16 w-full shrink-0 items-center justify-between gap-group px-5", column)}>
        <Wordmark />
        {actions}
      </header>
      <main className={cn("mx-auto flex w-full flex-col gap-page px-5 pt-8 pb-28 sm:pt-16", column)}>{children}</main>
    </div>
  )
}

/**
 * The page header: title and an optional line under it. Moves focus to the title when a later view replaces the first
 * one, so a screen reader hears the new screen.
 */
export function PageHeader({ title, description, focus = false }: { title: string; description?: ReactNode; focus?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = `${title} · Sippet`

    if (focus) heading.current?.focus()
  }, [title, focus])

  return (
    <hgroup className="flex flex-col gap-tight">
      <h1 ref={heading} tabIndex={-1} className="text-title text-balance outline-none">
        {title}
      </h1>
      {description !== undefined && <p className="text-body text-pretty text-muted-foreground">{description}</p>}
    </hgroup>
  )
}
