import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { cleanSource, normalizeSource } from "../../src/store/source.ts"
import { withOptional } from "../../src/domain/with-optional.ts"

const cleaned = (address: string) => {
  const result = normalizeSource(address)

  if (Result.isFailure(result)) throw new Error("expected a clean address")

  return result.success
}

describe("normalizeSource", () => {
  it("drops tracking parameters, fragment, www, and the trailing slash", () => {
    expect(cleaned("http://WWW.Chefkoch.de/rezepte/123/zupfkuchen/?utm_source=instagram&fbclid=x&gclid=y&mc_cid=1&mc_eid=2#top")).toEqual({
      source: "https://chefkoch.de/rezepte/123/zupfkuchen",
      sourceKey: "chefkoch.de/rezepte/123/zupfkuchen",
    })
  })
  it("keeps other parameters, in order, and their encoding", () => {
    expect(cleaned("https://example.com/r?id=1&utm_medium=x&q=a%20b&UTM_Campaign=y").source).toBe("https://example.com/r?id=1&q=a%20b")
  })
  it("treats the same page the same way however it was shared", () => {
    expect(cleaned("https://example.com/").sourceKey).toBe(cleaned("http://www.example.com?utm_source=a#x").sourceKey)
    expect(cleaned("https://example.com").source).toBe("https://example.com")
  })
  it("refuses what is not a web address", () => {
    expect(Result.isFailure(normalizeSource("not a url"))).toBe(true)
    expect(Result.isFailure(normalizeSource("ftp://example.com/a"))).toBe(true)
    expect(Result.isFailure(normalizeSource("javascript:alert(1)"))).toBe(true)
  })
})

type Step = { status: number; location?: string } | "throw"

const fakeFetch = (steps: Record<string, Step>) => {
  const calls: string[] = []

  const fetch = async (input: string) => {
    calls.push(input)
    const step = steps[input]

    if (step === undefined || step === "throw") throw new Error("network")

    return { status: step.status, headers: new Headers(step.location === undefined ? {} : { location: step.location }), body: null }
  }

  return { fetch, calls }
}

const sourceOf = async (address: string, steps: Record<string, Step>, budgetMs?: number) => {
  const { fetch, calls } = fakeFetch(steps)
  const result = await cleanSource(withOptional({ source: address, fetch }, "budgetMs", budgetMs))

  if (Result.isFailure(result)) throw new Error("expected a clean address")

  return { source: result.success.source, calls }
}

describe("cleanSource", () => {
  it("follows redirects by hand, then normalizes the last address", async () => {
    const result = await sourceOf("https://short.example/abc", {
      "https://short.example/abc": { status: 301, location: "https://www.chefkoch.de/rezepte/1/?utm_source=x" },
      "https://www.chefkoch.de/rezepte/1/?utm_source=x": { status: 200 },
    })

    expect(result.source).toBe("https://chefkoch.de/rezepte/1")
    expect(result.calls).toHaveLength(2)
  })
  it("resolves a relative Location", async () => {
    const result = await sourceOf("https://example.com/a", {
      "https://example.com/a": { status: 302, location: "/b/" },
      "https://example.com/b/": { status: 200 },
    })

    expect(result.source).toBe("https://example.com/b")
  })
  it("stops at the first non-3xx, whatever its status", async () => {
    const result = await sourceOf("https://example.com/a", {
      "https://example.com/a": { status: 404, location: "https://example.com/never" },
    })

    expect(result.source).toBe("https://example.com/a")
    expect(result.calls).toHaveLength(1)
  })
  it("makes at most 5 fetches", async () => {
    const steps: Record<string, Step> = {}

    for (let hop = 0; hop < 10; hop++) steps[`https://example.com/${hop}`] = { status: 302, location: `https://example.com/${hop + 1}` }
    const result = await sourceOf("https://example.com/0", steps)
    expect(result.calls).toHaveLength(5)
    expect(result.source).toBe("https://example.com/5")
  })
  it("keeps the last address reached on a network error", async () => {
    const result = await sourceOf("https://example.com/a", {
      "https://example.com/a": { status: 302, location: "https://example.com/b?utm_source=x" },
      "https://example.com/b?utm_source=x": "throw",
    })

    expect(result.source).toBe("https://example.com/b")
  })
  it("keeps the last address reached when the time is up", async () => {
    const fetch = (_: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))

    const result = await cleanSource({ source: "https://www.example.com/slow/", fetch, budgetMs: 20 })
    expect(Result.isSuccess(result) && result.success.source).toBe("https://example.com/slow")
  })
  it("ignores a redirect to something that is not a web address", async () => {
    const result = await sourceOf("https://example.com/a", { "https://example.com/a": { status: 302, location: "mailto:x@example.com" } })
    expect(result.source).toBe("https://example.com/a")
  })
  it("refuses an unusable address without fetching", async () => {
    const { fetch, calls } = fakeFetch({})
    expect(Result.isFailure(await cleanSource({ source: "nope", fetch }))).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
