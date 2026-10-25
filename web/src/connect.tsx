import { IconArrowBackUp, IconCheck, IconPlugOff } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { FadeIn } from "~/components/ui/fade-in"
import { Item, ItemContent, ItemDescription, ItemList, ItemMedia, ItemTitle } from "~/components/ui/item"

import { clientName, consent, currentUser, signedQuery, signInWithPasskey } from "./app/api"
import { Frame, mount, PageHeader } from "./app/frame"
import { Problem, QuestionSkeleton } from "./app/notice"
import { PasskeyButton } from "./app/passkey-button"
import { T } from "./app/strings"

// Better Auth's loginPage and consentPage (account-ui.md, /connect): the authorize query plus its signature.
const params = new URLSearchParams(location.search)
const oauthQuery = signedQuery(params)

interface ConsentRequest {
  readonly client: string
  readonly redirect: URL
  readonly signedIn: boolean
}

type Load = { readonly kind: "loading" } | { readonly kind: "ready"; readonly request: ConsentRequest } | { readonly kind: "dead" }

async function loadRequest(): Promise<ConsentRequest> {
  // `redirect_uri` is in the signed query; a missing one throws here, like an unknown client.
  const redirect = new URL(params.get("redirect_uri") ?? "")
  const [client, user] = await Promise.all([clientName(params.get("client_id"), oauthQuery), currentUser()])

  return { client, redirect, signedIn: user !== undefined }
}

/** Claude Code redirects to a loopback address; claude.ai to its own host. */
const isWeb = (redirect: URL): boolean =>
  /^https?:$/.test(redirect.protocol) && !/^(localhost|\[::1\]|127(\.\d+){3})$/.test(redirect.hostname)

// The consent endpoint needs a session, so a refusal is the plain error redirect (account-ui.md, Verified 3).
function deny(redirect: URL): void {
  const target = new URL(redirect)
  target.searchParams.set("error", "access_denied")
  const state = params.get("state")

  if (state !== null) target.searchParams.set("state", state)
  target.searchParams.set("iss", location.origin) // Better Auth advertises the iss parameter (RFC 9207)
  location.assign(target)
}

function Approve({ request }: { request: ConsentRequest }) {
  // Once signed in, a retry after a failed consent goes straight to consent.
  const signedIn = useRef(request.signedIn)
  const [leaving, setLeaving] = useState(false)

  const allow = async () => {
    if (!signedIn.current) await signInWithPasskey()
    signedIn.current = true
    location.assign(await consent(oauthQuery))
  }

  return (
    <FadeIn className="flex flex-col gap-page">
      <PageHeader
        title={T.wants(request.client)}
        description={isWeb(request.redirect) ? T.backTo(request.redirect.host) : T.backLocal}
      />
      <Card>
        <CardContent className="overflow-hidden">
          <ItemList>
            {[T.perm1, T.perm2].map((permission) => (
              <Item key={permission}>
                <ItemMedia className="text-success">
                  <IconCheck className="size-icon" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-normal whitespace-normal">{permission}</ItemTitle>
                </ItemContent>
              </Item>
            ))}
            <Item>
              <ItemMedia className="text-muted-foreground">
                <IconArrowBackUp className="size-icon" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="font-normal whitespace-normal">{T.undoable}</ItemTitle>
                <ItemDescription>{T.undoableLimits}</ItemDescription>
              </ItemContent>
            </Item>
          </ItemList>
        </CardContent>
      </Card>
      <PasskeyButton
        label={request.signedIn ? T.allow : T.allowPasskey}
        glyph={!request.signedIn}
        leaves
        run={allow}
        secondary={
          <Button
            emphasis="ghost"
            size="lg"
            className="w-full"
            isLoading={leaving}
            onClick={() => {
              setLeaving(true)
              deny(request.redirect)
            }}
          >
            {T.deny}
          </Button>
        }
      />
    </FadeIn>
  )
}

function Connect() {
  const [load, setLoad] = useState<Load>({ kind: "loading" })

  useEffect(() => {
    loadRequest().then(
      (request) => setLoad({ kind: "ready", request }),
      () => setLoad({ kind: "dead" }),
    )
  }, [])

  return (
    <Frame width="narrow">
      {load.kind === "loading" && <QuestionSkeleton />}
      {load.kind === "dead" && <Problem icon={<IconPlugOff />} title={T.requestDead} next={T.requestDeadNext} />}
      {load.kind === "ready" && <Approve request={load.request} />}
    </Frame>
  )
}

mount(<Connect />)
