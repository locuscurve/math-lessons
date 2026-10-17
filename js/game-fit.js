/**
 * Fits games to the player window.
 *
 * Some games ship a fixed-size canvas (Half-Life is 1000x750) sitting in the top-left corner of
 * a grey or white page, or a canvas bigger than the window that adds scrollbars and white edges.
 * While a game is open this finds the game's main canvas and, when it doesn't already fill the
 * window, scales it up or down and centres it on a black background. The page is scaled as a
 * whole, so the game itself is not modified and mouse input keeps working.
 *
 * Only games served from your own domain can be adjusted (self-hosted games and Selenite games
 * opened through the proxy). Anything else is left alone.
 */
(() => {
  const root = document.getElementById("modal-body");
  if (!root) return;

  // Pages whose address contains one of these strings are never touched, e.g. ["/games/seraph/slope/"].
  const SKIP = [];
  const MAX_ZOOM = 3; // never enlarge a game more than 3x
  const MIN_SHARE = 0.25; // the canvas must be at least 25% of the window to count as "the game"
  const TICK_MS = 500; // games create and resize their canvas late, so re-check twice a second...
  const FAST_TICKS = 24; // ...but only for the first ~12 seconds while the game loads
  const SLOW_TICK_MS = 3000; // after that, a cheap check every 3s that only re-fits if something changed

  const CANDIDATES = "canvas, iframe, embed, object, video, ruffle-player";
  const STYLE_ID = "lv-fit-style";
  const CSS =
    // Only the background COLOUR is overridden, never the "background" shorthand. The shorthand also
    // wipes background-image and background-clip, which is how many games draw their rainbow/gradient
    // "LOADING..." text (a gradient clipped to the letters). Wiping it left the text invisible.
    "html{background-color:#000!important;overflow:hidden!important}" +
    "body{margin:0!important;background-color:transparent!important;transform-origin:0 0!important}" +
    // The boxes around the game (their own grey/dark backgrounds) would otherwise slide sideways
    // with the scaled page and show up as a coloured strip on one side. Make them black too.
    "[data-lv-fit]{background-color:#000!important}";
  const MARK = "data-lv-fit";

  const hooked = new WeakSet(); // documents that already have a resize listener
  const lastSeen = new WeakMap(); // frame -> what the page looked like at the last fit

  const mainElement = (doc, vw, vh) => {
    let best = null;
    let bestArea = 0;
    for (const el of doc.querySelectorAll(CANDIDATES)) {
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best && bestArea >= MIN_SHARE * vw * vh ? best : null;
  };

  const reset = (doc) => {
    const style = doc.getElementById(STYLE_ID);
    if (style) style.remove();
    if (doc.body) doc.body.style.removeProperty("transform");
    doc.querySelectorAll("[" + MARK + "]").forEach((n) => n.removeAttribute(MARK));
  };

  // A cheap fingerprint of the page: window size, and how many candidate elements there are.
  // Reading these does not need the page to be un-scaled first, so it can run often.
  const fingerprint = (doc, win) => {
    const els = doc.querySelectorAll(CANDIDATES);
    let sig = win.innerWidth + "x" + win.innerHeight + "|" + els.length;
    for (const el of els) sig += "|" + el.offsetWidth + "x" + el.offsetHeight;
    return sig;
  };

  const fit = (frame) => {
    let doc, win;
    try {
      doc = frame.contentDocument;
      win = frame.contentWindow;
    } catch (_) {
      return; // different origin: not allowed to touch it
    }
    if (!doc || !doc.body || !win || !doc.documentElement) return;
    if (SKIP.some((s) => String(frame.src || "").includes(s))) return;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    if (!vw || !vh) return;

    // 1. Measure the page the way the game made it.
    reset(doc);
    if (!mainElement(doc, vw, vh)) return; // no obvious game canvas: leave the page alone

    // 2. Remove margins/scrollbars/background, then measure again from the corner of the page.
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
    if (win.scrollX || win.scrollY) win.scrollTo(0, 0);
    const el = mainElement(doc, vw, vh);
    if (!el) return reset(doc);
    const r = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== doc.documentElement; a = a.parentElement) {
      // Leave alone anything that paints text with its background (gradient text): blacking it out hides the text.
      let clipsText = false;
      try {
        const cs = win.getComputedStyle(a);
        clipsText = (cs.webkitBackgroundClip || cs.backgroundClip) === "text";
      } catch (_) {}
      if (!clipsText) a.setAttribute(MARK, "");
    }

    // 3. Scale to fit and centre.
    const k = Math.min(MAX_ZOOM, Math.min(vw / r.width, vh / r.height));
    const x = (vw - k * r.width) / 2 - k * r.left;
    const y = (vh - k * r.height) / 2 - k * r.top;
    const same = Math.abs(k - 1) < 0.005 && Math.abs(x) < 1.5 && Math.abs(y) < 1.5;
    if (!same) doc.body.style.setProperty("transform", `translate(${x}px, ${y}px) scale(${k})`, "important");
    lastSeen.set(frame, fingerprint(doc, win));

    if (!hooked.has(doc)) {
      hooked.add(doc);
      win.addEventListener("resize", () => fit(frame)); // window resized or fullscreen toggled
    }
  };

  const watch = (frame) => {
    let ticks = 0;
    let timer = 0;
    const tick = () => {
      if (!frame.isConnected) return;
      try {
        if (!document.hidden) {
          ticks++;
          const doc = frame.contentDocument;
          const win = frame.contentWindow;
          // While loading, fit every time. Afterwards, only fit when the page really changed:
          // re-fitting un-scales and re-measures the whole game, which costs a frame or two.
          if (ticks <= FAST_TICKS || !doc || !win || lastSeen.get(frame) !== fingerprint(doc, win)) fit(frame);
        }
      } catch (_) {}
      timer = setTimeout(tick, ticks < FAST_TICKS ? TICK_MS : SLOW_TICK_MS);
    };
    frame.addEventListener("load", () => {
      ticks = 0; // a new page loaded inside the frame: go back to checking often
      lastSeen.delete(frame);
      clearTimeout(timer);
      tick();
    });
    tick();
  };

  // The games page adds the iframe to the player window; start fitting it as soon as it appears.
  new MutationObserver((records) => {
    for (const rec of records)
      for (const node of rec.addedNodes) if (node.nodeName === "IFRAME") watch(node);
  }).observe(root, { childList: true });
})();
