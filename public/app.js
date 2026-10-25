"use strict";
// Shared helpers, strings and the three pages. See specs/account-ui.md.

const lang = /^de/i.test(navigator.language) ? "de" : "en";
document.documentElement.lang = lang;

const STR = {
  de: {
    waiting: "Warte auf deinen Passkey…",
    failed: "Das hat nicht geklappt. Versuche es noch einmal.",
    unsupported: "Dein Browser unterstützt diesen Passkey-Ablauf nicht. Aktualisiere ihn und versuche es noch einmal.",
    welcome: (n) => `Willkommen, ${n}`,
    joinBody: "Sippet bewahrt deine Rezepte. Du meldest dich mit einem Passkey an, ohne Passwort.",
    create: "Passkey erstellen",
    inviteDead: "Diese Einladung gilt nicht mehr. Bitte um eine neue.",
    requestDead: "Diese Anfrage gilt nicht mehr. Starte die Verbindung in Claude neu.",
    wants: (n) => `${n} möchte deine Rezepte verwenden`,
    backTo: (h) => `zurück zu ${h}`,
    backLocal: "zurück zu einem Programm auf diesem Computer",
    perm1: "Rezepte lesen, hinzufügen und ändern",
    perm2: "Tags und Sammlungen ordnen",
    undoable: "Alles bleibt rückgängig zu machen. Den Papierkorb leeren oder dein Konto ändern kann Claude nicht.",
    allowPasskey: "Mit Passkey erlauben",
    allow: "Erlauben",
    deny: "Ablehnen",
    signInTitle: "Bei Sippet anmelden",
    signIn: "Mit Passkey anmelden",
    account: "Konto",
    connectClaude: "Claude verbinden",
    connectHelp: "Füge in Claude einen eigenen Connector mit dieser Adresse hinzu",
    copy: "Kopieren",
    copied: "Kopiert",
    connections: "Verbindungen",
    none: "Noch nichts verbunden.",
    connectedOn: (d) => `verbunden am ${d}`,
    disconnect: "Trennen",
    disconnectAsk: (n) => `${n} trennen? Seine Änderungen bleiben.`,
    cancel: "Abbrechen",
    passkeys: "Passkeys",
    addedOn: (d) => `hinzugefügt am ${d}`,
    unnamed: "Passkey",
    rename: "Umbenennen",
    save: "Speichern",
    nameLabel: "Name des Passkeys",
    remove: "Entfernen",
    removeAsk: (n) => `${n} entfernen?`,
    onlyOne: "Dein einziger Passkey kann nicht entfernt werden.",
    add: "Passkey hinzufügen",
    signOut: "Abmelden",
  },
  en: {
    waiting: "Waiting for your passkey…",
    failed: "That didn't work. Try again.",
    unsupported: "Your browser doesn't support this passkey flow. Update it and try again.",
    welcome: (n) => `Welcome, ${n}`,
    joinBody: "Sippet keeps your recipes. You sign in with a passkey, no password.",
    create: "Create passkey",
    inviteDead: "This invitation is no longer valid. Ask for a new one.",
    requestDead: "This request is no longer valid. Start the connection again in Claude.",
    wants: (n) => `${n} wants to use your recipes`,
    backTo: (h) => `back to ${h}`,
    backLocal: "back to a program on this computer",
    perm1: "Read, add, and change recipes",
    perm2: "Organize tags and collections",
    undoable: "Everything stays undoable. Claude can't empty the trash or change your account.",
    allowPasskey: "Allow with passkey",
    allow: "Allow",
    deny: "Deny",
    signInTitle: "Sign in to Sippet",
    signIn: "Sign in with passkey",
    account: "Account",
    connectClaude: "Connect Claude",
    connectHelp: "In Claude, add a custom connector with this address",
    copy: "Copy",
    copied: "Copied",
    connections: "Connections",
    none: "Nothing connected yet.",
    connectedOn: (d) => `connected ${d}`,
    disconnect: "Disconnect",
    disconnectAsk: (n) => `Disconnect ${n}? Its changes stay.`,
    cancel: "Cancel",
    passkeys: "Passkeys",
    addedOn: (d) => `added ${d}`,
    unnamed: "Passkey",
    rename: "Rename",
    save: "Save",
    nameLabel: "Passkey name",
    remove: "Remove",
    removeAsk: (n) => `Remove ${n}?`,
    onlyOne: "Your only passkey can't be removed.",
    add: "Add passkey",
    signOut: "Sign out",
  },
};
const T = STR[lang];

