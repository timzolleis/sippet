import { IconTicketOff } from "@tabler/icons-react"
import { useEffect, useState } from "react"

import { FadeIn } from "~/components/ui/fade-in"

import { invitationName, registerPasskey } from "./app/api"
import { Frame, mount, PageHeader } from "./app/frame"
import { Problem, QuestionSkeleton } from "./app/notice"
import { PasskeyButton } from "./app/passkey-button"
import { T } from "./app/strings"

// The token is in the fragment, so it never reaches a server log.
const token = decodeURIComponent(location.hash.slice(1))

type Invitation = { readonly kind: "loading" } | { readonly kind: "open"; readonly name: string } | { readonly kind: "dead" }

function Join() {
  const [invitation, setInvitation] = useState<Invitation>({ kind: "loading" })

  useEffect(() => {
    invitationName(token).then(
      (name) => setInvitation({ kind: "open", name }),
      () => setInvitation({ kind: "dead" }),
    )
  }, [])

  return (
    <Frame width="narrow">
      {invitation.kind === "loading" && <QuestionSkeleton />}
      {invitation.kind === "dead" && <Problem icon={<IconTicketOff />} title={T.inviteDead} next={T.inviteDeadNext} />}
      {invitation.kind === "open" && (
        <FadeIn className="flex flex-col gap-page">
          <PageHeader title={T.welcome(invitation.name)} description={T.joinBody} />
          <PasskeyButton
            label={T.create}
            leaves
            run={async () => {
              await registerPasskey(`?context=${encodeURIComponent(token)}`, true)
              location.assign("/account")
            }}
          />
        </FadeIn>
      )}
    </Frame>
  )
}

mount(<Join />)
