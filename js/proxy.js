// Connects the Lemniscate search bar to the Scramjet proxy.
//
// Press Enter in the home search bar: a URL opens directly, anything else becomes
// a Google search (hl=en). The page opens in a full-screen viewer with a browser
// toolbar: Home, Back, Forward, Reload, an address bar that shows the current
// link and lets you change it, a star that adds/removes a bookmark on the home
// page, and a Full screen toggle.
//
// The connection type (Epoxy or libcurl) comes from Settings > Advanced.
//
// Depends on (loaded earlier in index.html): scramjet.all.js, BareMux,
// register-sw.js (registerSW) and search.js (search). js/bookmarks.js is
// optional; without it the star shows a message instead of saving.
(() => {
  "use strict";

  // Default search engine comes from Settings > Proxy (Brave unless changed).
  const SEARCH_ENGINES = {
    google: "https://www.google.com/search?q=%s&hl=en",
    duckduckgo: "https://duckduckgo.com/?q=%s",
    bing: "https://www.bing.com/search?q=%s",
    brave: "https://search.brave.com/search?q=%s",
  };
  const searchTemplate = () => {
    try {
      const s = JSON.parse(localStorage.getItem("lemniscate-lab-settings") || "{}");
      return SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.brave;
    } catch (_) {
      return SEARCH_ENGINES.brave;
    }
  };

  const input = document.getElementById("search");
  if (!input) return;

  if (typeof $scramjetLoadController !== "function" || typeof BareMux === "undefined") {
    console.error("[proxy] Scramjet or BareMux failed to load; the search bar will not open pages.");
    return;
  }

  const { ScramjetController } = $scramjetLoadController();

  // Bump this query value when changing the Scramjet package to avoid a stale cached
  // WASM response after deployment. The server route ignores the query string.
  const SCRAMJET_WASM_URL = "/scram/scramjet.wasm.wasm?v=lemniscate-20261015-1";

  // Fail early with a readable error if the host returns a 404 page/HTML fallback
  // instead of the WebAssembly binary. Scramjet's own loader otherwise reports only
  // "rewriter wasm not found" and pages can appear to hang on a black screen.
  async function verifyScramjetWasm() {
    let response;
    try {
      response = await fetch(SCRAMJET_WASM_URL, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Range: "bytes=0-3" },
      });
    } catch (err) {
      throw new Error(`Could not request ${SCRAMJET_WASM_URL}: ${String(err)}`);
    }

    if (!response.ok) {
      const status = response.status;
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error(`${SCRAMJET_WASM_URL} returned HTTP ${status}; check the deployed Scramjet asset route.`);
    }

    const contentType = response.headers.get("content-type") || "(missing)";
    const prefix = [];
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;

    if (reader) {
      try {
        while (prefix.length < 4) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const byte of value) {
            prefix.push(byte);
            if (prefix.length === 4) break;
          }
        }
      } finally {
        try { await reader.cancel(); } catch (_) {}
        reader.releaseLock();
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      prefix.push(...bytes.subarray(0, 4));
    }

    // A WebAssembly binary begins with the four bytes 00 61 73 6d ("\0asm").
    if (prefix.length < 4 || prefix[0] !== 0 || prefix[1] !== 0x61 || prefix[2] !== 0x73 || prefix[3] !== 0x6d) {
      throw new Error(
        `${SCRAMJET_WASM_URL} did not return a WebAssembly binary (Content-Type: ${contentType}). ` +
        "The server may be returning HTML/404 content instead of the WASM file."
      );
    }
  }

  const scramjet = new ScramjetController({
    files: {
      wasm: SCRAMJET_WASM_URL,
      all: "/scram/scramjet.all.js",
      sync: "/scram/scramjet.sync.js",
    },
  });

  // init() saves Scramjet's settings where the service worker reads them. Preserve a
  // rejected promise so launch()/prepare() can stop instead of opening a broken frame.
  const scramjetReady = (async () => {
    await verifyScramjetWasm();
    await scramjet.init();
  })();
  scramjetReady.catch((e) => console.error("[proxy] Scramjet initialization failed", e));

  const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

  // Epoxy unless Settings > Advanced says libcurl.
  const transportPath = () => {
    try {
      const s = JSON.parse(localStorage.getItem("lemniscate-lab-settings") || "{}");
      return s.transport === "libcurl" ? "/libcurl/index.mjs" : "/epoxy/index.mjs";
    } catch (_) {
      return "/epoxy/index.mjs";
    }
  };

  let overlay = window.__proxyStartupShell || null;
  window.__proxyStartupShell = null;
  window.__closeProxyStartup = null;
  let frame = null;
  let ui = null;
  let currentUrl = "";
  let pollTimer = 0;
  let busy = false;
  let launchGeneration = 0;
  let linkObserver = null;

  // ---- small error toast ----
  const toast = document.createElement("div");
  toast.style.cssText =
    "position:fixed;left:50%;top:1rem;transform:translateX(-50%);z-index:70;max-width:min(32rem,92vw);" +
    "padding:.75rem 1rem;border-radius:.75rem;border:1px solid rgba(255,102,102,.4);" +
    "background:rgba(20,8,8,.95);color:#ff9a9a;font:13px Inter,system-ui,sans-serif;display:none;white-space:pre-wrap;";
  toast.className = "lv-toast";
  document.body.appendChild(toast);
  let toastTimer = 0;
  const showError = (message, detail) => {
    toast.textContent = detail ? `${message}\n${detail}` : message;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.style.display = "none"), 8000);
  };

  // ---- toolbar styles and icons ----
  const style = document.createElement("style");
  style.textContent = `
    .lv-btn{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:34px;height:34px;border:0;border-radius:.5rem;background:transparent;color:#a1a1aa;cursor:pointer;transition:color .15s,background .15s}
    .lv-btn:hover{color:#fff;background:rgba(255,255,255,.08)}
    .lv-btn:focus-visible{outline:2px solid #7ee8ff;outline-offset:1px}
    .lv-btn svg{width:18px;height:18px}
    @keyframes lv-spin{to{transform:rotate(360deg)}}
    @keyframes lv-icon-in{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
    html:not(.motion-reduce) .lv-btn.lv-loading{color:#e4e4e7}
    html:not(.motion-reduce) .lv-btn.lv-loading svg{animation:lv-spin .8s linear infinite}
    html:not(.motion-reduce) .lv-btn.lv-swap svg{animation:lv-icon-in .18s ease backwards}
    .lv-btn[data-on="true"]{color:#7dff8a}
    .lv-addr{flex:1;min-width:0;height:34px;margin:0 .35rem;border-radius:999px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#e4e4e7;padding:0 .95rem;font:13px Inter,system-ui,sans-serif;outline:none}
    .lv-addr:focus{border-color:rgba(126,232,255,.5);background:rgba(255,255,255,.08)}
    .lv-bar.lv-fs{position:absolute;top:0;left:0;right:0;z-index:3;transform:translateY(-100%);transition:transform .18s ease}
    .lv-bar.lv-fs.lv-show{transform:translateY(0)}
    .lv-hot{display:none;position:absolute;top:0;left:0;right:0;height:10px;z-index:2}
    .lv-hot.lv-fs{display:block}
  `;
  document.head.appendChild(style);

  const svg = (inner, fill) =>
    `<svg viewBox="0 0 24 24" fill="${fill || "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const STAR = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
  const ICONS = {
    home: svg('<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>'),
    back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
    forward: svg('<path d="M5 12h14M12 5l7 7-7 7"/>'),
    reload: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    spinner: svg('<circle cx="12" cy="12" r="9" opacity=".25"/><path d="M12 3a9 9 0 0 1 9 9"/>'),
    star: svg(STAR),
    starOn: svg(STAR, "currentColor"),
    full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),
    exitFull: svg('<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>'),
  };

  function makeButton(label, icon, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lv-btn";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = icon;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- current page state ----
  function isBookmarked() {
    const bm = window.LemniscateBookmarks;
    return !!(bm && currentUrl && bm.has(currentUrl));
  }

  function refreshStar() {
    if (!ui) return;
    const on = isBookmarked();
    ui.star.dataset.on = String(on);
    ui.star.innerHTML = on ? ICONS.starOn : ICONS.star;
    const label = on ? "Remove bookmark" : "Bookmark this page";
    ui.star.title = label;
    ui.star.setAttribute("aria-label", label);
  }

  function setCurrent(url) {
    const next = url ? String(url) : "";
    if (!/^https?:/i.test(next) || next === currentUrl) return;
    currentUrl = next;
    if (ui && document.activeElement !== ui.addr) ui.addr.value = currentUrl;
    refreshStar();
  }

  function pageTitle() {
    try {
      const t = frame.frame.contentDocument.title.trim();
      if (t) return t;
    } catch (_) {}
    try {
      return new URL(currentUrl).hostname.replace(/^www\./, "");
    } catch (_) {
      return currentUrl;
    }
  }

  // ---- toolbar actions ----
  const win = () => {
    try {
      return frame.frame.contentWindow;
    } catch (_) {
      return null;
    }
  };
  const actions = {
    back: () => (typeof frame.back === "function" ? frame.back() : win()?.history.back()),
    forward: () => (typeof frame.forward === "function" ? frame.forward() : win()?.history.forward()),
    reload: () => (typeof frame.reload === "function" ? frame.reload() : win()?.location.reload()),
  };

  // Reload button: swaps to a spinning ring while the page reloads, then back to the icon.
  // Does nothing extra when Settings > Reduce Motion/Animations is on.
  let endReloadSpin = null;
  function reloadWithSpin() {
    actions.reload();
    if (!ui || !frame || document.documentElement.classList.contains("motion-reduce")) return;
    if (endReloadSpin) endReloadSpin(true);

    const btn = ui.reload;
    const iframe = frame.frame;
    const started = performance.now();
    let timer = 0;
    let finished = false;

    const finish = (silent) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      iframe.removeEventListener("load", onLoad);
      endReloadSpin = null;
      if (silent) return; // a newer click is taking over the button
      btn.classList.remove("lv-loading");
      btn.classList.add("lv-swap");
      btn.innerHTML = ICONS.reload;
      setTimeout(() => btn.classList.remove("lv-swap"), 220);
    };
    const onLoad = () => {
      timer = setTimeout(finish, Math.max(0, 700 - (performance.now() - started)));
    };

    btn.classList.remove("lv-swap");
    btn.classList.add("lv-loading");
    btn.innerHTML = ICONS.spinner;
    iframe.addEventListener("load", onLoad, { once: true });
    timer = setTimeout(finish, 10000);
    endReloadSpin = finish;
  }

  function goTo(text) {
    const t = text.trim();
    if (!t || !frame) return;
    const target = search(t, searchTemplate());
    frame.go(target);
    ui.addr.blur();
    setCurrent(target);
  }

  function toggleBookmark() {
    const bm = window.LemniscateBookmarks;
    if (!bm) {
      showError("Bookmarks are not available on this page.");
      return;
    }
    if (!currentUrl) return;
    if (bm.has(currentUrl)) {
      bm.remove(currentUrl);
    } else {
      const result = bm.add({ name: pageTitle(), url: currentUrl });
      if (result && !result.ok) showError(result.message || "Could not add that bookmark.");
    }
    refreshStar();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (overlay && overlay.requestFullscreen) {
      overlay.requestFullscreen().catch(() => showError("Full screen is not available in this browser."));
    } else {
      showError("Full screen is not available in this browser.");
    }
  }

  document.addEventListener("fullscreenchange", () => {
    if (!ui) return;
    const on = !!document.fullscreenElement;
    // In full screen the toolbar hides; move the mouse to the top edge to bring it back.
    ui.bar.classList.toggle("lv-fs", on);
    ui.hot.classList.toggle("lv-fs", on);
    ui.bar.classList.remove("lv-show");
    ui.full.innerHTML = on ? ICONS.exitFull : ICONS.full;
    ui.full.title = on ? "Exit full screen" : "Full screen";
    ui.full.setAttribute("aria-label", ui.full.title);
  });

  // ---- full-screen viewer ----
  function closeViewer() {
    launchGeneration++;
    clearInterval(pollTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (endReloadSpin) endReloadSpin(true);
    const old = overlay;
    overlay = null;
    if (linkObserver) { linkObserver.disconnect(); linkObserver = null; }
    frame = null;
    ui = null;
    currentUrl = "";
    window.__closeProxyStartup = null;
    if (!old) return;
    if (document.documentElement.classList.contains("motion-reduce")) {
      old.remove();
    } else {
      // Fade out, then remove (see css/animations.css).
      old.classList.add("lv-closing");
      setTimeout(() => old.remove(), 330);
    }
  }

  function showLoadingViewer(url) {
    if (overlay) {
      const address = overlay.querySelector("[data-proxy-loading-url]");
      if (address) address.textContent = url;
      window.__closeProxyStartup = closeViewer;
      return;
    }
    currentUrl = url;
    overlay = document.createElement("div");
    overlay.className = "lv-viewer lv-viewer-loading";
    overlay.style.cssText = "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:#050607;";
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;align-items:center;gap:.75rem;min-height:48px;padding:.25rem .8rem;background:rgba(8,8,13,.95);border-bottom:1px solid rgba(255,255,255,.08);color:#e4e4e7;font:13px Inter,system-ui,sans-serif;";
    const close = makeButton("Back to Lemniscate", ICONS.home, closeViewer);
    const address = document.createElement("div");
    address.textContent = url;
    address.dataset.proxyLoadingUrl = "true";
    address.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#a1a1aa;";
    bar.append(close, address);
    const status = document.createElement("div");
    status.textContent = "Connecting to the proxy...";
    status.style.cssText = "flex:1;display:grid;place-items:center;color:#a1a1aa;font:14px Inter,system-ui,sans-serif;";
    overlay.append(bar, status);
    document.body.appendChild(overlay);
    window.__closeProxyStartup = closeViewer;
  }

  function openViewer() {
    currentUrl = "";
    overlay = overlay || document.createElement("div");
    overlay.className = "lv-viewer";
    overlay.style.cssText = "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:#050607;";
    overlay.replaceChildren();
    window.__closeProxyStartup = closeViewer;

    const bar = document.createElement("div");
    bar.className = "lv-bar";
    bar.style.cssText =
      "display:flex;align-items:center;gap:.15rem;min-height:48px;padding:.25rem .6rem;flex-shrink:0;" +
      "background:rgba(8,8,13,.95);border-bottom:1px solid rgba(255,255,255,.08);";

    frame = scramjet.createFrame();
    frame.frame.style.cssText = "flex:1;width:100%;border:0;background:#fff;";
    // Let the proxied page (for example a video player) use its own full screen button.
    frame.frame.setAttribute("allowfullscreen", "");
    frame.frame.setAttribute(
      "allow",
      "fullscreen; autoplay; encrypted-media; picture-in-picture; gamepad; pointer-lock"
    );

    const hot = document.createElement("div");
    hot.className = "lv-hot";
    hot.addEventListener("mouseenter", () => bar.classList.add("lv-show"));
    bar.addEventListener("mouseleave", () => {
      if (document.activeElement !== addr) bar.classList.remove("lv-show");
    });

    const addr = document.createElement("input");
    addr.type = "text";
    addr.className = "lv-addr";
    addr.placeholder = "Search or enter a URL";
    addr.setAttribute("aria-label", "Address");
    addr.autocomplete = "off";
    addr.spellcheck = false;
    addr.addEventListener("focus", () => addr.select());
    addr.addEventListener("blur", () => {
      addr.value = currentUrl;
      if (bar.classList.contains("lv-fs") && !bar.matches(":hover")) bar.classList.remove("lv-show");
    });
    addr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        goTo(addr.value);
      } else if (e.key === "Escape") {
        addr.blur();
      }
    });

    const star = makeButton("Bookmark this page", ICONS.star, toggleBookmark);
    const full = makeButton("Full screen", ICONS.full, toggleFullscreen);
    const reload = makeButton("Reload", ICONS.reload, reloadWithSpin);
    ui = { addr, star, full, bar, hot, reload };

    bar.append(
      makeButton("Back to Lemniscate", ICONS.home, closeViewer),
      makeButton("Back", ICONS.back, () => actions.back()),
      makeButton("Forward", ICONS.forward, () => actions.forward()),
      reload,
      addr,
      star,
      full
    );

    overlay.append(bar, frame.frame, hot);
    document.body.appendChild(overlay);

    // Keep links inside the current proxy viewer. Many websites mark normal links
  // with target="_blank", which would otherwise escape the Scramjet iframe and
  // open a real browser tab. Rewrite those links to the current page instead.
  function keepLinksInViewer() {
    if (!frame || !frame.frame) return;
    try {
      const doc = frame.frame.contentDocument;
      if (!doc) return;

      const fixLinks = (root) => {
        const links = root && root.querySelectorAll ? root.querySelectorAll('a[target="_blank"], area[target="_blank"]') : [];
        for (const link of links) link.setAttribute("target", "_self");
      };

      fixLinks(doc);
      if (linkObserver) linkObserver.disconnect();
      linkObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              if (node.matches?.('a[target="_blank"], area[target="_blank"]')) node.setAttribute("target", "_self");
              fixLinks(node);
            }
          }
        }
      });
      linkObserver.observe(doc.documentElement, { childList: true, subtree: true });
    } catch (_) {
      // The proxied document may briefly be unavailable while navigating.
    }
  }

  frame.frame.addEventListener("load", keepLinksInViewer);

  // Keep the address bar in sync with in-page navigation.
    frame.addEventListener("urlchange", (e) => setCurrent(e.url));
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      try {
        if (frame) setCurrent(frame.url);
      } catch (_) {}
    }, 1000);
  }

  // ---- reconnect ----
  // The service worker asks for this when the Wisp socket dropped (MuxTaskEnded etc.).
  // Setting the transport again opens a fresh socket.
  async function reconnectTransport() {
    const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
    await connection.setTransport(transportPath(), [{ wisp: wispUrl, websocket: wispUrl }]);
  }
  navigator.serviceWorker?.addEventListener("message", async (e) => {
    if (!e.data || e.data.lemniscate$type !== "reset-transport") return;
    const port = e.ports && e.ports[0];
    try {
      await reconnectTransport();
      port && port.postMessage({ ok: true });
    } catch (err) {
      console.error("[proxy] reconnect failed", err);
      port && port.postMessage({ ok: false });
    }
  });

  // ---- prepare (also used by proxied games) ----
  // A game opened straight from its card never goes through launch(), so the service worker
  // and the BareMux transport were never set up and the game stayed on a black screen.
  async function prepare() {
    try {
      await scramjetReady;
    } catch (err) {
      showError("Scramjet could not initialize. Check the WASM asset route.", String(err));
      throw err;
    }
    await registerSW();
    await navigator.serviceWorker.ready;
    const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
    const path = transportPath();
    if ((await connection.getTransport()) !== path) {
      // Epoxy reads "wisp", libcurl reads "websocket"; send both.
      await connection.setTransport(path, [{ wisp: wispUrl, websocket: wispUrl }]);
    }
  }
  window.__prepareProxy = prepare;

  // ---- launch ----
  async function launch(raw) {
    const text = raw.trim();
    if (!text || busy) return;
    busy = true;
    const launchId = ++launchGeneration;
    const url = search(text, searchTemplate());
    showLoadingViewer(url);
    currentUrl = url;
    try {
      try {
        await scramjetReady;
      } catch (err) {
        closeViewer();
        showError("Scramjet could not initialize. Check the WASM asset route.", String(err));
        return;
      }

      try {
        await registerSW();
        await navigator.serviceWorker.ready;
      } catch (err) {
        closeViewer();
        showError("Failed to register the service worker.", String(err));
        return;
      }

      if (launchId !== launchGeneration || !overlay) return;

      const wispUrl =
        (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
      const path = transportPath();
      if ((await connection.getTransport()) !== path) {
        // Epoxy reads "wisp", libcurl reads "websocket"; send both.
        await connection.setTransport(path, [{ wisp: wispUrl, websocket: wispUrl }]);
      }

      if (launchId !== launchGeneration || !overlay) return;
      if (!frame) openViewer();
      frame.go(url);
      setCurrent(url);
      input.value = "";
      input.blur();
    } catch (err) {
      closeViewer();
      showError("Could not open that page.", String(err));
    } finally {
      busy = false;
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    launch(input.value);
  });
})();