const MCP_URL = "https://sippet.bastelboxx.de/mcp";

// ---- DOM ----

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
function icon(...paths) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}
const glyph = () => icon("M13 7.5a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z", "M3 20c0-3 2.7-5.2 6-5.2 1 0 2 .2 2.8.6", "M18 12.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z", "M18 17.5V22M18 20h2.5");
const spinner = () => {
  const s = icon("M12 3a9 9 0 1 0 9 9");
  s.classList.add("spin");
  return s;
};
const check = () => icon("M5 12.5l4.5 4.5L19 7.5");

const app = document.getElementById("app");
const foot = document.getElementById("foot");

function view(...nodes) {
  app.replaceChildren(...nodes);
  const t = app.querySelector("h1");
  if (t && document.body.dataset.ready) {
    t.tabIndex = -1;
    t.focus({ preventScroll: true });
  }
  document.body.dataset.ready = "1";
}

function title(text) {
  document.title = `${text} · Sippet`;
  return h("h1", {}, text);
}

// ---- fetch ----

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- WebAuthn ----

const cancelled = () => Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
const isCancel = (e) => e && (e.name === "NotAllowedError" || e.name === "AbortError");

function needWebAuthn() {
  if (!window.PublicKeyCredential?.parseCreationOptionsFromJSON) {
    throw Object.assign(new Error("unsupported"), { text: T.unsupported });
  }
}

// registration; `query` is e.g. "?context=<token>"
async function registerPasskey({ query = "", createSession = false } = {}) {
  needWebAuthn();
  const options = await api(`/auth/passkey/generate-register-options${query}`);
  const cred = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  if (!cred) throw cancelled();
  await api("/auth/passkey/verify-registration", {
    method: "POST",
    body: { response: cred.toJSON(), ...(createSession && { createSession: true }) },
  });
}

async function signInWithPasskey() {
  needWebAuthn();
  const options = await api("/auth/passkey/generate-authenticate-options");
  const cred = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  if (!cred) throw cancelled();
  await api("/auth/passkey/verify-authentication", { method: "POST", body: { response: cred.toJSON() } });
}

// idle → waiting → done | idle | idle + error (specs/account-ui.md#states)
// `run` returns normally when the next screen takes over; the button then stays in "waiting".
function passkeyButton(label, run, { withGlyph = true } = {}) {
  const error = h("p", { class: "err", role: "alert" });
  let mark = withGlyph ? glyph() : null;
  const text = h("span", {}, label);
  const button = h("button", { class: "btn primary", type: "button" }, mark, text);
  button.addEventListener("click", async () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    button.setAttribute("aria-disabled", "true");
    error.textContent = "";
    text.textContent = T.waiting;
    const spin = spinner();
    mark ? mark.replaceWith(spin) : button.prepend(spin);
    try {
      await run();
    } catch (e) {
      if (!isCancel(e)) error.textContent = e.text || T.failed;
      spin.replaceWith((mark = withGlyph ? glyph() : null) ?? "");
      text.textContent = label;
      button.removeAttribute("aria-disabled");
    }
  });
  return h("div", { class: "stack" }, button, error);
}

// ---- helpers ----

const fmtDate = (v) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(v));

const isLoopback = (host) => host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);

// ---- /join ----

async function join() {
  const token = decodeURIComponent(location.hash.slice(1));
  let name;
  try {
    ({ name } = await api(`/invitation?token=${encodeURIComponent(token)}`));
  } catch {
    return view(h("p", { class: "body", role: "alert" }, T.inviteDead));
  }
  view(
    title(T.welcome(name)),
    h("p", { class: "body" }, T.joinBody),
    passkeyButton(T.create, async () => {
      await registerPasskey({ query: `?context=${encodeURIComponent(token)}`, createSession: true });
      location.assign("/account");
    }),
  );
}

// ---- /connect ----

// The signed part of the query Better Auth sent: what its oauth_query body field expects.
function signedQuery(search) {
  const all = new URLSearchParams(search);
  if (!all.has("sig")) return null;
  const names = new Set(all.getAll("ba_param"));
  if (!names.size) return null;
  const out = new URLSearchParams();
  for (const [k, v] of all) if (k === "sig" || k === "ba_param" || names.has(k)) out.append(k, v);
  return out.toString();
}

