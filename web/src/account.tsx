import { IconCloudOff, IconDots, IconKey, IconLogout, IconPencil, IconPlugConnected, IconPlus, IconTrash } from "@tabler/icons-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import { CopyButton } from "~/components/ui/copy-button"
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyMedia, EmptyTitle } from "~/components/ui/empty"
import { FadeIn } from "~/components/ui/fade-in"
import { Field, FieldLabel } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemList, ItemListSkeleton, ItemMedia, ItemTitle } from "~/components/ui/item"
import { Skeleton } from "~/components/ui/skeleton"
import { toast } from "~/components/ui/toast"

import {
  currentUser,
  disconnect,
  isCancel,
  listConnections,
  listPasskeys,
  registerPasskey,
  removePasskey,
  renamePasskey,
  signInWithPasskey,
  signOut,
  type Connection,
  type Passkey,
} from "./app/api"
import { Frame, mount, PageHeader } from "./app/frame"
import { Problem } from "./app/notice"
import { PasskeyButton } from "./app/passkey-button"
import { formatDate, T } from "./app/strings"

const MCP_URL = `${location.origin}/mcp`

type Loaded<A> = { readonly kind: "loading" } | { readonly kind: "ready"; readonly value: A } | { readonly kind: "failed" }

/** Loads once on mount; `reload` refetches and keeps what's on screen until the answer is in. */
function useLoaded<A>(load: () => Promise<A>): [Loaded<A>, () => Promise<void>] {
  const [state, setState] = useState<Loaded<A>>({ kind: "loading" })

  const reload = useCallback(
    () =>
      load().then(
        (value) => setState({ kind: "ready", value }),
        () => setState({ kind: "failed" }),
      ),
    [load],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return [state, reload]
}

/** A list that didn't load: what happened, and a retry. */
function ListFailed({ retry }: { retry: () => void }) {
  return (
    <Empty role="alert" size="sm">
      <EmptyMedia variant="icon">
        <IconCloudOff />
      </EmptyMedia>
      <EmptyTitle>{T.failedTitle}</EmptyTitle>
      <EmptyContent>
        <Button onClick={retry}>{T.tryAgain}</Button>
      </EmptyContent>
    </Empty>
  )
}

// ── Connect Claude ──────────────────────────────────────────────────────────

function ConnectClaude() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{T.connectClaude}</CardTitle>
        <CardDescription>{T.connectHelp}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-group gap-y-part p-card">
        <code className="min-w-0 font-mono text-body break-all">{MCP_URL}</code>
        <CopyButton value={MCP_URL} emphasis="raised" size="sm">
          {(copied) => (copied ? T.copied : T.copy)}
        </CopyButton>
      </CardContent>
    </Card>
  )
}

// ── Connections (account rules 4, 5) ────────────────────────────────────────

