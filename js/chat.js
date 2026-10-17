// Lemniscate chat: accounts + live channels. Exposes window.LemniscateChat.mount(root) -> cleanup().
// Everything user-supplied is inserted with textContent (never innerHTML), so messages can't inject markup.
(() => {
  "use strict";

  const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
  const ICONS = {
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    lock: "M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z",
    mail: "M3 6h18v12H3zM3 7l9 7 9-7",
    send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
    out: "M9 21H5V3h4M16 17l5-5-5-5M21 12H9",
    reply: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v3",
    smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    menu: "M4 6h16M4 12h16M4 18h16",
    x: "M6 6l12 12M18 6 6 18",
    check: "M5 12.5l4.5 4.5L19 7.5",
    chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z",
  };
  const COLORS = ["#7dff8a", "#7ee8ff", "#ff7eb6", "#ffd27e", "#b69cff", "#ff9f7e", "#7effc8"];

  const svg = (name) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.8");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", ICONS[name]);
    s.append(p);
    return s;
  };

  // h("div.class", {attr}, ...children) — tiny DOM builder. Strings become text nodes.
  const h = (tag, attrs, ...kids) => {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data?.error || `Something went wrong (HTTP ${res.status})`), { status: res.status });
    return data;
  }

  // Profile picture if the user set one, otherwise the first letter on their color.
  // The color is only painted behind the letter: painting it behind a picture leaves a thin
  // ring of that color showing around the picture's rounded edge.
  const avatar = (user, size = "", online) => {
    const el = h("div.lc-avatar" + (size ? "." + size : ""), { style: user.avatar ? "" : `background:${user.color}` });
    const letter = (user.username[0] || "?").toUpperCase();
    if (user.avatar) {
      const img = h("img", { src: user.avatar, alt: "", draggable: "false", decoding: "async" });
      img.addEventListener("error", () => {
        // The picture failed to load: fall back to the letter on their color.
        el.style.background = user.color;
        img.replaceWith(document.createTextNode(letter));
      });
      el.append(img);
    } else el.append(letter);
    if (online !== undefined) el.append(h("span.st" + (online ? ".on" : "")));
    return el;
  };

  // ---- profile image processing (all done in the browser before upload) ----
  const AVATAR_SIZE = [256, 256];   // square
  const BANNER_SIZE = [1024, 256];  // 4:1, matches the profile card banner
  const MAX_PICK_BYTES = 15 * 1024 * 1024;

  const canvasToBlob = (canvas, type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));

  // Center-crop ("cover") the picked file to w×h and re-encode it. Re-encoding also strips
  // metadata such as GPS tags and keeps uploads small.
  async function cropToBlob(file, w, hgt) {
    if (!file.type.startsWith("image/") || /svg/i.test(file.type)) throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
    if (file.size > MAX_PICK_BYTES) throw new Error("That image is too big. Pick one under 15 MB.");
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error("Couldn't read that image."); }
    const scale = Math.max(w / bmp.width, hgt / bmp.height);
    const sw = w / scale, sh = hgt / scale;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, hgt);
    bmp.close?.();
    let blob = await canvasToBlob(canvas, "image/webp", 0.86);
    if (!blob || blob.type !== "image/webp") {
      // This browser can't encode WebP: flatten onto a dark background and use JPEG instead.
      const flat = document.createElement("canvas");
      flat.width = w; flat.height = hgt;
      const fctx = flat.getContext("2d");
      fctx.fillStyle = "#0b0e11"; fctx.fillRect(0, 0, w, hgt); fctx.drawImage(canvas, 0, 0);
      blob = await canvasToBlob(flat, "image/jpeg", 0.88);
    }
    if (!blob) throw new Error("Couldn't process that image.");
    return blob;
  }

  async function uploadImage(slot, blob) {
    const res = await fetch(`/api/me/${slot}`, {
      method: "PUT", credentials: "same-origin", headers: { "Content-Type": blob.type }, body: blob,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.error || data?.message || `Upload failed (server replied HTTP ${res.status})`);
    return data;
  }

  const ROLE_LABEL = { owner: "Owner", admin: "Admin", mod: "Moderator", member: "Member" };
  // Staff badges show everywhere; the plain "Member" badge only where asked (profile card), so lists/messages stay clean.
  const roleBadge = (role, always = false) =>
    role && (always || role !== "member") ? h("span.lc-badge." + role, null, ROLE_LABEL[role] || role) : null;

  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const dayKey = (t) => new Date(t).toDateString();

  // Turn plain text into nodes, linking http(s) URLs only.
  function linkify(text) {
    const out = [];
    const re = /https?:\/\/[^\s<>"]+/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      let url = m[0];
      const trail = url.match(/[.,!?)\]]+$/);
      if (trail) url = url.slice(0, -trail[0].length);
      out.push(h("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, url));
      last = m.index + url.length;
      re.lastIndex = last;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function mount(root) {
    let disposed = false;
    let me = null;
    let ws = null, wsTimer = null, retry = 0;
    let channels = [], current = null;
    let members = [], onlineIds = new Set();
    const cache = new Map();           // channelId -> { msgs, hasMore }
    const unread = new Set();
    const typing = new Map();          // channelId -> Map(userId -> {name, timer})
    let replyTo = null;
    let ui = {};                       // references to live DOM nodes of the chat view
    let overlay = null;
    let sideTab = "channels";           // sidebar tab: channels | friends
    let friendsData = { friends: [], incoming: [], outgoing: [] };
    let friendMsgTimer = null;
    let dmPeer = null;                 // when set, the main pane shows a DM with this friend
    const dmCache = new Map();         // peerId -> { msgs, hasMore }
    const dmUnread = new Map();        // peerId -> unread count

    const wrap = h("div.lc");
    root.replaceChildren(wrap);

    // ---------------- auth ----------------
    function showAuth(mode = "signin", notice = "") {
      closeSocket();
      const signup = mode === "signup";
      const err = h("div.lc-err", { hidden: true });
      const user = h("input", { placeholder: "Username", autocomplete: "username", maxlength: 20, required: true });
      const email = h("input", { type: "email", placeholder: "Email (optional, for password reset)", autocomplete: "email" });
      const pass = h("input", { type: "password", placeholder: "Password", autocomplete: signup ? "new-password" : "current-password", maxlength: 200, required: true });
      const btn = h("button.lc-btn", { type: "submit" }, signup ? "Sign up →" : "Sign in →");
      const field = (icon, input) => h("label.lc-field", null, svg(icon), input);

      const form = h("form", {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          btn.disabled = true;
          try {
            const body = { username: user.value, password: pass.value };
            if (signup) body.email = email.value;
            const res = await api("POST", signup ? "/api/auth/register" : "/api/auth/login", body);
            me = res.user;
            startChat();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
          } finally {
            btn.disabled = false;
          }
        },
      }, field("user", user), signup ? field("mail", email) : null, field("lock", pass),
        signup ? null : h("div.lc-forgot", null, h("button", { type: "button", onclick: showForgot }, "Forgot password?")),
        err, btn);

      wrap.replaceChildren(
        h("div.lc-auth", null,
          h("div.lc-auth-card", null,
            h("h2", null, signup ? "Create your account" : "Welcome back"),
            h("p.sub", null, notice || (signup ? "Join Lemniscate" : "Sign in to continue")),
            form,
            h("p.lc-switch", null,
              signup ? "Already have an account? " : "Don't have an account? ",
              h("button", { type: "button", onclick: () => showAuth(signup ? "signin" : "signup") }, signup ? "Sign in" : "Sign up")),
            // The legal line only appears when creating an account, not on sign in.
            signup ? h("p.lc-legal", null,
              "By creating an account, you agree to our ",
              h("a", { href: "/tos", target: "_blank", rel: "noopener" }, "Terms of Service"),
              " & ",
              h("a", { href: "/privacy", target: "_blank", rel: "noopener" }, "Privacy Policy"),
              ".") : null)));
      user.focus();
    }

    // Step 1: ask for the email on the account; the server emails a reset link.
    function showForgot() {
      const err = h("div.lc-err", { hidden: true });
      const email = h("input", { type: "email", placeholder: "Email on your account", autocomplete: "email", required: true });
      const btn = h("button.lc-btn", { type: "submit" }, "Send reset link →");
      const form = h("form", {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          btn.disabled = true;
          try {
            await api("POST", "/api/auth/forgot", { email: email.value });
            wrap.replaceChildren(
              h("div.lc-auth", null,
                h("div.lc-auth-card.center", null,
                  h("h2", null, "Check your email"),
                  h("p.sub", null, "If an account uses that email, a reset link is on its way. It works for one hour."),
                  h("p.lc-switch", null, h("button", { type: "button", onclick: () => showAuth("signin") }, "← Back to sign in")))));
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
            btn.disabled = false;
          }
        },
      }, h("label.lc-field", null, svg("mail"), email), err, btn);
      wrap.replaceChildren(
        h("div.lc-auth", null,
          h("div.lc-auth-card.center", null,
            h("h2", null, "Reset your password"),
            h("p.sub", null, "We'll email a reset link if your account has one"),
            form,
            h("p.lc-switch.back", null, h("button", { type: "button", onclick: () => showAuth("signin") }, "← Back to sign in")))));
      email.focus();
    }

    // Step 2: the emailed link lands here with a one-time token.
    function showReset(token) {
      const err = h("div.lc-err", { hidden: true });
      const pass = h("input", { type: "password", placeholder: "New password (8+ characters)", autocomplete: "new-password", maxlength: 200, required: true });
      const again = h("input", { type: "password", placeholder: "Repeat new password", autocomplete: "new-password", maxlength: 200, required: true });
      const btn = h("button.lc-btn", { type: "submit" }, "Set new password →");
      const form = h("form", {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          if (pass.value !== again.value) { err.textContent = "Passwords don't match"; err.hidden = false; return; }
          btn.disabled = true;
          try {
            const res = await api("POST", "/api/auth/reset", { token, password: pass.value });
            me = res.user;
            startChat();
          } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
            btn.disabled = false;
          }
        },
      }, h("label.lc-field", null, svg("lock"), pass), h("label.lc-field", null, svg("lock"), again), err, btn);
      wrap.replaceChildren(
        h("div.lc-auth", null,
          h("div.lc-auth-card.center", null,
            h("h2", null, "Choose a new password"),
            h("p.sub", null, "You'll be signed in and logged out of other devices"),
            form,
            h("p.lc-switch", null, h("button", { type: "button", onclick: () => showAuth("signin") }, "Back to sign in")))));
      pass.focus();
    }

    // ---------------- chat shell ----------------
    async function startChat() {
      try {
        const [c, m] = await Promise.all([api("GET", "/api/channels"), api("GET", "/api/members")]);
        channels = c.channels;
        members = m.members;
        onlineIds = new Set(m.online);
      } catch (ex) {
        if (ex.status === 401) return showAuth("signin", "Your session expired. Sign in again.");
        wrap.replaceChildren(h("div.lc-auth", null, h("div.lc-auth-card", null, h("p.sub", null, "Couldn't load chat. " + ex.message))));
        return;
      }
      buildShell();
      loadFriends();
      const first = channels.find((c) => c.name === "general") || channels[0];
      if (first) await openChannel(first.id);
      connect();
    }

    function buildShell() {
      ui.sideList = h("div.lc-scroll");
      ui.memberList = h("div.lc-scroll");
      ui.msgs = h("div.lc-msgs");
      ui.title = h("span");
      ui.hash = h("span.hash", null, "#");
      ui.typing = h("div.lc-typing");
      ui.status = h("div.lc-status", { hidden: true }, "Reconnecting…");
      ui.replyBar = h("div.lc-replybar", { hidden: true });
      ui.input = h("textarea", { rows: 1, maxlength: 2000, onkeydown: onKey, oninput: onInput });
      ui.send = h("button.lc-send", { type: "button", "aria-label": "Send", onclick: send }, svg("send"));
      ui.app = h("div.lc-app");
      ui.sideTabs = h("div.lc-tabs");
      ui.friendInput = h("input", { placeholder: "Add by username", maxlength: 20, autocomplete: "off", spellcheck: "false",
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addFriend(); } } });
      ui.friendMsg = h("div.lc-fmsg", { hidden: true });
      ui.friendLists = h("div");
      ui.friendsPane = h("div.lc-scroll", { hidden: true },
        h("div.lc-fadd", null,
          h("div.lc-fadd-row", null, ui.friendInput, h("button.lc-btn.small", { type: "button", onclick: addFriend }, "Add")),
          ui.friendMsg),
        ui.friendLists);

      ui.userbar = h("div.lc-userbar");
      renderUserbar();

      ui.app.append(
        h("aside.lc-side", null, h("div.lc-side-head", null, "LEMNISCATE CHAT"), ui.sideTabs, ui.sideList, ui.friendsPane, ui.userbar),
        h("section.lc-main", null,
          h("div.lc-main-head", null,
            h("button.lc-iconbtn.lc-burger", { type: "button", "aria-label": "Channels", onclick: () => ui.app.classList.toggle("show-side") }, svg("menu")),
            ui.hash, ui.title),
          ui.status, ui.msgs, ui.typing,
          h("div.lc-compose", null, ui.replyBar, h("div.lc-inputrow", null, ui.input, ui.send))),
        h("aside.lc-members", null, ui.memberList));
      wrap.replaceChildren(ui.app);
      renderSidebar();
      renderMembers();
    }

    function renderUserbar() {
      if (!ui.userbar) return;
      ui.userbar.replaceChildren(
        h("button.who", { type: "button", onclick: () => showProfile(me.username) },
          avatar(me, "sm"), h("span.name", { style: `color:${me.color}` }, me.username)),
        h("button.lc-iconbtn", { type: "button", title: "Sign out", "aria-label": "Sign out", onclick: signOut }, svg("out")));
    }

    // Someone changed their color or profile picture: update every place we've cached them.
    function applyProfile({ userId, color, avatar: av }) {
      const patch = (u) => {
        if (!u || u.id !== userId) return;
        if (color) u.color = color;
        if (av !== undefined) u.avatar = av;
      };
      members.forEach(patch);
      for (const d of cache.values()) d.msgs.forEach((x) => patch(x.user));
      for (const d of dmCache.values()) d.msgs.forEach((x) => patch(x.user));
      for (const list of [friendsData.friends, friendsData.incoming, friendsData.outgoing]) list.forEach(patch);
      if (dmPeer) patch(dmPeer);
      if (me) patch(me);
      if (!ui.msgs) return;
      renderUserbar();
      renderMembers();
      if (dmPeer) renderDm(false);
      else if (cache.has(current)) renderMessages(false);
    }

    function renderSidebar() {
      renderTabs();
      ui.sideList.hidden = sideTab !== "channels";
      ui.friendsPane.hidden = sideTab !== "friends";
      renderFriends();
      const cats = [];
      for (const c of channels) {
        let g = cats.find((x) => x.name === c.category);
        if (!g) cats.push((g = { name: c.category, items: [] }));
        g.items.push(c);
      }
      ui.sideList.replaceChildren(...cats.flatMap((g) => [
        h("div.lc-cat", null, g.name),
        ...g.items.map((c) =>
          h("button.lc-chan" + (current === c.id ? ".active" : "") + (unread.has(c.id) ? ".unread" : ""),
            { type: "button", onclick: () => { ui.app.classList.remove("show-side"); openChannel(c.id); } },
            h("span.hash", null, "#"), c.name, h("span.dot"))),
      ]));
    }

    function renderMembers() {
      const byName = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
      const isOn = (m) => onlineIds.has(m.id);
      const row = (m, on) =>
        h("button.lc-member" + (on ? "" : ".off"), { type: "button", onclick: () => showProfile(m.username) },
          avatar(m, "sm", on), h("span.nm", { style: `color:${m.color}` }, m.username), roleBadge(m.role));
      const act = members.filter((m) => !m.banned);
      const bannedList = members.filter((m) => m.banned).sort(byName);
      const kids = [];
      // Staff get their own groups (online only), highest role first: Owner, Admin, Moderator.
      for (const role of ["owner", "admin", "mod"]) {
        const list = act.filter((m) => m.role === role && isOn(m)).sort(byName);
        if (!list.length) continue;
        const label = ROLE_LABEL[role] + (list.length > 1 ? "s" : "");   // Admin — 1, Admins — 2
        kids.push(h("div.lc-mhead." + role, null, `${label} — ${list.length}`), ...list.map((m) => row(m, true)));
      }
      // Everyone who just made an account is a Member: the last role group, below Moderator.
      const on = act.filter((m) => m.role === "member" && isOn(m)).sort(byName);
      const off = act.filter((m) => !isOn(m)).sort(byName);
      if (on.length)
        kids.push(h("div.lc-mhead.member", null, `${ROLE_LABEL.member}${on.length > 1 ? "s" : ""} — ${on.length}`), ...on.map((m) => row(m, true)));
      if (off.length) kids.push(h("div.lc-mhead", null, `Offline — ${off.length}`), ...off.map((m) => row(m, false)));
      if (bannedList.length) kids.push(h("div.lc-mhead.banned", null, `Banned — ${bannedList.length}`), ...bannedList.map((m) => row(m, false)));
      ui.memberList.replaceChildren(...kids);
      renderFriends(); // keep the friends list's online dots current
    }

    // ---------------- friends ----------------
    function renderTabs() {
      const pending = friendsData.incoming.length + totalDmUnread();
      ui.sideTabs.replaceChildren(
        h("button.lc-tab" + (sideTab === "channels" ? ".active" : ""), { type: "button", onclick: () => setTab("channels") },
          "Channels", sideTab !== "channels" && unread.size ? h("span.dot") : null),
        h("button.lc-tab" + (sideTab === "friends" ? ".active" : ""), { type: "button", onclick: () => setTab("friends") },
          "Friends", pending ? h("span.badge", null, String(pending)) : null));
    }
    const totalDmUnread = () => [...dmUnread.values()].reduce((a, b) => a + b, 0);
    function setTab(t) {
      sideTab = t;
      renderSidebar();
      if (t === "friends") loadFriends();
    }

    function setFriendMsg(text, isErr) {
      if (!ui.friendMsg) return;
      clearTimeout(friendMsgTimer);
      ui.friendMsg.textContent = text || "";
      ui.friendMsg.className = "lc-fmsg" + (isErr ? " err" : "");
      ui.friendMsg.hidden = !text;
      if (text) friendMsgTimer = setTimeout(() => { if (ui.friendMsg) ui.friendMsg.hidden = true; }, 5000);
    }

    async function loadFriends() {
      try { friendsData = await api("GET", "/api/friends"); } catch { return; }
      dmUnread.clear();
      for (const f of friendsData.friends) if (f.unread && dmPeer?.id !== f.id) dmUnread.set(f.id, f.unread);
      if (ui.sideTabs) renderSidebar();
      if (dmPeer) setDmComposer();
    }

    async function addFriend() {
      const name = ui.friendInput.value.trim().replace(/^@/, "");
      if (!name) return;
      try {
        const r = await api("POST", `/api/friends/${encodeURIComponent(name)}`);
        ui.friendInput.value = "";
        setFriendMsg(r.friendship === "friends" ? `You and ${name} are now friends!` : `Friend request sent to ${name}.`, false);
        await loadFriends();
      } catch (ex) { setFriendMsg(ex.message, true); }
    }

    async function friendAct(method, username) {
      try { await api(method, `/api/friends/${encodeURIComponent(username)}`); await loadFriends(); }
      catch (ex) { setFriendMsg(ex.message, true); }
    }

    function renderFriends() {
      if (!ui.friendLists) return;
      const { friends, incoming, outgoing } = friendsData;
      const byOnline = (a, b) => (onlineIds.has(b.id) - onlineIds.has(a.id)) ||
        a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
      const act = (title, icon, cls, fn) =>
        h("button.lc-iconbtn." + cls, { type: "button", title, "aria-label": title, onclick: fn }, svg(icon));
      const row = (u, ...actions) =>
        h("div.lc-frow" + (onlineIds.has(u.id) ? "" : ".off") + (dmPeer?.id === u.id ? ".active" : ""), null,
          h("button.lc-fwho", { type: "button", onclick: () => showProfile(u.username) },
            avatar(u, "sm", onlineIds.has(u.id)), h("span.nm", { style: `color:${u.color}` }, u.username)),
          ...actions);
      const friendRow = (u) => {
        const n = dmUnread.get(u.id) || 0;
        return h("div.lc-frow" + (onlineIds.has(u.id) ? "" : ".off") + (dmPeer?.id === u.id ? ".active" : ""), null,
          h("button.lc-fwho", { type: "button", title: `Message ${u.username}`, onclick: () => openDm(u) },
            avatar(u, "sm", onlineIds.has(u.id)), h("span.nm", { style: `color:${u.color}` }, u.username),
            n ? h("span.lc-unread", null, n > 99 ? "99+" : String(n)) : null),
          act("Profile", "user", "", () => showProfile(u.username)));
      };
      const kids = [];
      if (incoming.length)
        kids.push(h("div.lc-cat", null, `Pending — ${incoming.length}`),
          ...incoming.map((u) => row(u,
            act("Accept", "check", "ok", () => friendAct("POST", u.username)),
            act("Decline", "x", "no", () => friendAct("DELETE", u.username)))));
      if (outgoing.length)
        kids.push(h("div.lc-cat", null, `Request sent — ${outgoing.length}`),
          ...outgoing.map((u) => row(u, act("Cancel request", "x", "no", () => friendAct("DELETE", u.username)))));
      kids.push(h("div.lc-cat", null, `Friends — ${friends.length}`));
      if (friends.length) kids.push(...[...friends].sort(byOnline).map(friendRow));
      else kids.push(h("div.lc-fempty", null, "No friends yet. Add someone using their username above, then click them to send a message."));
      ui.friendLists.replaceChildren(...kids);
    }

    // ---------------- channels & messages ----------------
    async function openChannel(id) {
      current = id;
      dmPeer = null;
      ui.hash.textContent = "#";
      unread.delete(id);
      cancelReply();
      renderSidebar();
      const ch = channels.find((c) => c.id === id);
      ui.title.textContent = ch.name;
      ui.input.disabled = !ch.canWrite;
      ui.input.placeholder = ch.canWrite ? `Message #${ch.name}` : "You don't have permission to post in this channel.";
      ui.send.disabled = !ch.canWrite;
      renderTyping();
      if (!cache.has(id)) {
        ui.msgs.replaceChildren(h("div.lc-empty", null, "Loading…"));
        try {
          const { messages } = await api("GET", `/api/channels/${id}/messages`);
          cache.set(id, { msgs: messages, hasMore: messages.length >= 50 });
        } catch (ex) {
          if (ex.status === 401) return showAuth("signin", "Your session expired. Sign in again.");
          ui.msgs.replaceChildren(h("div.lc-empty", null, "Couldn't load messages."));
          return;
        }
      }
      if (current !== id) return;
      renderMessages(true);
      if (ch.canWrite) ui.input.focus();
    }

    function renderMessages(toBottom) {
      const data = cache.get(current);
      if (!data) return;
      const nearBottom = ui.msgs.scrollHeight - ui.msgs.scrollTop - ui.msgs.clientHeight < 80;
      const kids = [];
      if (data.hasMore)
        kids.push(h("button.lc-more", { type: "button", onclick: loadOlder }, "Load older messages"));
      if (!data.msgs.length) kids.push(h("div.lc-empty", { style: "height:60%" }, "No messages yet — say hi!"));
      let prev = null;
      for (const m of data.msgs) {
        const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
        if (newDay) kids.push(h("div.lc-day", null, fmtDay(m.created_at)));
        const grouped = !newDay && prev.user.id === m.user.id && !m.reply && m.created_at - prev.created_at < 5 * 60 * 1000;
        kids.push(messageEl(m, grouped));
        prev = m;
      }
      ui.msgs.replaceChildren(...kids);
      if (toBottom || nearBottom) ui.msgs.scrollTop = ui.msgs.scrollHeight;
    }

    async function loadOlder() {
      const data = cache.get(current);
      if (!data?.msgs.length) return;
      const id = current;
      const oldHeight = ui.msgs.scrollHeight;
      try {
        const { messages } = await api("GET", `/api/channels/${id}/messages?before=${data.msgs[0].id}`);
        data.msgs = [...messages, ...data.msgs];
        data.hasMore = messages.length >= 50;
        if (current === id) { renderMessages(false); ui.msgs.scrollTop = ui.msgs.scrollHeight - oldHeight; }
      } catch {}
    }

    function messageEl(m, grouped) {
      const canDelete = m.user.id === me.id || ["mod", "admin", "owner"].includes(me.role);
      const ch = channels.find((c) => c.id === m.channel);
      const tools = h("div.lc-tools", null,
        h("button", { type: "button", title: "React", "aria-label": "Add reaction", onclick: (e) => openPicker(e, m, el) }, svg("smile")),
        ch?.canWrite ? h("button", { type: "button", title: "Reply", "aria-label": "Reply", onclick: () => startReply(m) }, svg("reply")) : null,
        canDelete ? h("button.del", { type: "button", title: "Delete", "aria-label": "Delete message", onclick: () => confirmDelete(m) }, svg("trash")) : null);
      tools.querySelectorAll("svg").forEach((s) => { s.style.cssText = "width:15px;height:15px"; });

      const reacts = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length);
      const el = h("div.lc-msg" + (grouped ? "" : ".first"), { "data-id": m.id },
        grouped
          ? h("div.lc-gutter", null, fmtTime(m.created_at))
          : h("button.lc-iconbtn", { type: "button", style: "width:34px;height:34px;padding:0", "aria-label": m.user.username, onclick: () => showProfile(m.user.username) }, avatar(m.user)),
        h("div.lc-body", null,
          m.reply ? h("div.lc-replyref", null, "↪", h("b", null, m.reply.username), h("span", null, m.reply.content)) : null,
          grouped ? null : h("div.lc-meta", null,
            h("button.lc-name", { type: "button", style: `color:${m.user.color}`, onclick: () => showProfile(m.user.username) }, m.user.username),
            roleBadge(m.user.role), h("span.lc-time", null, fmtTime(m.created_at))),
          h("div.lc-text", null, linkify(m.content)),
          reacts.length ? h("div.lc-reacts", null, reacts.map(([emoji, ids]) =>
            h("button.lc-react" + (ids.includes(me.id) ? ".mine" : ""), { type: "button", onclick: () => react(m.id, emoji) }, emoji, String(ids.length)))) : null),
        tools);
      return el;
    }

    function openPicker(e, m, el) {
      e.stopPropagation();
      el.querySelector(".lc-picker")?.remove();
      const p = h("div.lc-picker", null, REACTIONS.map((emoji) =>
        h("button", { type: "button", onclick: () => { p.remove(); react(m.id, emoji); } }, emoji)));
      el.append(p);
      const close = (ev) => { if (!p.contains(ev.target)) { p.remove(); document.removeEventListener("click", close, true); } };
      setTimeout(() => document.addEventListener("click", close, true), 0);
    }

    function confirmDelete(m) {
      if (window.confirm("Delete this message?")) wsSend({ t: "delete", message: m.id });
    }

    // ---------------- composing ----------------
    function startReply(m) {
      replyTo = m;
      ui.replyBar.hidden = false;
      ui.replyBar.replaceChildren(
        "Replying to ", h("b", { style: `color:${m.user.color}` }, m.user.username),
        h("span", null, m.content),
        h("button.lc-iconbtn", { type: "button", "aria-label": "Cancel reply", onclick: cancelReply }, svg("x")));
      ui.input.focus();
    }
    function cancelReply() {
      replyTo = null;
      if (ui.replyBar) { ui.replyBar.hidden = true; ui.replyBar.replaceChildren(); }
    }

    let lastTyping = 0;
    function onInput() {
      ui.input.style.height = "auto";
      ui.input.style.height = Math.min(ui.input.scrollHeight, 140) + "px";
      const now = Date.now();
      if (ui.input.value && now - lastTyping > 3000) {
        lastTyping = now;
        wsSend(dmPeer ? { t: "dm_typing", to: dmPeer.id } : { t: "typing", channel: current });
      }
    }
    function onKey(e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      if (e.key === "Escape") cancelReply();
    }
    function send() {
      const content = ui.input.value.trim();
      if (dmPeer) {
        if (!content) return;
        if (!wsSend({ t: "dm", to: dmPeer.id, content })) return flashStatus("Not connected — trying to reconnect…");
        ui.input.value = "";
        ui.input.style.height = "auto";
        lastTyping = 0;
        return;
      }
      if (!content || !current) return;
      if (!wsSend({ t: "send", channel: current, content, reply_to: replyTo?.id })) return flashStatus("Not connected — trying to reconnect…");
      ui.input.value = "";
      ui.input.style.height = "auto";
      lastTyping = 0;
      cancelReply();
    }
    const react = (message, emoji) => wsSend({ t: "react", message, emoji });

    function flashStatus(text, ms = 4000) {
      ui.status.textContent = text;
      ui.status.hidden = false;
      clearTimeout(flashStatus.t);
      flashStatus.t = setTimeout(() => { if (ws?.readyState === 1) ui.status.hidden = true; }, ms);
    }

    // ---------------- direct messages (friends only) ----------------
    const isFriend = (id) => friendsData.friends.some((f) => f.id === id);

    async function openDm(peer) {
      dmPeer = { id: peer.id, username: peer.username, color: peer.color, role: peer.role };
      current = null;
      sideTab = "friends";
      cancelReply();
      ui.app.classList.remove("show-side");
      ui.hash.textContent = "@";
      ui.title.textContent = peer.username;
      dmUnread.delete(peer.id);
      renderSidebar();
      renderTyping();
      setDmComposer();
      const id = peer.id;
      if (!dmCache.has(id)) {
        ui.msgs.replaceChildren(h("div.lc-empty", null, "Loading…"));
        try {
          const { messages } = await api("GET", `/api/dms/${encodeURIComponent(peer.username)}/messages`);
          dmCache.set(id, { msgs: messages, hasMore: messages.length >= 50 });
        } catch (ex) {
          if (ex.status === 401) return showAuth("signin", "Your session expired. Sign in again.");
          if (dmPeer?.id === id) ui.msgs.replaceChildren(h("div.lc-empty", null, ex.message || "Couldn't load messages."));
          return;
        }
      }
      if (dmPeer?.id !== id) return;
      renderDm(true);
      markDmRead(peer);
      if (isFriend(id)) ui.input.focus();
    }

    function setDmComposer() {
      if (!dmPeer) return;
      const ok = isFriend(dmPeer.id);
      ui.input.disabled = !ok;
      ui.send.disabled = !ok;
      ui.input.placeholder = ok ? `Message @${dmPeer.username}` : `You're no longer friends with ${dmPeer.username}.`;
    }

    function markDmRead(peer) {
      api("POST", `/api/dms/${encodeURIComponent(peer.username)}/read`).catch(() => {});
    }

    function renderDm(toBottom) {
      const data = dmPeer && dmCache.get(dmPeer.id);
      if (!data) return;
      const nearBottom = ui.msgs.scrollHeight - ui.msgs.scrollTop - ui.msgs.clientHeight < 80;
      const kids = [];
      if (data.hasMore) kids.push(h("button.lc-more", { type: "button", onclick: loadOlderDm }, "Load older messages"));
      if (!data.msgs.length)
        kids.push(h("div.lc-empty", { style: "height:60%" }, `This is the start of your conversation with ${dmPeer.username}.`));
      let prev = null;
      for (const m of data.msgs) {
        const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
        if (newDay) kids.push(h("div.lc-day", null, fmtDay(m.created_at)));
        const grouped = !newDay && prev.user.id === m.user.id && m.created_at - prev.created_at < 5 * 60 * 1000;
        kids.push(dmEl(m, grouped));
        prev = m;
      }
      ui.msgs.replaceChildren(...kids);
      if (toBottom || nearBottom) ui.msgs.scrollTop = ui.msgs.scrollHeight;
    }

    async function loadOlderDm() {
      const peer = dmPeer, data = peer && dmCache.get(peer.id);
      if (!data?.msgs.length) return;
      const oldHeight = ui.msgs.scrollHeight;
      try {
        const { messages } = await api("GET", `/api/dms/${encodeURIComponent(peer.username)}/messages?before=${data.msgs[0].id}`);
        data.msgs = [...messages, ...data.msgs];
        data.hasMore = messages.length >= 50;
        if (dmPeer?.id === peer.id) { renderDm(false); ui.msgs.scrollTop = ui.msgs.scrollHeight - oldHeight; }
      } catch {}
    }

    function dmEl(m, grouped) {
      const mine = m.user.id === me.id;
      const tools = mine ? h("div.lc-tools", null,
        h("button.del", { type: "button", title: "Delete", "aria-label": "Delete message",
          onclick: () => { if (window.confirm("Delete this message?")) wsSend({ t: "dm_delete", message: m.id }); } }, svg("trash"))) : null;
      tools?.querySelectorAll("svg").forEach((x) => { x.style.cssText = "width:15px;height:15px"; });
      return h("div.lc-msg" + (grouped ? "" : ".first"), { "data-id": m.id },
        grouped
          ? h("div.lc-gutter", null, fmtTime(m.created_at))
          : h("button.lc-iconbtn", { type: "button", style: "width:34px;height:34px;padding:0", "aria-label": m.user.username, onclick: () => showProfile(m.user.username) }, avatar(m.user)),
        h("div.lc-body", null,
          grouped ? null : h("div.lc-meta", null,
            h("button.lc-name", { type: "button", style: `color:${m.user.color}`, onclick: () => showProfile(m.user.username) }, m.user.username),
            roleBadge(m.user.role), h("span.lc-time", null, fmtTime(m.created_at))),
          h("div.lc-text", null, linkify(m.content))),
        tools);
    }

    function onDm(m) {
      const peerId = m.from_id === me.id ? m.to_id : m.from_id;
      const data = dmCache.get(peerId);
      if (data && !data.msgs.some((x) => x.id === m.id)) data.msgs.push(m);
      typing.get("dm:" + peerId)?.delete(m.from_id);
      if (dmPeer?.id === peerId) {
        renderDm(m.from_id === me.id);
        renderTyping();
        if (m.from_id !== me.id) markDmRead(dmPeer);
      } else if (m.from_id !== me.id) {
        dmUnread.set(peerId, (dmUnread.get(peerId) || 0) + 1);
        renderSidebar();
        flashStatus(`New message from ${m.user.username}`, 4000);
      }
    }

    // ---------------- typing indicator ----------------
    const typingKey = () => (dmPeer ? "dm:" + dmPeer.id : current);
    function renderTyping() {
      const map = typing.get(typingKey());
      const names = map ? [...map.values()].map((v) => v.name) : [];
      ui.typing.textContent = !names.length ? "" : names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : "Several people are typing…";
    }
    function noteTyping(channel, user) {
      const map = typing.get(channel) || new Map();
      typing.set(channel, map);
      clearTimeout(map.get(user.id)?.timer);
      map.set(user.id, { name: user.username, timer: setTimeout(() => { map.delete(user.id); if (channel === typingKey()) renderTyping(); }, 5000) });
      if (channel === typingKey()) renderTyping();
    }

    // ---------------- websocket ----------------
    function wsSend(obj) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(obj));
      return true;
    }
    function closeSocket() {
      clearTimeout(wsTimer);
      if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    }
    function connect() {
      if (disposed || !me) return;
      closeSocket();
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/chat-ws`);
      ws = sock;
      sock.onopen = () => { retry = 0; if (ui.status) ui.status.hidden = true; };
      sock.onmessage = (e) => { try { onSocket(JSON.parse(e.data)); } catch (ex) { console.error(ex); } };
      sock.onclose = async () => {
        if (disposed || ws !== sock) return;
        if (ui.status) { ui.status.textContent = "Reconnecting…"; ui.status.hidden = false; }
        // If the session is gone, go back to sign-in instead of retrying forever.
        try { await api("GET", "/api/me"); } catch (ex) { if (ex.status === 401) return showAuth("signin", "Your session expired. Sign in again."); }
        wsTimer = setTimeout(async () => {
          retry++;
          try { // catch up on anything missed while offline
            const m = await api("GET", "/api/members"); members = m.members; onlineIds = new Set(m.online); renderMembers(); loadFriends();
            if (dmPeer) { dmCache.delete(dmPeer.id); await openDm(dmPeer); }
            else { cache.delete(current); await openChannel(current); }
          } catch {}
          connect();
        }, Math.min(1000 * 2 ** retry, 15000));
      };
    }

    async function refreshMembers() {
      try { const r = await api("GET", "/api/members"); members = r.members; onlineIds = new Set(r.online); renderMembers(); } catch {}
    }

    // Staff banned or deleted someone: drop everything of theirs we have on screen.
    function onPurged({ userId, username, reason }) {
      for (const d of cache.values()) {
        const gone = new Set(d.msgs.filter((x) => x.user.id === userId).map((x) => x.id));
        d.msgs = d.msgs.filter((x) => x.user.id !== userId);
        for (const x of d.msgs) {
          if (x.reply && gone.has(x.reply.id)) x.reply = null;
          for (const k of Object.keys(x.reactions || {})) {
            x.reactions[k] = x.reactions[k].filter((id) => id !== userId);
            if (!x.reactions[k].length) delete x.reactions[k];
          }
        }
      }
      dmCache.delete(userId);
      dmUnread.delete(userId);
      typing.forEach((map) => map.delete(userId));
      for (const k of ["friends", "incoming", "outgoing"]) friendsData[k] = friendsData[k].filter((u) => u.id !== userId);
      if (!ui.msgs) return;
      if (dmPeer?.id === userId) openChannel((channels.find((c) => c.name === "general") || channels[0]).id);
      else if (cache.has(current)) renderMessages(false);
      renderTyping();
      renderSidebar();
      refreshMembers();
      if (reason === "deleted" && overlay?.querySelector(".lc-card")?.getAttribute("aria-label") === `${username} profile`) closeOverlay();
    }

    // We were banned or our account was deleted while signed in.
    function onKicked({ reason }) {
      me = null; current = null; cache.clear(); unread.clear(); typing.clear();
      sideTab = "channels"; friendsData = { friends: [], incoming: [], outgoing: [] };
      dmPeer = null; dmCache.clear(); dmUnread.clear();
      closeOverlay();
      showAuth("signin", reason === "deleted" ? "Your account was deleted by staff." : "You have been banned from the chat.");
    }

    // Someone's role changed (owner action). Refresh lists, cached messages and — if it's us — our permissions.
    async function onRoleChanged({ userId, username, role }) {
      const m = members.find((x) => x.id === userId);
      if (m) m.role = role;
      for (const d of cache.values()) d.msgs.forEach((x) => { if (x.user.id === userId) x.user.role = role; });
      renderMembers();
      if (userId === me.id) {
        me.role = role;
        flashStatus(role === "member" ? "Your role was changed to Member." : `You're now ${/^[aeiou]/i.test(ROLE_LABEL[role]) ? "an" : "a"} ${ROLE_LABEL[role]}!`, 6000);
        try { channels = (await api("GET", "/api/channels")).channels; } catch {}
        renderSidebar();
        const ch = channels.find((c) => c.id === current);
        if (ch) {
          ui.input.disabled = !ch.canWrite;
          ui.input.placeholder = ch.canWrite ? `Message #${ch.name}` : "You don't have permission to post in this channel.";
          ui.send.disabled = !ch.canWrite;
        }
      }
      if (cache.has(current)) renderMessages(false);   // delete buttons depend on role
      if (overlay) overlay.querySelector("[data-role-for]")?.getAttribute("data-role-for") === username && showProfile(username);
    }

    function onSocket(msg) {
      if (msg.t === "ready") { onlineIds = new Set(msg.online); renderMembers(); }
      else if (msg.t === "presence") {
        msg.online ? onlineIds.add(msg.userId) : onlineIds.delete(msg.userId);
        if (msg.online && !members.some((m) => m.id === msg.userId)) api("GET", "/api/members").then((r) => { members = r.members; renderMembers(); }).catch(() => {});
        else renderMembers();
      } else if (msg.t === "message") {
        const m = msg.message;
        const data = cache.get(m.channel);
        if (data && !data.msgs.some((x) => x.id === m.id)) data.msgs.push(m);
        typing.get(m.channel)?.delete(m.user.id);
        if (m.channel === current) { renderMessages(m.user.id === me.id); renderTyping(); }
        else if (m.user.id !== me.id) { unread.add(m.channel); renderSidebar(); }
      } else if (msg.t === "typing") noteTyping(msg.channel, msg.user);
      else if (msg.t === "reactions") {
        const m = cache.get(msg.channel)?.msgs.find((x) => x.id === msg.message);
        if (m) { m.reactions = msg.reactions; if (msg.channel === current) renderMessages(false); }
      } else if (msg.t === "deleted") {
        const data = cache.get(msg.channel);
        if (data) { data.msgs = data.msgs.filter((x) => x.id !== msg.message); if (msg.channel === current) renderMessages(false); }
      } else if (msg.t === "dm") onDm(msg.message);
      else if (msg.t === "dm_typing") noteTyping("dm:" + msg.from.id, msg.from);
      else if (msg.t === "dm_deleted") {
        const peerId = msg.from_id === me.id ? msg.to_id : msg.from_id;
        const data = dmCache.get(peerId);
        if (data) { data.msgs = data.msgs.filter((x) => x.id !== msg.message); if (dmPeer?.id === peerId) renderDm(false); }
      } else if (msg.t === "role") onRoleChanged(msg);
      else if (msg.t === "profile") applyProfile(msg);
      else if (msg.t === "friends") {
        if (msg.event === "request") flashStatus(`${msg.from} sent you a friend request`, 6000);
        else if (msg.event === "accepted") flashStatus(`${msg.from} accepted your friend request`, 6000);
        loadFriends();
      } else if (msg.t === "purged") onPurged(msg);
      else if (msg.t === "kicked") onKicked(msg);
      else if (msg.t === "media_lock") {
        if (me) me.media_locked = msg.locked;
        flashStatus(msg.locked ? "Staff have restricted changes to your profile picture and banner." : "You can change your profile picture and banner again.", 6000);
      } else if (msg.t === "error") flashStatus(msg.message);
    }

    // ---------------- profile ----------------
    let overlayCleanup = null;   // frees preview image URLs made while editing a profile
    function closeOverlay() { overlayCleanup?.(); overlayCleanup = null; overlay?.remove(); overlay = null; }
    // Closing the card because the user asked to: play the closing animation (unless Reduce Motion is on).
    function dismissOverlay() {
      const el = overlay;
      if (!el) return;
      if (document.documentElement.classList.contains("motion-reduce")) { closeOverlay(); return; }
      overlayCleanup?.(); overlayCleanup = null;
      overlay = null;
      el.classList.add("lv-closing");
      setTimeout(() => el.remove(), 170);
    }
    async function showProfile(username) {
      const redraw = !!overlay; // the card is already open: redraw it without replaying the entrance
      closeOverlay();
      let data;
      try { data = await api("GET", `/api/users/${encodeURIComponent(username)}`); } catch { return; }
      const u = data.user;
      let color = u.color;
      overlay = h("div.lc-overlay" + (redraw ? ".lv-still" : ""), { onclick: (e) => { if (e.target === overlay) dismissOverlay(); } });
      let bannerUrl = u.banner;
      const banner = h("div.lc-card-banner");
      const paintBanner = () => {
        banner.style.background = bannerUrl
          ? `url("${bannerUrl}") center / cover no-repeat, #0b0e11`
          : `linear-gradient(135deg, ${color}, #0b0e11)`;
      };
      paintBanner();
      let avEl = avatar(u, "lg", u.online);
      const bio = h("div.bio", null, u.bio || "No bio yet.");
      const actions = h("div.row");
      const card = h("div.lc-card", { role: "dialog", "aria-label": `${u.username} profile` }, banner,
        h("div.lc-card-body", null,
          avEl,
          h("h3", { style: `color:${u.color}` }, u.username, roleBadge(u.role, true)),
          h("p.meta", null, `Joined ${new Date(u.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${u.messages.toLocaleString()} messages${u.banned ? " · Banned" : ""}`),
          bio, actions));
      overlay.append(card);
      wrap.append(overlay);

      const setFriend = async (method) => {
        try { const r = await api(method, `/api/friends/${encodeURIComponent(u.username)}`); data.friendship = r.friendship; drawActions(); loadFriends(); } catch {}
      };
      // Staff controls. The server re-checks every one of these; the card only shows what you're allowed to do.
      const staffCall = async (method, path, body) => {
        try { await api(method, `/api/users/${encodeURIComponent(u.username)}${path}`, body); return true; }
        catch (ex) { flashStatus(ex.message); return false; }
      };
      // Destructive buttons need a second click within 4 seconds, so a stray click can't ban anyone.
      const confirmBtn = (label, sure, run) => {
        let timer = null;
        const b = h("button.lc-btn.small.danger", { type: "button", onclick: () => {
          if (!timer) { b.textContent = sure; timer = setTimeout(() => { timer = null; b.textContent = label; }, 4000); return; }
          clearTimeout(timer); timer = null; b.disabled = true; run();
        } }, label);
        return b;
      };
      const staffPanel = () => {
        const c = data.can;
        const rows = [];
        const refresh = () => showProfile(u.username);
        if (c.removeMedia)
          rows.push(h("div.lc-modrow", null,
            h("button.lc-btn.small.ghost", { type: "button", disabled: !u.avatar, onclick: async () => { if (await staffCall("DELETE", "/avatar")) refresh(); } }, "Remove picture"),
            h("button.lc-btn.small.ghost", { type: "button", disabled: !u.banner, onclick: async () => { if (await staffCall("DELETE", "/banner")) refresh(); } }, "Remove banner")));
        if (c.lockMedia)
          rows.push(h("div.lc-modrow", null,
            h("button.lc-btn.small.ghost", { type: "button", onclick: async () => { if (await staffCall("PATCH", "/media-lock", { locked: !u.media_locked })) refresh(); } },
              u.media_locked ? "Allow picture & banner changes" : "Restrict picture & banner changes")));
        if (c.ban)
          rows.push(h("div.lc-modrow", null, u.banned
            ? h("button.lc-btn.small.ghost", { type: "button", onclick: async () => {
                if (await staffCall("DELETE", "/ban")) { flashStatus(`${u.username} was unbanned.`, 5000); refreshMembers(); refresh(); }
              } }, "Unban")
            : confirmBtn("Ban from chat", "Sure? This wipes all their messages", async () => {
                if (await staffCall("POST", "/ban")) { flashStatus(`${u.username} was banned and their messages were removed.`, 6000); refresh(); }
                else refresh();
              })));
        if (c.deleteAccount)
          rows.push(h("div.lc-modrow", null, confirmBtn("Delete account", "Sure? This can't be undone", async () => {
            if (await staffCall("DELETE", "")) { closeOverlay(); flashStatus(`${u.username}'s account was deleted.`, 6000); }
            else refresh();
          })));
        return h("div.lc-mod", null, h("div.lbl", null, "Moderation"), ...rows);
      };

      const drawActions = () => {
        if (data.self) {
          const ta = h("textarea", { maxlength: 200, placeholder: "Write a short bio" });
          ta.value = u.bio || "";
          const swatches = h("div.lc-colors", null, COLORS.map((c) =>
            h("button" + (c === color ? ".sel" : ""), { type: "button", style: `background:${c}`, "aria-label": c, onclick: (e) => {
              color = c; swatches.querySelectorAll("button").forEach((b) => b.classList.remove("sel")); e.currentTarget.classList.add("sel");
              paintBanner();
            } })));

          // Picture / banner edits are previewed instantly and only sent when you press Save.
          const pending = {};            // slot -> undefined (unchanged) | null (remove) | Blob (new image)
          const previews = [];
          overlayCleanup = () => previews.forEach((url) => URL.revokeObjectURL(url));
          const imgErr = h("div.lc-imgerr", { hidden: true });
          const showAvatar = (url) => {
            const next = avatar({ ...u, color, avatar: url }, "lg", u.online);
            avEl.replaceWith(next); avEl = next;
          };
          const imageRow = (label, slot, [w, hgt], preview, onRemove) => {
            const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
            input.addEventListener("change", async () => {
              const file = input.files[0];
              input.value = "";
              if (!file) return;
              imgErr.hidden = true;
              try {
                const blob = await cropToBlob(file, w, hgt);
                const url = URL.createObjectURL(blob);
                previews.push(url);
                pending[slot] = blob;
                preview(url);
              } catch (ex) { imgErr.textContent = ex.message; imgErr.hidden = false; }
            });
            return h("div.lc-imgrow", null, h("span.lbl", null, label), input,
              h("button", { type: "button", onclick: () => input.click() }, "Upload"),
              h("button.danger", { type: "button", onclick: () => { pending[slot] = null; imgErr.hidden = true; onRemove(); } }, "Remove"));
          };
          const imageCtl = h("div.lc-imgctl", null,
            imageRow("Profile picture", "avatar", AVATAR_SIZE, showAvatar, () => showAvatar(null)),
            imageRow("Banner", "banner", BANNER_SIZE, (url) => { bannerUrl = url; paintBanner(); }, () => { bannerUrl = null; paintBanner(); }),
            h("div.lc-imgnote", null, "Images are cropped to fit. PNG, JPEG, WebP or GIF (GIFs become still images)."),
            imgErr);

          bio.replaceWith(ta);
          const body = card.querySelector(".lc-card-body");
          body.insertBefore(u.media_locked
            ? h("div.lc-imgctl", null, h("div.lc-imgnote", null, "Staff have restricted changes to your profile picture and banner."))
            : imageCtl, actions);
          body.insertBefore(swatches, actions);
          actions.replaceChildren(
            h("button.lc-btn.small", { type: "button", onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              imgErr.hidden = true;
              try {
                for (const slot of ["avatar", "banner"]) {
                  if (pending[slot] === undefined) continue;
                  const r = pending[slot] === null ? await api("DELETE", `/api/me/${slot}`) : await uploadImage(slot, pending[slot]);
                  me[slot] = r[slot];
                }
                await api("PATCH", "/api/me", { bio: ta.value, color });
                me.bio = ta.value;
                applyProfile({ userId: me.id, color, avatar: me.avatar });
                closeOverlay();
              } catch (ex) {
                imgErr.textContent = ex.message; imgErr.hidden = false;
                btn.disabled = false;
              }
            } }, "Save"),
            h("button.lc-btn.small.ghost", { type: "button", onclick: dismissOverlay }, "Cancel"));
          return;
        }
        // Owners can manage member/mod/admin roles. Admins can promote/demote people
        // below them between member and moderator. Neither can change their own role,
        // and the server enforces the same hierarchy even if the UI is bypassed.
        const roleChoices = me.role === "owner" ? ["member", "mod", "admin"]
          : me.role === "admin" && ["member", "mod"].includes(u.role) ? ["member", "mod"]
          : null;
        if (roleChoices && u.role !== "owner" && !card.querySelector(".lc-rolepick")) {
          const pick = h("div.lc-rolepick", { "data-role-for": u.username }, h("div.lbl", null, "Role"),
            h("div.opts", null, roleChoices.map((r) =>
              h("button" + (u.role === r ? ".sel" : "") + "." + r, { type: "button", onclick: async () => {
                if (u.role === r) return;
                try { await api("PATCH", `/api/users/${encodeURIComponent(u.username)}/role`, { role: r }); }
                catch (ex) { flashStatus(ex.message); }
              } }, ROLE_LABEL[r]))));
          card.querySelector(".lc-card-body").insertBefore(pick, actions);
        }
        if (data.can && Object.values(data.can).some(Boolean) && !card.querySelector(".lc-mod")) {
          card.querySelector(".lc-card-body").insertBefore(staffPanel(), actions);
        }
        if (u.banned) {
          actions.replaceChildren(h("button.lc-btn.small.ghost", { type: "button", onclick: dismissOverlay }, "Close"));
          return;
        }
        const f = data.friendship;
        // Native replaceChildren() turns null into the literal text "null". Build
        // the button list explicitly so empty conditional buttons are never rendered.
        const actionButtons = [];
        if (f === "friends") {
          actionButtons.push(
            h("button.lc-btn.small", { type: "button", onclick: () => { closeOverlay(); openDm(u); } }, "Message"),
            h("button.lc-btn.small.ghost", { type: "button", onclick: () => setFriend("DELETE") }, "Friends ✓ · Remove")
          );
        } else if (f === "requested") {
          actionButtons.push(h("button.lc-btn.small.ghost", { type: "button", onclick: () => setFriend("DELETE") }, "Request sent · Cancel"));
        } else {
          actionButtons.push(h("button.lc-btn.small", { type: "button", onclick: () => setFriend("POST") }, f === "incoming" ? "Accept request" : "Add friend"));
        }
        actionButtons.push(
          f === "incoming"
            ? h("button.lc-btn.small.ghost", { type: "button", onclick: () => setFriend("DELETE") }, "Decline")
            : h("button.lc-btn.small.ghost", { type: "button", onclick: dismissOverlay }, "Close")
        );
        actions.replaceChildren(...actionButtons);
      };
      drawActions();
    }

    async function signOut() {
      try { await api("POST", "/api/auth/logout"); } catch {}
      me = null; current = null; cache.clear(); unread.clear(); typing.clear();
      sideTab = "channels"; friendsData = { friends: [], incoming: [], outgoing: [] };
      dmPeer = null; dmCache.clear(); dmUnread.clear();
      showAuth("signin", "You've been signed out.");
    }

    const onKeyGlobal = (e) => { if (e.key === "Escape") dismissOverlay(); };
    document.addEventListener("keydown", onKeyGlobal);

    // ---------------- boot ----------------
    wrap.replaceChildren(h("div.lc-auth", null, h("p.sub", { style: "color:#8b8f99" }, "Loading…")));
    const resetMatch = /^#reset=([a-f0-9]{64})$/.exec(location.hash);
    if (resetMatch) {
      history.replaceState(null, "", location.pathname + location.search); // keep the token out of the address bar
      closeSocket();
      showReset(resetMatch[1]);
    } else {
      api("GET", "/api/me").then((r) => { me = r.user; startChat(); }).catch(() => showAuth("signin"));
    }

    return () => {
      disposed = true;
      closeSocket();
      closeOverlay();
      document.removeEventListener("keydown", onKeyGlobal);
      for (const map of typing.values()) for (const v of map.values()) clearTimeout(v.timer);
    };
  }

  window.LemniscateChat = { mount };
})();