async function currentSession() {
  return (await api("/auth/get-session"))?.user ?? null;
}

async function connect() {
  const dead = () => view(h("p", { class: "body", role: "alert" }, T.requestDead));
  const oauthQuery = signedQuery(location.search);
  const params = new URLSearchParams(location.search);
  const clientId = params.get("client_id");
  let redirect;
  try {
    redirect = new URL(params.get("redirect_uri"));
  } catch {
    return dead();
  }
  if (!oauthQuery || !clientId) return dead();

  let client, user;
  try {
    [client, user] = await Promise.all([
      api("/auth/oauth2/public-client-prelogin", {
        method: "POST",
        body: { client_id: clientId, oauth_query: oauthQuery },
      }),
      currentSession(),
    ]);
  } catch {
    return dead();
  }

  const web = redirect.protocol === "https:" || redirect.protocol === "http:";
  const back = web && !isLoopback(redirect.hostname) ? T.backTo(redirect.host) : T.backLocal;
  let signedIn = !!user;

  const finish = (url) => location.assign(url);
  const allow = passkeyButton(
    signedIn ? T.allow : T.allowPasskey,
    async () => {
      if (!signedIn) {
        await signInWithPasskey();
        signedIn = true;
      }
      const { url } = await api("/auth/oauth2/consent", { method: "POST", body: { accept: true, oauth_query: oauthQuery } });
      finish(url);
    },
    { withGlyph: !signedIn },
  );
  const deny = h("button", {
    class: "btn plain",
    type: "button",
    onclick() {
      // the consent endpoint needs a session; a refusal is just the error redirect
      const to = new URL(redirect);
      to.searchParams.set("error", "access_denied");
      if (params.get("state")) to.searchParams.set("state", params.get("state"));
      finish(to.toString());
    },
  }, T.deny);

  view(
    h("div", { class: "stack" }, title(T.wants(client.client_name || client.name || "Claude")), h("p", { class: "sec" }, back)),
    h("ul", { class: "perms stack" },
      h("li", {}, check(), h("span", {}, T.perm1)),
      h("li", {}, check(), h("span", {}, T.perm2)),
    ),
    h("p", { class: "sec" }, T.undoable),
    h("div", { class: "stack" }, allow, deny),
  );
}

// ---- /account ----

async function account() {
  let user;
  try {
    user = await currentSession();
  } catch {
    return view(h("p", { class: "err", role: "alert" }, T.failed));
  }
  if (!user) return signedOut();
  foot.replaceChildren(
    h("button", {
      class: "btn plain",
      type: "button",
      async onclick() {
        try {
          await api("/auth/sign-out", { method: "POST", body: {} });
        } catch {
          return;
        }
        foot.replaceChildren();
        signedOut();
      },
    }, T.signOut),
  );
  const connections = h("div", { class: "group" }, h("h2", {}, T.connections));
  const passkeys = h("div", { class: "group" }, h("h2", {}, T.passkeys));
  view(
    title(T.account),
    group(T.connectClaude, h("p", { class: "sec" }, T.connectHelp), address()),
    connections,
    passkeys,
  );
  loadConnections(connections);
  loadPasskeys(passkeys);
}

function signedOut() {
  view(
    title(T.signInTitle),
    passkeyButton(T.signIn, async () => {
      await signInWithPasskey();
      account();
    }),
  );
}

function group(heading, ...kids) {
  return h("div", { class: "group" }, h("h2", {}, heading), ...kids);
}

function address() {
  const label = h("span", {}, T.copy);
  const button = h("button", {
    class: "link",
    type: "button",
    async onclick() {
      try {
        await navigator.clipboard.writeText(MCP_URL);
      } catch {
        return;
      }
      label.textContent = T.copied;
      setTimeout(() => (label.textContent = T.copy), 2000);
    },
  }, label);
  return h("div", { class: "addr" }, h("code", {}, MCP_URL), h("span", { "aria-live": "polite" }, button));
}

