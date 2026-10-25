"use strict";

const lang = /^de/i.test(navigator.language) ? "de" : "en";
document.documentElement.lang = lang;

const STR = {
  de: {
    waiting: "Warte auf deinen Passkey…",
    failed: "Das hat nicht geklappt. Versuche es noch einmal.",
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
    rename: "Umbenennen",
    save: "Speichern",
    remove: "Entfernen",
    removeAsk: (n) => `${n} entfernen?`,
    onlyOne: "Dein einziger Passkey kann nicht entfernt werden.",
    add: "Passkey hinzufügen",
    signOut: "Abmelden",
  },
  en: {
    waiting: "Waiting for your passkey…",
    failed: "That didn't work. Try again.",
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
    rename: "Rename",
    save: "Save",
    remove: "Remove",
    removeAsk: (n) => `Remove ${n}?`,
    onlyOne: "Your only passkey can't be removed.",
    add: "Add passkey",
    signOut: "Sign out",
  },
};
const T = STR[lang];

const MCP_URL = "https://sippet.bastelboxx.de/mcp";
const SVG = "http://www.w3.org/2000/svg";
const app = document.getElementById("app");
const foot = document.getElementById("foot");

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.filter(Boolean));
  return el;
}

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
  s.setAttribute("class", "spin");
  return s;
};
const check = () => icon("M5 12.5l4.5 4.5L19 7.5");

let shown = false;
function view(...nodes) {
  app.replaceChildren(...nodes);
  const t = app.querySelector("h1");
  if (t && shown) {
    t.tabIndex = -1;
    t.focus();
  }
  shown = true;
}

const title = (text) => (document.title = `${text} · Sippet`) && h("h1", {}, text);
const note = (text, cls = "body") => h("p", { class: cls, role: "alert" }, text);

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body && { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const post = (path, body) => api(path, { method: "POST", body });
const isCancel = (e) => e.name === "NotAllowedError" || e.name === "AbortError";

async function registerPasskey(query = "", createSession) {
  const options = await api(`/auth/passkey/generate-register-options${query}`);
  const cred = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
  await post("/auth/passkey/verify-registration", { response: cred.toJSON(), createSession });
}

async function signInWithPasskey() {
  const options = await api("/auth/passkey/generate-authenticate-options");
  const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
  await post("/auth/passkey/verify-authentication", { response: cred.toJSON() });
}

// idle → waiting → done | idle | idle + error. When `run` returns, the next screen takes over.
function passkeyButton(label, run, withGlyph = true) {
  const error = h("p", { class: "err", role: "alert" });
  const mark = h("span");
  if (withGlyph) mark.append(glyph());
  const text = h("span", {}, label);
  const button = h("button", { class: "btn primary" }, mark, text);
  button.addEventListener("click", async () => {
    if (button.ariaDisabled) return;
    button.ariaDisabled = "true";
    error.textContent = "";
    text.textContent = T.waiting;
    mark.replaceChildren(spinner());
    try {
      await run();
    } catch (e) {
      if (!isCancel(e)) error.textContent = T.failed;
      mark.replaceChildren(...(withGlyph ? [glyph()] : []));
      text.textContent = label;
      button.ariaDisabled = null;
    }
  });
  return h("div", { class: "stack" }, button, error);
}

const link = (label, onclick, cls = "", name = "") => h("button", { class: `link ${cls}`, onclick, "aria-label": `${label} ${name}`.trim() }, label);
const fmtDate = (v) => new Date(v).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });

async function join() {
  const token = decodeURIComponent(location.hash.slice(1));
  let name;
  try {
    ({ name } = await api(`/invitation?token=${encodeURIComponent(token)}`));
  } catch {
    return view(note(T.inviteDead));
  }
  view(
    title(T.welcome(name)),
    h("p", { class: "body" }, T.joinBody),
    passkeyButton(T.create, async () => {
      await registerPasskey(`?context=${encodeURIComponent(token)}`, true);
      location.assign("/account");
    }),
  );
}

// The part of Better Auth's query that its oauth_query field takes back.
function signedQuery(params) {
  const names = new Set(params.getAll("ba_param"));
  if (!params.has("sig") || !names.size) return null;
  const out = new URLSearchParams();
  for (const [k, v] of params) if (k === "sig" || k === "ba_param" || names.has(k)) out.append(k, v);
  return out.toString();
}

const currentUser = async () => (await api("/auth/get-session"))?.user;

async function connect() {
  const params = new URLSearchParams(location.search);
  const oauthQuery = signedQuery(params);
  const clientId = params.get("client_id");
  let redirect, client, user;
  try {
    redirect = new URL(params.get("redirect_uri"));
    [client, user] = await Promise.all([
      post("/auth/oauth2/public-client-prelogin", { client_id: clientId, oauth_query: oauthQuery }),
      currentUser(),
    ]);
  } catch {
    return view(note(T.requestDead));
  }
  const web = /^https?:$/.test(redirect.protocol) && !/^(localhost|\[::1\]|127(\.\d+){3})$/.test(redirect.hostname);
  let signedIn = !!user;
  const allow = passkeyButton(
    signedIn ? T.allow : T.allowPasskey,
    async () => {
      if (!signedIn) await signInWithPasskey();
      signedIn = true;
      const { url } = await post("/auth/oauth2/consent", { accept: true, oauth_query: oauthQuery });
      location.assign(url);
    },
    !signedIn,
  );
  // the consent endpoint needs a session, so a refusal is the plain error redirect
  const deny = h("button", { class: "btn plain", onclick() {
    redirect.searchParams.set("error", "access_denied");
    if (params.has("state")) redirect.searchParams.set("state", params.get("state"));
    location.assign(redirect);
  } }, T.deny);
  view(
    h("div", { class: "stack" }, title(T.wants(client.client_name)), h("p", { class: "sec" }, web ? T.backTo(redirect.host) : T.backLocal)),
    h("ul", { class: "perms stack" }, ...[T.perm1, T.perm2].map((p) => h("li", {}, check(), h("span", {}, p)))),
    h("p", { class: "sec" }, T.undoable),
    h("div", { class: "stack" }, allow, deny),
  );
}

