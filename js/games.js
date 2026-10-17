/**
 * Game registry. Entries come from public/js/games-manifest.js, which
 * scripts/sync-games.mjs generates from the repos in scripts/game-sources.json.
 */
(function (global) {
  const manifest = global.GAMES_MANIFEST || { sources: [], games: [] };

  const GAMES = manifest.games.map((g) => ({
    id: g.id,
    title: g.title,
    blurb: g.sourceName,
    tag: g.sourceName,
    source: g.source,
    path: g.path,
    thumb: g.thumb,
  }));
  const byId = new Map(GAMES.map((g) => [g.id, g]));

  // Proxied games ("Export Saves" and similar) build a file in memory and download it from a
  // temporary blob: link. The proxy rewrites that link, so Chrome says "File wasn't available on
  // site". The proxied page runs on this same origin, so we can reach into its window, remember
  // the blobs it creates, and when it tries to download one, save it from out here instead.
  // Everything is wrapped in try/catch: if anything is unexpected, the game behaves as before.
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download";
    a.style.display = "none";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function patchDownloads(frame) {
    let win;
    try {
      win = frame.contentWindow;
      if (!win || win.__lemniscateDl || !win.URL || !win.HTMLAnchorElement) return;
      win.__lemniscateDl = true;
    } catch (_) {
      return;
    }

    const blobs = []; // [{ id, blob }], newest last
    const idOf = (u) => {
      const m = UUID.exec(String(u || ""));
      return m ? m[0].toLowerCase() : null;
    };
    const find = (u) => {
      const id = idOf(u);
      if (!id) return null;
      for (let i = blobs.length - 1; i >= 0; i--) if (blobs[i].id === id) return blobs[i].blob;
      return null;
    };

    try {
      const create = win.URL.createObjectURL;
      win.URL.createObjectURL = function (obj) {
        const url = create.apply(this, arguments);
        try {
          if (obj instanceof win.Blob) {
            const id = idOf(url);
            if (id) {
              blobs.push({ id, blob: obj });
              if (blobs.length > 8) blobs.shift();
            }
          }
        } catch (_) {}
        return url;
      };
    } catch (_) {}

    // Returns true when we handled the download ourselves.
    const intercept = (a) => {
      try {
        if (!a || a.download === undefined || !a.hasAttribute("download")) return false;
        const blob = find(a.href) || find(a.getAttribute("href"));
        if (!blob) return false;
        saveBlob(blob, a.getAttribute("download") || "download");
        return true;
      } catch (_) {
        return false;
      }
    };

    try {
      const click = win.HTMLAnchorElement.prototype.click;
      win.HTMLAnchorElement.prototype.click = function () {
        if (intercept(this)) return;
        return click.apply(this, arguments);
      };
      const dispatch = win.EventTarget.prototype.dispatchEvent;
      win.EventTarget.prototype.dispatchEvent = function (ev) {
        if (ev && ev.type === "click" && this instanceof win.HTMLAnchorElement && intercept(this)) return true;
        return dispatch.apply(this, arguments);
      };
      // A real click on a visible download link.
      win.document.addEventListener(
        "click",
        (ev) => {
          const a = ev.target && ev.target.closest ? ev.target.closest("a[download]") : null;
          if (a && intercept(a)) ev.preventDefault();
        },
        true
      );
    } catch (_) {}
  }

  // Self-hosted games load from your own domain. Games with a /scramjet/ path (remote sources
  // such as Selenite) open through the proxy, which must be loaded and connected first.
  const launch = (g) => (root) => {
    const f = document.createElement("iframe");
    f.allow = "fullscreen; autoplay; clipboard-read; clipboard-write";
    f.setAttribute("allowfullscreen", "");
    f.style.cssText = "display:block;width:100%;height:100%;border:0;background:#000;";
    let closed = false;

    // The card button you clicked keeps keyboard focus, so keys never reached the game and
    // Enter "clicked" the card again (restarting it). Move focus into the game instead.
    const grab = () => {
      try { f.focus(); f.contentWindow && f.contentWindow.focus(); } catch (_) {}
    };
    const start = () => {
      if (closed) return;
      note.remove();
      f.src = g.path;
      root.append(f);
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      f.tabIndex = 0;
      grab();
      f.addEventListener("load", grab);
      if (g.path.startsWith("/scramjet/")) f.addEventListener("load", () => patchDownloads(f));
    };

    const note = document.createElement("div");
    note.textContent = "Connecting\u2026";
    note.style.cssText =
      "display:flex;align-items:center;justify-content:center;height:100%;color:#7dff8a;font:500 14px system-ui,sans-serif;";

    if (g.path.startsWith("/scramjet/") && typeof window.__loadProxy === "function") {
      root.append(note);
      Promise.resolve(window.__loadProxy())
        .then(() => (typeof window.__prepareProxy === "function" ? window.__prepareProxy() : null))
        .catch((err) => console.error("[games] proxy setup failed", err))
        .then(start);
    } else {
      start();
    }
    return () => {
      closed = true;
      note.remove();
      f.remove();
    };
  };

  global.LabGames = {
    list: GAMES,
    sources: manifest.sources,
    start(id, root) {
      root.replaceChildren();
      const g = byId.get(id);
      if (!g) {
        root.textContent = "Unknown module.";
        return () => {};
      }
      return launch(g)(root);
    },
  };
})(window);
