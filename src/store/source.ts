// cleanSource (adding rule 6): the address a recipe is compared by. specs/hosting.md#source.
// Follows redirects by hand, then normalizes. Pure apart from the injected fetch.
import { Data, Result } from "effect"

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

// A network error or timeout keeps the last address reached; only an unusable address is refused.
export const cleanSource = async ({
  source,
  fetch = globalThis.fetch,
  budgetMs = redirectBudgetMs,
}: {
  source: string
  fetch?: Fetch
  budgetMs?: number
}): Promise<Result.Result<CleanedSource, InvalidSourceError>> => {
  const first = normalizeSource(source)

  if (Result.isFailure(first)) return first
  let current = new URL(source)
  const signal = AbortSignal.timeout(budgetMs)

  for (let fetches = 0; fetches < maxRedirectFetches; fetches++) {
    let location: string | null

    try {
      const response = await fetch(current.href, { redirect: "manual", signal })
      void response.body?.cancel() // only the status and Location matter

      if (response.status < 300 || response.status >= 400) break // the first non-3xx ends it, whatever its status
      location = response.headers.get("location")
    } catch {
      break
    }

    if (location === null) break
    let next: URL

    try {
      next = new URL(location, current)
    } catch {
      break
    }

    if (next.protocol !== "http:" && next.protocol !== "https:") break
    current = next
  }

  return normalizeSource(current)
}