async function account() {
  let user;
  try {
    user = await currentUser();
  } catch {
    return view(note(T.failed, "err"));
  }
  if (!user) return signedOut();
  foot.replaceChildren(h("button", { class: "btn plain", async onclick() {
    await post("/auth/sign-out", {}).catch(() => 0);
    foot.replaceChildren();
    signedOut();
  } }, T.signOut));
  const box = (name) => h("div", { class: "group" }, h("h2", {}, name));
  const [connections, passkeys] = [box(T.connections), box(T.passkeys)];
  view(title(T.account), h("div", { class: "group" }, h("h2", {}, T.connectClaude), h("p", { class: "sec" }, T.connectHelp), address()), connections, passkeys);
  fill(connections, "/connections", connectionRows);
  fill(passkeys, "/auth/passkey/list-user-passkeys", passkeyRows, true);
}

function signedOut() {
  view(title(T.signInTitle), passkeyButton(T.signIn, async () => {
    await signInWithPasskey();
    account();
  }));
}

function address() {
  const label = h("span", {}, T.copy);
  const copy = link(label, async () => {
    if (await navigator.clipboard.writeText(MCP_URL).then(() => 0, () => 1)) return;
    label.textContent = T.copied;
    setTimeout(() => (label.textContent = T.copy), 2000);
  });
  return h("div", { class: "stack" }, h("code", {}, MCP_URL), h("span", { "aria-live": "polite", class: "acts" }, copy));
}

// Loads a list into its group and draws it; `again()` redraws after a change.
async function fill(box, path, rows, add) {
  const again = () => fill(box, path, rows, add);
  const error = h("p", { class: "err", role: "alert" });
  let items;
  try {
    items = await api(path);
  } catch {
    error.textContent = T.failed;
    return box.replaceChildren(box.firstChild, error);
  }
  const list = rows({ items, error, again });
  const addButton = add && passkeyButton(T.add, async () => {
    await registerPasskey();
    again();
  });
  box.replaceChildren(box.firstChild, list.length ? h("ul", {}, ...list) : h("p", { class: "sec" }, T.none), error, ...(addButton ? [addButton] : []));
}

function row(name, meta, ...acts) {
  return h("li", { class: "row" },
    h("div", { class: "main" }, h("span", {}, name), h("span", { class: "meta" }, meta)),
    h("div", { class: "acts" }, ...acts),
  );
}

// Swaps a row for a question with a confirming action and a cancel.
function swap(li, trigger, content, acts) {
  const before = [...li.childNodes];
  const back = () => {
    li.replaceChildren(...before);
    trigger.focus();
  };
  li.replaceChildren(content, h("div", { class: "acts" }, ...acts(back)));
}

function confirmRow(li, trigger, error, ask, label, run) {
  swap(li, trigger, h("p", { class: "ask", role: "alert" }, ask), (back) => [
    link(label, async () => {
      try {
        await run();
      } catch {
        error.textContent = T.failed;
        back();
      }
    }, "danger"),
    link(T.cancel, back),
  ]);
  li.querySelector(".danger").focus();
}

const connectionRows = ({ items, error, again }) =>
  items.map((c) => {
    const li = row(c.name, T.connectedOn(fmtDate(c.connectedAt)));
    const trigger = link(T.disconnect, () =>
      confirmRow(li, trigger, error, T.disconnectAsk(c.name), T.disconnect, async () => {
        await post(`/connections/${encodeURIComponent(c.clientId)}/disconnect`);
        again();
      }), "danger", c.name);
    li.lastChild.append(trigger);
    return li;
  });

function passkeyRows({ items, error, again }) {
  return items.map((p) => {
    const name = p.name || "Passkey";
    const li = row(name, T.addedOn(fmtDate(p.createdAt)));
    const rename = link(T.rename, () => {
      const input = h("input", { type: "text", value: name, "aria-label": T.rename });
      swap(li, rename, input, (back) => {
        const save = async () => {
          const next = input.value.trim();
          if (!next || next === name) return back();
          try {
            await post("/auth/passkey/update-passkey", { id: p.id, name: next });
            again();
          } catch {
            error.textContent = T.failed;
            back();
          }
        };
        input.addEventListener("keydown", (e) => e.key === "Enter" ? save() : e.key === "Escape" && back());
        return [link(T.save, save), link(T.cancel, back)];
      });
      input.focus();
      input.select();
    }, "", name);
    const remove = link(T.remove, () =>
      confirmRow(li, remove, error, T.removeAsk(name), T.remove, async () => {
        await post("/auth/passkey/delete-passkey", { id: p.id });
        again();
      }), "danger", name);
    li.lastChild.append(rename);
    items.length > 1 ? li.lastChild.append(remove) : li.append(h("p", { class: "meta ask" }, T.onlyOne));
    return li;
  });
}

({ join, connect, account })[document.body.dataset.page]();