// A row with an inline confirmation: `ask` text, a danger button, a cancel button.
function confirmRow({ row, trigger, ask, confirmLabel, onConfirm, error }) {
  const before = [...row.childNodes];
  const cancel = h("button", {
    class: "link",
    type: "button",
    onclick() {
      row.replaceChildren(...before);
      trigger.focus();
    },
  }, T.cancel);
  const go = h("button", {
    class: "link danger",
    type: "button",
    async onclick() {
      try {
        await onConfirm();
      } catch (e) {
        error.textContent = e.text || T.failed;
        row.replaceChildren(...before);
      }
    },
  }, confirmLabel);
  row.replaceChildren(h("p", { class: "ask", role: "alert" }, ask), h("div", { class: "acts" }, go, cancel));
  go.focus();
}

async function loadConnections(box) {
  const error = h("p", { class: "err", role: "alert" });
  let list;
  try {
    list = await api("/connections");
  } catch {
    error.textContent = T.failed;
    return box.replaceChildren(box.firstChild, error);
  }
  const rows = list.map((c) => {
    const row = h("li", { class: "row" });
    const trigger = h("button", { class: "link danger", type: "button" }, T.disconnect);
    trigger.addEventListener("click", () =>
      confirmRow({
        row, trigger, error,
        ask: T.disconnectAsk(c.name),
        confirmLabel: T.disconnect,
        onConfirm: async () => {
          await api(`/connections/${encodeURIComponent(c.clientId)}/disconnect`, { method: "POST" });
          loadConnections(box);
        },
      }));
    row.append(
      h("div", { class: "main" }, h("span", { class: "name" }, c.name), h("span", { class: "meta" }, T.connectedOn(fmtDate(c.connectedAt)))),
      h("div", { class: "acts" }, trigger),
    );
    return row;
  });
  box.replaceChildren(box.firstChild, rows.length ? h("ul", {}, rows) : h("p", { class: "sec" }, T.none), error);
}

async function loadPasskeys(box) {
  const error = h("p", { class: "err", role: "alert" });
  let list;
  try {
    list = await api("/auth/passkey/list-user-passkeys");
  } catch {
    error.textContent = T.failed;
    return box.replaceChildren(box.firstChild, error);
  }
  const reload = () => loadPasskeys(box);
  const rows = list.map((p) => {
    const label = p.name || T.unnamed;
    const row = h("li", { class: "row" });
    const rename = h("button", { class: "link", type: "button" }, T.rename);
    rename.addEventListener("click", () => renameRow({ row, p, label, rename, error, reload }));
    const remove = h("button", { class: "link danger", type: "button" }, T.remove);
    remove.addEventListener("click", () =>
      confirmRow({
        row, trigger: remove, error,
        ask: T.removeAsk(label),
        confirmLabel: T.remove,
        onConfirm: async () => {
          await api("/auth/passkey/delete-passkey", { method: "POST", body: { id: p.id } });
          reload();
        },
      }));
    row.append(
      h("div", { class: "main" }, h("span", { class: "name" }, label), h("span", { class: "meta" }, T.addedOn(fmtDate(p.createdAt)))),
      h("div", { class: "acts" }, rename, list.length > 1 && remove),
      list.length === 1 && h("p", { class: "meta ask" }, T.onlyOne),
    );
    return row;
  });
  const add = passkeyButton(T.add, async () => {
    await registerPasskey();
    reload();
  });
  box.replaceChildren(box.firstChild, h("ul", {}, rows), error, add);
}

function renameRow({ row, p, label, rename, error, reload }) {
  const before = [...row.childNodes];
  const input = h("input", { type: "text", value: label, "aria-label": T.nameLabel, autocomplete: "off", maxlength: "60" });
  const save = async () => {
    const name = input.value.trim();
    if (!name || name === label) return back();
    try {
      await api("/auth/passkey/update-passkey", { method: "POST", body: { id: p.id, name } });
      reload();
    } catch {
      error.textContent = T.failed;
      back();
    }
  };
  const back = () => {
    row.replaceChildren(...before);
    rename.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") back();
  });
  row.replaceChildren(
    input,
    h("div", { class: "acts" }, h("button", { class: "link", type: "button", onclick: save }, T.save), h("button", { class: "link", type: "button", onclick: back }, T.cancel)),
  );
  input.focus();
  input.select();
}

// ---- start ----

({ join, connect, account })[document.body.dataset.page]();
