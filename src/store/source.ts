// cleanSource (adding rule 6): the address a recipe is compared by. specs/hosting.md#source.
// Follows redirects by hand, then normalizes. Pure apart from the injected fetch.
import { Data, Effect, Result } from "effect"

export const maxRedirectFetches = 5 // hosting.md#limits-on-free: source cleaning uses at most 5 subrequests
export const redirectBudgetMs = 3000

const trackingParameters = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/i

export class InvalidSourceError extends Data.TaggedError("InvalidSourceError")<{ readonly source: string }> {}

export type CleanedSource = { readonly source: string; readonly sourceKey: string }

// https, lowercase host, no "www.", no fragment, no tracking parameters, no trailing "/".
export const normalizeSource = (address: string | URL): Result.Result<CleanedSource, InvalidSourceError> => {
  let url: URL

  try {
    url = new URL(address)
  } catch {
    return Result.fail(new InvalidSourceError({ source: String(address) }))
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return Result.fail(new InvalidSourceError({ source: String(address) }))
  url.protocol = "https:"
  url.hash = ""
  url.hostname = url.hostname.replace(/^www\./i, "")
  url.pathname = url.pathname.replace(/\/+$/, "")

  const query = url.search
    .slice(1)
    .split("&")
    .filter((pair) => pair !== "" && !trackingParameters.test(decodeURIComponent(pair.split("=")[0]!.replace(/\+/g, " "))))
    .join("&")

  url.search = query === "" ? "" : `?${query}`
  const source = url.href.replace(/\/$/, "") // the root path leaves a "/" after the host

  return Result.succeed({ source, sourceKey: source.slice("https://".length) })
}

type Fetch = (input: string, init: { redirect: "manual"; signal: AbortSignal }) => Promise<Pick<Response, "status" | "headers" | "body">>

// The next address a redirect points to, or undefined when this one is where it ends.
const redirectFrom = ({ current, fetch }: { readonly current: URL; readonly fetch: Fetch }): Effect.Effect<URL | undefined> =>
  Effect.tryPromise((signal) => fetch(current.href, { redirect: "manual", signal })).pipe(
    Effect.map((response) => {
      void response.body?.cancel() // only the status and Location matter

      if (response.status < 300 || response.status >= 400) return undefined // the first non-3xx ends it, whatever its status
      const location = response.headers.get("location")

      if (location === null) return undefined

      try {
        const next = new URL(location, current)

        return next.protocol === "http:" || next.protocol === "https:" ? next : undefined
      } catch {
        return undefined
      }
    }),
    Effect.orElseSucceed(() => undefined),
  )

// A network error or timeout keeps the last address reached; only an unusable address is refused.
export const cleanSource = ({
  source,
  fetch = globalThis.fetch,
  budgetMs = redirectBudgetMs,
}: {
  source: string
  fetch?: Fetch
  budgetMs?: number
}): Effect.Effect<CleanedSource, InvalidSourceError> =>
  Effect.gen(function* () {
    const first = normalizeSource(source)

    if (Result.isFailure(first)) return yield* Effect.fail(first.failure)
    let current = new URL(source)

    const follow = Effect.gen(function* () {
      for (let fetches = 0; fetches < maxRedirectFetches; fetches++) {
        const next = yield* redirectFrom({ current, fetch })

        if (next === undefined) return
        current = next
      }
    })

    yield* follow.pipe(Effect.timeoutOption(budgetMs))
    const cleaned = normalizeSource(current)

    return Result.isFailure(cleaned) ? yield* Effect.fail(cleaned.failure) : cleaned.success
  })