function DisconnectButton({ connection, done }: { connection: Connection; done: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const confirm = async () => {
    setPending(true)

    try {
      await disconnect(connection.clientId)
      await done()
      setOpen(false)
      toast.success(T.disconnected(connection.name))
    } catch {
      toast.error(T.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button intent="destructive" emphasis="subtle" size="sm" aria-label={`${T.disconnect} ${connection.name}`} />}
      >
        {T.disconnect}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{T.disconnectAsk(connection.name)}</AlertDialogTitle>
          <AlertDialogDescription>{T.disconnectKeeps}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
          <AlertDialogAction intent="destructive" isLoading={pending} onClick={() => void confirm()}>
            {T.disconnect}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Connections() {
  const [connections, reload] = useLoaded(listConnections)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{T.connections}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-hidden" aria-busy={connections.kind === "loading"}>
        {connections.kind === "loading" && <ItemListSkeleton rows={1} media="icon" />}
        {connections.kind === "failed" && <ListFailed retry={() => void reload()} />}
        {connections.kind === "ready" && connections.value.length === 0 && (
          <Empty size="sm">
            <EmptyMedia />
            <EmptyTitle>{T.none}</EmptyTitle>
          </Empty>
        )}
        {connections.kind === "ready" && connections.value.length > 0 && (
          <FadeIn>
            <ItemList aria-label={T.connections}>
              {connections.value.map((connection) => (
                <Item key={connection.clientId}>
                  <ItemMedia variant="icon" className="max-sm:hidden">
                    <IconPlugConnected />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{connection.name}</ItemTitle>
                    <ItemDescription>{T.connectedOn(formatDate(connection.connectedAt))}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <DisconnectButton connection={connection} done={reload} />
                  </ItemActions>
                </Item>
              ))}
            </ItemList>
          </FadeIn>
        )}
      </CardContent>
    </Card>
  )
}

// ── Passkeys (account rules 2, 3) ───────────────────────────────────────────

function RenameDialog({
  passkey,
  name,
  open,
  setOpen,
  done,
}: {
  passkey: Passkey
  name: string
  open: boolean
  setOpen: (open: boolean) => void
  done: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = String(new FormData(event.currentTarget).get("name") ?? "").trim()

    if (!next || next === name) return setOpen(false)
    setPending(true)

    try {
      await renamePasskey(passkey.id, next)
      await done()
      setOpen(false)
      toast.success(T.renamed)
    } catch {
      toast.error(T.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{T.renameTitle}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={(event) => void save(event)} className="contents">
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="passkey-name">{T.name}</FieldLabel>
              <Input id="passkey-name" name="name" defaultValue={name} autoComplete="off" autoFocus onFocus={(event) => event.currentTarget.select()} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>{T.cancel}</DialogClose>
            <Button type="submit" intent="primary" isLoading={pending}>
              {T.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RemoveDialog({
  passkey,
  name,
  open,
  setOpen,
  done,
}: {
  passkey: Passkey
  name: string
  open: boolean
  setOpen: (open: boolean) => void
  done: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)

  const confirm = async () => {
    setPending(true)

    try {
      await removePasskey(passkey.id)
      await done()
      setOpen(false)
      toast.success(T.removed(name))
    } catch {
      toast.error(T.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{T.removeAsk(name)}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
          <AlertDialogAction intent="destructive" isLoading={pending} onClick={() => void confirm()}>
            {T.remove}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function PasskeyRow({ passkey, removable, done }: { passkey: Passkey; removable: boolean; done: () => Promise<void> }) {
  const name = passkey.name || "Passkey"
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)

  return (
    <Item>
      <ItemMedia variant="icon" className="max-sm:hidden">
        <IconKey />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{name}</ItemTitle>
        <ItemDescription>{T.addedOn(formatDate(passkey.createdAt))}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button emphasis="ghost" size="icon-sm" aria-label={T.actionsFor(name)} />}>
            <IconDots />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <IconPencil />
              {T.rename}…
            </DropdownMenuItem>
            {removable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem intent="destructive" onClick={() => setRemoving(true)}>
                  <IconTrash />
                  {T.remove}…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <RenameDialog passkey={passkey} name={name} open={renaming} setOpen={setRenaming} done={done} />
        {removable && <RemoveDialog passkey={passkey} name={name} open={removing} setOpen={setRemoving} done={done} />}
      </ItemActions>
    </Item>
  )
}

function AddPasskey({ done }: { done: () => Promise<void> }) {
  const [pending, setPending] = useState(false)

  const add = async () => {
    setPending(true)

    try {
      await registerPasskey()
      await done()
      toast.success(T.added)
    } catch (cause) {
      if (!isCancel(cause)) toast.error(T.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <Button size="sm" isLoading={pending} onClick={() => void add()}>
      <IconPlus data-icon="inline-start" />
      {T.add}
    </Button>
  )
}

function Passkeys() {
  const [passkeys, reload] = useLoaded(listPasskeys)
  const only = passkeys.kind === "ready" && passkeys.value.length === 1

  return (
    <Card>
      <CardHeader actions={<AddPasskey done={reload} />}>
        <CardTitle>{T.passkeys}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-hidden" aria-busy={passkeys.kind === "loading"}>
        {passkeys.kind === "loading" && <ItemListSkeleton rows={1} media="icon" />}
        {passkeys.kind === "failed" && <ListFailed retry={() => void reload()} />}
        {passkeys.kind === "ready" && (
          <FadeIn>
            <ItemList aria-label={T.passkeys}>
              {passkeys.value.map((passkey) => (
                <PasskeyRow key={passkey.id} passkey={passkey} removable={passkeys.value.length > 1} done={reload} />
              ))}
            </ItemList>
          </FadeIn>
        )}
      </CardContent>
      {/* account rule 3: in place of Remove */}
      <CardFooter show={only}>
        <p className="text-body text-pretty text-muted-foreground">{T.onlyOne}</p>
      </CardFooter>
    </Card>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function SignOut({ done }: { done: () => void }) {
  const [pending, setPending] = useState(false)

  return (
    <Button
      emphasis="ghost"
      size="sm"
      // The label, not the ghost fill, ends on the column's edge.
      className="-me-(--spacing-control-pad-sm)"
      isLoading={pending}
      onClick={() => {
        setPending(true)
        signOut()
          .catch(() => undefined)
          .finally(done)
      }}
    >
      <IconLogout data-icon="inline-start" />
      {T.signOut}
    </Button>
  )
}

// `focus`: a later screen moves focus to its title, so a screen reader hears the change.
type Session =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "out"; readonly focus: boolean }
  | { readonly kind: "in"; readonly focus: boolean }

function Account() {
  const [session, setSession] = useState<Session>({ kind: "loading" })

  const check = useCallback(
    (focus: boolean) =>
      currentUser().then(
        (user) => setSession({ kind: user === undefined ? "out" : "in", focus }),
        () => setSession({ kind: "failed" }),
      ),
    [],
  )

  useEffect(() => {
    void check(false)
  }, [check])

  if (session.kind === "loading") {
    return (
      <Frame width="wide">
        <div aria-busy="true" className="flex flex-col gap-page">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </Frame>
    )
  }

  if (session.kind === "failed") {
    return (
      <Frame width="narrow">
        <Problem icon={<IconCloudOff />} title={T.failedTitle} action={<Button onClick={() => void check(true)}>{T.tryAgain}</Button>} />
      </Frame>
    )
  }

  if (session.kind === "out") {
    return (
      <Frame width="narrow">
        <FadeIn className="flex flex-col gap-page">
          <PageHeader title={T.signInTitle} focus={session.focus} />
          <PasskeyButton
            label={T.signIn}
            run={async () => {
              await signInWithPasskey()
              await check(true)
            }}
          />
        </FadeIn>
      </Frame>
    )
  }

  return (
    <Frame width="wide" actions={<SignOut done={() => setSession({ kind: "out", focus: true })} />}>
      <FadeIn className="flex flex-col gap-page">
        <PageHeader title={T.account} focus={session.focus} />
        <div className="flex flex-col gap-group">
          <ConnectClaude />
          <Connections />
          <Passkeys />
        </div>
      </FadeIn>
    </Frame>
  )
}

mount(<Account />)
