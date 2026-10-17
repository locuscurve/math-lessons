// Loads the proxy engine (Scramjet + BareMux + proxy.js) only when it's first needed,
// instead of on every page load. Games never need it, so they no longer pay its RAM cost.
(() => {
  "use strict";

  const input = document.getElementById("search");
  if (!input) return;

  let loaded = false;
  let loading = null;

  const showStartupViewer = () => {
    if (window.__proxyStartupShell) return;
    window.__proxyStartupCancelled = false;
    const shell = document.createElement("div");
    shell.className = "lv-viewer lv-viewer-loading";
    shell.style.cssText = "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:#050607;";
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;align-items:center;gap:.75rem;min-height:48px;padding:.25rem .8rem;background:rgba(8,8,13,.95);border-bottom:1px solid rgba(255,255,255,.08);color:#e4e4e7;font:13px Inter,system-ui,sans-serif;";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "X";
    close.setAttribute("aria-label", "Back to Lemniscate");
    close.style.cssText = "width:34px;height:34px;border:0;border-radius:.5rem;background:transparent;color:#a1a1aa;font-size:24px;cursor:pointer;";
    close.addEventListener("click", () => {
      if (window.__closeProxyStartup) window.__closeProxyStartup();
      else {
        window.__proxyStartupCancelled = true;
        shell.remove();
        window.__proxyStartupShell = null;
      }
    });
    const address = document.createElement("div");
    address.textContent = input.value.trim();
    address.dataset.proxyLoadingUrl = "true";
    address.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#a1a1aa;";
    bar.append(close, address);
    const status = document.createElement("div");
    status.textContent = "Preparing the proxy...";
    status.style.cssText = "flex:1;display:grid;place-items:center;color:#a1a1aa;font:14px Inter,system-ui,sans-serif;";
    shell.append(bar, status);
    document.body.appendChild(shell);
    window.__proxyStartupShell = shell;
  };

  const addScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });

  const loadProxy = () => {
    if (loaded) return Promise.resolve();
    if (!loading) {
      loading = Promise.all([addScript("/scram/scramjet.all.js"), addScript("/baremux/index.js")])
        .then(() => addScript("js/proxy.js"))
        .then(() => {
          loaded = true;
        })
        .catch((err) => {
          loading = null;
          console.error("[proxy]", err);
        });
    }
    return loading;
  };
  window.__loadProxy = loadProxy;

  // Keep the proxy engine unloaded and unfetched until the user submits a URL.

  // First Enter: load the engine, then replay the Enter so proxy.js handles it.
  input.addEventListener(
    "keydown",
    (e) => {
      if (loaded || e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showStartupViewer();
      loadProxy().then(() => {
        if (!loaded) {
          window.__proxyStartupShell?.remove();
          window.__proxyStartupShell = null;
          return;
        }
        if (window.__proxyStartupCancelled) return;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
    },
    true
  );
})();
