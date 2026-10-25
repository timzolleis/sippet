import { IconFingerprint } from "@tabler/icons-react"
import { useState, type ReactNode } from "react"

import { Button } from "~/components/ui/button"

import { isCancel } from "./api"
import { T } from "./strings"

/**
 * The page's one main action, a passkey ceremony (account-ui.md, States):
 * idle → waiting (spinner, "Waiting for your passkey…") → done | idle (cancelled, no message) | idle + one error line.
 * `leaves`: `run` ends by navigating away, so the button stays waiting until the page goes.
 */
export function PasskeyButton({
  label,
  run,
  glyph = true,
  leaves = false,
  secondary,
}: {
  label: string
  run: () => Promise<void>
  glyph?: boolean
  leaves?: boolean
  /** A second action under this one (Deny); the status line goes below both. */
  secondary?: ReactNode
}) {
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle")

  const start = async () => {
    setState("waiting")

    try {
      await run()

      if (!leaves) setState("idle")
    } catch (cause) {
      setState(isCancel(cause) ? "idle" : "failed")
    }
  }

  return (
    <div className="flex flex-col gap-related">
      <Button intent="primary" size="lg" className="w-full" isLoading={state === "waiting"} onClick={() => void start()}>
        {glyph && <IconFingerprint data-icon="inline-start" />}
        {label}
      </Button>
      {secondary}
      <div className="min-h-lh text-center text-body text-pretty">
        <p role="status" className="text-muted-foreground">
          {state === "waiting" ? T.waiting : ""}
        </p>
        <p role="alert" className="text-destructive">
          {state === "failed" ? T.failed : ""}
        </p>
      </div>
    </div>
  )
}
