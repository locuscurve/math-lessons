(() => {
  "use strict";

  const STORAGE_KEY = "lemniscate-lab-settings";

  // Add apps here: { id, title, blurb, kind, accent }, and a matching entry in cloudMount below.
  const CLOUD_APPS = [];

  const LEMNISCATE_SRC = "lemniscate";

  // Favorites: ids of starred games (regular and cloud), saved in this browser only.
  const FAV_KEY = "lemniscate-favorites";
  const loadFavs = () => {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch (_) {
      return [];
    }
  };
  let favIds = loadFavs();
  const isFav = (id) => favIds.includes(id);
  let onFavsChanged = () => {}; // set by the Games page so its tab count / Favorites list stay current
  const toggleFav = (id) => {
    favIds = isFav(id) ? favIds.filter((x) => x !== id) : [id, ...favIds]; // newest favorite first
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favIds));
    } catch (_) {}
    onFavsChanged();
    return isFav(id);
  };


  // Add per-item icon paths here, keyed by id. Items without one get a default glyph.
  const ICON_PATHS = {};
  const iconSvg = (id, size = 22) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[id] || "M12 3l9 9-9 9-9-9z"}"/></svg>`;

  const defaultSettings = () => ({
    reduceMotion: false,
    tabTitleSwap: false,
    aboutBlankCloak: false,
    accent: "signal",
    bookmarks: true,
    transport: "epoxy",
    searchEngine: "brave",
  });

  const loadSettings = () => {
    try {
      const defaults = defaultSettings();
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      // Only keep keys that still exist, so settings removed in newer versions don't linger.
      const known = Object.fromEntries(Object.entries(saved).filter(([k]) => k in defaults));
      return { ...defaults, ...known };
    } catch {
      return defaultSettings();
    }
  };

  const saveSettings = (s) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));

  let settings = loadSettings();
  let view = "home";
  let cleanupModal = () => {};
  let chatCleanup = () => {};
  let gamesCleanup = () => {};

  const els = {
    view: document.getElementById("view"),
    search: document.getElementById("search"),
    landing: document.getElementById("landing"),
    workspace: document.getElementById("workspace"),
    shortcuts: document.getElementById("shortcuts"),
    searchHome: document.getElementById("search-home-slot"),
    searchHeader: document.getElementById("search-header-slot"),
    header: document.getElementById("hdr"),
    count: document.getElementById("search-count"),
    countText: document.getElementById("search-count-text"),
    modal: document.getElementById("modal"),
    modalTitle: document.getElementById("modal-title"),
    modalBody: document.getElementById("modal-body"),
    modalIcon: document.getElementById("modal-icon"),
    modalFs: document.getElementById("modal-fs"),
    modalReport: document.getElementById("modal-report"),
    modalFav: document.getElementById("modal-fav"),
    report: document.getElementById("report-dialog"),
    reportGame: document.getElementById("report-game-name"),
    reportDiscord: document.getElementById("report-discord"),
  };

  // "Bookmarks" setting: when off, the home page shows only the search bar.
  const bookmarksStyle = document.createElement("style");
  bookmarksStyle.textContent = "html.bookmarks-off #bookmarks{display:none!important}";
  document.head.appendChild(bookmarksStyle);

  // Games page: hide the bottom nav bar so the page is only games.
  const gamesModeStyle = document.createElement("style");
  gamesModeStyle.textContent =
    "html.games-mode nav.dock{display:none!important}" +
    "#search::-webkit-search-cancel-button,#search::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}" +
    "#search::-ms-clear{display:none}";
  document.head.appendChild(gamesModeStyle);

  const applyChrome = () => {
    document.documentElement.classList.toggle("motion-reduce", settings.reduceMotion);
    document.documentElement.classList.toggle("bookmarks-off", !settings.bookmarks);
    window.dispatchEvent(new Event("lemniscate:settings"));
  };

  const navClass = (active) =>
    [
      "nav-btn text-sm font-medium tracking-wide transition",
      active ? "text-white data-[active=true]" : "text-zinc-400 hover:text-white",
    ].join(" ");

  // On the Games page the top bar only filters games. Registered before proxy.js, so this
  // runs first and stops Enter from opening a web page.
  els.search.addEventListener("keydown", (e) => {
    if (view === "games" && e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });

  const syncNav = () => {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      const on = btn.getAttribute("data-nav") === view;
      btn.setAttribute("data-active", on ? "true" : "false");
      btn.className = navClass(on);
    });
  };

  // The single search box lives on the landing page, or in the header on the other pages.
  const placeSearch = () => {
    const home = view === "home";
    const slot = home ? els.searchHome : els.searchHeader;
    const box = els.search.closest("label") || els.search;
    // Only move the box when it is actually in the wrong slot; moving a focused
    // input drops focus, and restore it if we do have to move it.
    if (box.parentElement !== slot) {
      const hadFocus = document.activeElement === els.search;
      slot.append(box);
      if (hadFocus) els.search.focus();
    }

    const total = view === "games" ? window.LabGames.list.length : view === "cloud" ? CLOUD_APPS.length : 0;
    els.count.hidden = home || view === "settings";
    els.countText.textContent = `${total.toLocaleString()} Total`;
    els.search.placeholder = view === "games" ? "Search games.." : "Search the web or enter a URL...";
    els.header.classList.toggle("hdr-plain", view === "settings");
  };

  const shortcutGlyph = (title) => {
    const cleaned = title.replace(/[^A-Za-z0-9]/g, "");
    return (cleaned.slice(0, 2) || "•").toUpperCase();
  };

  const renderShortcuts = () => {
    // Home shortcuts show apps only. Games live on the Games tab.
    const apps = CLOUD_APPS;
    const items = apps.map((a) => ({ ...a, source: "app" })).slice(0, 12);

    els.shortcuts.replaceChildren();
    if (!items.length) return;

    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "glass-tile group flex min-h-[7rem] w-full flex-col items-center gap-2.5 rounded-2xl border border-white/10 px-2 pb-3 pt-4";
      btn.innerHTML = `
        <span class="flex h-11 w-11 items-center justify-center rounded-xl border border-signal/25 bg-signal/10 text-signal">${iconSvg(item.id)}</span>
        <span class="w-full text-center text-xs leading-tight text-zinc-300 group-hover:text-white">${item.title}</span>
      `;
      btn.addEventListener("click", () => {
        if (item.source === "game") {
          openModal(item.title, (body) => window.LabGames.start(item.id, body), { game: true });
        } else {
          openModal(item.title, (body) => cloudMount[item.kind](body));
        }
      });
      els.shortcuts.append(btn);
    });
  };

  // Animations are on unless Settings > Appearance > Reduce Motion/Animations is enabled.
  const reduced = () => document.documentElement.classList.contains("motion-reduce");

  let modalCloseTimer = 0;
  const hideModal = () => {
    clearTimeout(modalCloseTimer);
    els.modal.classList.remove("lv-open", "lv-closing", "flex", "game-mode");
    document.documentElement.classList.remove("game-open");
    els.modal.classList.add("hidden");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    els.modalFs.hidden = true;
    els.modalReport.hidden = true;
    els.modalFav.hidden = true;
    currentFavId = null;
    els.report.hidden = true;
    els.modalIcon.hidden = true;
    els.modalBody.replaceChildren();
  };

  // opts.game = true opens the large player (top bar with name, star, flag, fullscreen and X buttons).
  // opts.favId = the id this window can favorite with the star button.
  let currentFavId = null;
  const syncFavBtn = () => {
    const on = currentFavId !== null && isFav(currentFavId);
    els.modalFav.setAttribute("aria-pressed", String(on));
    const label = on ? "Remove from favorites" : "Add to favorites";
    els.modalFav.title = label;
    els.modalFav.setAttribute("aria-label", label);
  };
  const openModal = (title, build, opts = {}) => {
    clearTimeout(modalCloseTimer);
    els.modal.classList.remove("lv-closing");
    cleanupModal();
    els.modal.classList.toggle("game-mode", !!opts.game);
    // While a game runs, the page behind it stops painting (see css/game-player.css) so the game gets the CPU/GPU.
    document.documentElement.classList.toggle("game-open", !!opts.game);
    els.modalFs.hidden = !opts.game;
    els.modalReport.hidden = !opts.game;
    currentFavId = opts.game && opts.favId ? opts.favId : null;
    els.modalFav.hidden = currentFavId === null;
    syncFavBtn();
    els.report.hidden = true;
    if (opts.icon) {
      els.modalIcon.src = opts.icon;
      els.modalIcon.hidden = false;
    } else {
      els.modalIcon.hidden = true;
    }
    els.modalTitle.textContent = title;
    els.modalBody.replaceChildren();
    cleanupModal = build(els.modalBody) || (() => {});
    els.modal.classList.remove("hidden");
    els.modal.classList.add("flex", "lv-open");
    if (opts.game) focusGame();
  };

  // The game window only becomes visible after the game is built, so focusing earlier can
  // silently fail. Drop focus from the card you clicked and put it in the game frame, retrying
  // briefly while the frame lays out.
  const focusGame = () => {
    const go = () => {
      const fr = els.modalBody.querySelector("iframe");
      if (!fr) return;
      const a = document.activeElement;
      if (a && a !== document.body && a !== fr) a.blur();
      try { fr.focus(); fr.contentWindow && fr.contentWindow.focus(); } catch (_) {}
    };
    go();
    requestAnimationFrame(go);
    [100, 300, 800].forEach((ms) => setTimeout(go, ms));
  };

  // While a game is open, Enter/Space pressed outside the game window (e.g. on the card that
  // launched it) must not re-activate that button and restart the game.
  const gameOpen = () => els.modal.classList.contains("game-mode") && !els.modal.classList.contains("hidden");
  ["keydown", "keyup"].forEach((type) =>
    document.addEventListener(
      type,
      (e) => {
        if (!gameOpen() || (e.key !== "Enter" && e.key !== " ")) return;
        if (els.modalBody.contains(e.target) || els.report.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    )
  );

  const closeModal = () => {
    if (els.modal.classList.contains("lv-closing")) return;
    const wasOpen = !els.modal.classList.contains("hidden");
    cleanupModal();
    cleanupModal = () => {};
    if (!wasOpen || reduced()) {
      hideModal();
      return;
    }
    // Let the closing animation play, then hide the window.
    els.modal.classList.add("lv-closing");
    modalCloseTimer = setTimeout(hideModal, 330);
  };

  const cardGrid = (items, onLaunch) => {
    const wrap = document.createElement("div");
    wrap.className = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";
    items.forEach((item) => {
      const article = document.createElement("article");
      article.className =
        "group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-lab-900/80 shadow-glow transition hover:border-signal/30";
      article.innerHTML = `
        <div class="thumb-placeholder relative h-36">
          <div class="absolute inset-0 opacity-40" style="background:radial-gradient(circle at 70% 30%, rgba(125, 255, 138,0.25), transparent 55%)"></div>
          ${iconSvg(item.id, 40)}
          <span class="absolute left-3 top-3 rounded border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-xs text-zinc-300">${item.tag || item.kind || "module"}</span>
          <span class="absolute bottom-3 right-3 font-mono text-xs text-zinc-400">${item.id}</span>
        </div>
        <div class="flex flex-1 flex-col p-4">
          <h3 class="text-sm font-semibold text-white">${item.title}</h3>
          <p class="mt-1 flex-1 text-xs leading-relaxed text-zinc-400">${item.blurb}</p>
          <button type="button" class="mt-4 w-full rounded-md bg-zinc-100 py-2 text-sm font-semibold text-lab-950 hover:bg-signal">Launch</button>
        </div>
      `;
      article.querySelector("button").addEventListener("click", () => onLaunch(item));
      wrap.append(article);
    });
    return wrap;
  };

  const renderHome = () => {
    renderShortcuts();
    return document.createElement("div");
  };

  const emptyState = (text) => {
    const p = document.createElement("p");
    p.className = "rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400";
    p.textContent = text;
    return p;
  };

  // Games page: a "Games" / "Cloud Games" switch, a source dropdown inside the search bar, and a
  // card grid that fills in as you scroll.
  const renderGames = () => {
    const all = window.LabGames.list;
    // "Lemniscate" holds games users request that are not in the built-in sources. It always shows in
    // the dropdown, even while empty. Give a game source: "lemniscate" later and it appears here.
    const sources = [...(window.LabGames.sources || [])];
    if (!sources.some((x) => x.id === LEMNISCATE_SRC)) sources.unshift({ id: LEMNISCATE_SRC, name: "Lemniscate" });
    const root = document.createElement("div");
    root.className = "games-page";

    const squash = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "");
    const index = all.map((g) => ({ g, hay: squash(g.title + g.id) }));
    const PER_PAGE = 48; // keep this small: school Chromebooks have little RAM
    const fmt = (n) => n.toLocaleString();
    // Starred games in the order they were starred; ids that no longer exist are skipped.
    const byAnyId = new Map(all.map((g) => [g.id, g]));
    const favList = () => favIds.map((id) => byAnyId.get(id)).filter(Boolean);

    let section = "games"; // "games" | "favorites"
    let src = ""; // selected source id, "" = all
    let matches = all;
    let page = 1;

    // ---- section tabs ----
    const tabs = document.createElement("div");
    tabs.className = "gp-tabs";
    tabs.setAttribute("role", "tablist");
    const tabBtns = {};
    const tabCounts = {
      games: () => all.length,
      favorites: () => favList().length,
    };
    [
      ["games", "Games", () => all.length],
      ["favorites", "Favorites \u2605", () => favList().length],
    ].forEach(([id, label, count]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gp-tab";
      b.setAttribute("role", "tab");
      b.innerHTML = `${label} <small>${fmt(count())}</small>`;
      b.addEventListener("click", () => {
        section = id;
        apply();
      });
      tabBtns[id] = b;
      tabs.append(b);
    });

    // ---- grid + empty states ----
    const grid = document.createElement("div");
    grid.className = "gp-grid";
    const noMatch = document.createElement("div");
    noMatch.className = "gp-empty";
    noMatch.innerHTML = "<strong>No games match your search</strong>Try a different name or source.";
    noMatch.hidden = true;
    const noGames = document.createElement("div");
    noGames.className = "gp-empty";
    noGames.innerHTML = "<strong>No games yet</strong>Run the game sync to fill the library.";
    noGames.hidden = true;
    // ---- page switcher, always at the very bottom ----
    const pager = document.createElement("nav");
    pager.className = "gp-pager";
    pager.setAttribute("aria-label", "Pages");
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "gp-pg-btn";
    prevBtn.innerHTML = "<span aria-hidden=\"true\">\u2190</span> Prev";
    const pageInfo = document.createElement("span");
    pageInfo.className = "gp-pg-info";
    pageInfo.setAttribute("aria-live", "polite");
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "gp-pg-btn";
    nextBtn.innerHTML = "Next <span aria-hidden=\"true\">\u2192</span>";
    pager.append(prevBtn, pageInfo, nextBtn);
    const noLemn = document.createElement("div");
    noLemn.className = "gp-empty";
    noLemn.innerHTML =
      "<strong>No games yet</strong>" +
      "Can\u2019t find a game you\u2019re looking for? Request any Flash or browser game and we\u2019ll add it to the library. " +
      'Submit a request on <a href="https://discord.gg/DFzqkwX6vb" target="_blank" rel="noopener noreferrer" style="color:#7dff8a;text-decoration:underline;text-underline-offset:2px">Discord</a>.';
    noLemn.hidden = true;
    const noFavs = document.createElement("div");
    noFavs.className = "gp-empty";
    noFavs.innerHTML = "<strong>No favorites yet</strong>Open a game and click the star in its top bar to add it here.";
    noFavs.hidden = true;
    root.append(tabs, noMatch, noGames, noLemn, noFavs, grid, pager);

    const card = (g) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gp-card";
      const tagged = !g.source || g.title.toLowerCase().trimEnd().endsWith(`(${g.source})`.toLowerCase());
      const label = tagged ? g.title : `${g.title} (${g.source})`;
      btn.title = label;
      const art = document.createElement("div");
      art.className = "gp-art";
      if (g.thumb) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = g.thumb;
        img.addEventListener("error", () => img.remove());
        art.append(img);
      } else {
        const letter = document.createElement("span");
        letter.className = "gp-letter";
        letter.textContent = (g.title.trim()[0] || "?").toUpperCase();
        art.append(letter);
      }
      const name = document.createElement("div");
      name.className = "gp-name";
      name.textContent = label;
      btn.append(art, name);
      btn.addEventListener("click", () =>
        openModal(g.title, (body) => window.LabGames.start(g.id, body), {
          game: true,
          icon: g.thumb,
          favId: g.id,
        })
      );
      return btn;
    };

    // Shows one page of cards. The old cards are thrown away first, so memory stays flat.
    const drawPage = () => {
      const pageCount = Math.max(1, Math.ceil(matches.length / PER_PAGE));
      page = Math.min(Math.max(page, 1), pageCount);
      const frag = document.createDocumentFragment();
      matches.slice((page - 1) * PER_PAGE, page * PER_PAGE).forEach((g) => frag.append(card(g)));
      grid.replaceChildren(frag);
      pager.hidden = matches.length <= PER_PAGE;
      pageInfo.textContent = `${page} / ${pageCount} (${fmt(matches.length)} items)`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= pageCount;
    };
    const goTo = (n) => {
      page = n;
      drawPage();
      window.scrollTo(0, 0);
    };
    prevBtn.addEventListener("click", () => goTo(page - 1));
    nextBtn.addEventListener("click", () => goTo(page + 1));

    // ---- source dropdown, placed in the search bar where the Cloud switch used to be ----
    const dd = document.createElement("div");
    dd.className = "src-dd";
    const ddBtn = document.createElement("button");
    ddBtn.type = "button";
    ddBtn.className = "src-dd-btn";
    ddBtn.setAttribute("aria-haspopup", "listbox");
    ddBtn.setAttribute("aria-expanded", "false");
    ddBtn.setAttribute("aria-label", "Filter by game source");
    ddBtn.innerHTML =
      '<span class="src-dd-label">All sources</span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const ddLabel = ddBtn.firstElementChild;
    const ddMenu = document.createElement("div");
    ddMenu.className = "src-dd-menu";
    ddMenu.setAttribute("role", "listbox");
    ddMenu.hidden = true;
    dd.append(ddBtn, ddMenu);

    const counts = new Map();
    all.forEach((g) => counts.set(g.source, (counts.get(g.source) || 0) + 1));
    const ddItems = [];
    const addItem = (value, label, count) => {
      const it = document.createElement("button");
      it.type = "button";
      it.className = "src-dd-item";
      it.setAttribute("role", "option");
      it.dataset.value = value;
      const l = document.createElement("span");
      l.textContent = label;
      const c = document.createElement("span");
      c.className = "src-dd-count";
      c.textContent = fmt(count);
      it.append(l, c);
      it.addEventListener("click", (e) => {
        e.stopPropagation();
        src = value;
        ddLabel.textContent = label;
        closeDd();
        ddBtn.focus();
        apply();
      });
      ddItems.push(it);
      ddMenu.append(it);
    };
    addItem("", "All sources", all.length);
    sources.forEach((s) => addItem(s.id, s.name, counts.get(s.id) || 0));

    function openDd() {
      ddMenu.hidden = false;
      dd.classList.add("open");
      ddBtn.setAttribute("aria-expanded", "true");
      const cur = ddItems.find((i) => i.dataset.value === src) || ddItems[0];
      cur.focus();
    }
    function closeDd() {
      ddMenu.hidden = true;
      dd.classList.remove("open");
      ddBtn.setAttribute("aria-expanded", "false");
    }
    ddBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ddMenu.hidden ? openDd() : closeDd();
    });
    ddMenu.addEventListener("click", (e) => e.stopPropagation());
    ddMenu.addEventListener("keydown", (e) => {
      const i = ddItems.indexOf(document.activeElement);
      if (e.key === "ArrowDown") ddItems[Math.min(ddItems.length - 1, i + 1)].focus();
      else if (e.key === "ArrowUp") ddItems[Math.max(0, i - 1)].focus();
      else return;
      e.preventDefault();
    });
    const onDocDown = (e) => {
      if (!dd.contains(e.target)) closeDd();
    };
    const onDocKey = (e) => {
      if (e.key === "Escape" && !ddMenu.hidden) {
        e.stopImmediatePropagation();
        closeDd();
        ddBtn.focus();
      }
    };
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onDocKey, true);
    els.count.classList.add("has-dd");
    els.count.prepend(dd);

    // ---- filter + redraw ----
    const refreshTabCounts = () => {
      Object.entries(tabBtns).forEach(([id, b]) => {
        const small = b.querySelector("small");
        if (small) small.textContent = fmt(tabCounts[id]());
      });
    };
    const apply = () => {
      const q = squash(els.search.value);
      Object.entries(tabBtns).forEach(([id, b]) => b.setAttribute("aria-selected", String(id === section)));
      dd.hidden = section !== "games";
      page = 1;
      const isGames = section === "games";
      const isFavs = section === "favorites";
      if (isGames) {
        matches = index.filter((x) => (!src || x.g.source === src) && (!q || x.hay.includes(q))).map((x) => x.g);
      } else if (isFavs) {
        matches = favList().filter((g) => !q || squash(g.title + g.id).includes(q));
      }
      const lemnEmpty = isGames && src === LEMNISCATE_SRC && !counts.get(LEMNISCATE_SRC);
      noLemn.hidden = !lemnEmpty;
      noGames.hidden = !(isGames && !all.length && !lemnEmpty);
      noFavs.hidden = !(isFavs && !favIds.length && !favList().length);
      noMatch.hidden = !(
        (isGames && !lemnEmpty && all.length && !matches.length) ||
        (isFavs && favList().length && !matches.length)
      );
      els.countText.textContent = `${fmt(matches.length)} Total`;
      refreshTabCounts();
      drawPage();
    };
    // The star in the game window changed something: keep the tab count (and the Favorites list) current.
    onFavsChanged = () => {
      refreshTabCounts();
      if (section === "favorites") {
        const keep = page;
        apply();
        page = keep;
        drawPage();
      }
    };

    let timer = 0;
    const onType = () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 120);
    };
    els.search.value = "";
    els.search.addEventListener("input", onType);
    gamesCleanup = () => {
      onFavsChanged = () => {};
      clearTimeout(timer);
      els.search.removeEventListener("input", onType);
      els.search.value = "";
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onDocKey, true);
      els.count.classList.remove("has-dd");
      dd.remove();
    };

    apply();
    return root;
  };

  // Map an app's "kind" to a function that builds its UI: (root) => cleanupFn.
  const cloudMount = {};

  const renderCloud = () => {
    const root = document.createElement("div");
    root.className = "mx-auto max-w-6xl space-y-4";
    if (window.LemniscateChat) {
      // Chat + accounts (js/chat.js). The cleanup runs when you leave the Chat tab.
      chatCleanup = window.LemniscateChat.mount(root) || (() => {});
      return root;
    }
    if (!CLOUD_APPS.length) {
      root.append(emptyState("Chat is coming soon."));
      return root;
    }
    root.append(
      cardGrid(CLOUD_APPS, (app) => {
        openModal(app.title, (body) => cloudMount[app.kind](body));
      })
    );
    return root;
  };

  const renderSettings = () => {
    const tabs = [
      ["appearance", "Appearance"],
      ["privacy", "Privacy"],
      ["proxy", "Proxy"],
      ["advanced", "Advanced"],
    ];
    const toggleRow = (key, label, desc) => `
      <div class="flex items-center justify-between gap-6 border-b border-white/5 py-4">
        <div class="min-w-0">
          <span class="text-[15px] text-zinc-200">${label}</span>
          ${desc ? `<p class="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">${desc}</p>` : ""}
        </div>
        <button type="button" role="switch" data-toggle="${key}" aria-checked="${settings[key] ? "true" : "false"}" aria-label="${label}"
          class="relative h-7 w-12 shrink-0 rounded-full transition-colors ${settings[key] ? "bg-[#7dff8a]" : "bg-zinc-700"}">
          <span class="absolute top-1 h-5 w-5 rounded-full bg-[#0a0a0f] transition-all ${settings[key] ? "left-6" : "left-1"}"></span>
        </button>
      </div>`;
    const selectRow = (key, label, desc, options) => `
      <div class="flex items-center justify-between gap-6 border-b border-white/5 py-4">
        <div class="min-w-0">
          <span class="text-[15px] text-zinc-200">${label}</span>
          ${desc ? `<p class="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">${desc}</p>` : ""}
        </div>
        <select data-select="${key}" aria-label="${label}" style="color-scheme: dark" class="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-200">
          ${options.map(([value, text]) => `<option value="${value}"${settings[key] === value ? " selected" : ""}>${text}</option>`).join("")}
        </select>
      </div>`;
    const heading = (t) =>
      `<h4 class="pt-6 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">${t}</h4>`;

    const root = document.createElement("div");
    root.style.marginBlock = "auto";
    root.className =
      "mx-auto flex h-[34rem] max-h-[75vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f] shadow-2xl";
    root.innerHTML = `
      <div class="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div>
          <p class="font-display text-lg text-white">Lemniscate</p>
          <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-500">Settings</p>
        </div>
        <button type="button" data-close aria-label="Close settings" class="rounded-md p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="flex min-h-0 flex-1">
        <aside class="w-40 shrink-0 border-r border-white/5 p-3">
          ${tabs
            .map(
              ([id, label]) =>
                `<button type="button" data-tab="${id}" class="mb-1 block w-full rounded-md px-3 py-2 text-left text-sm transition-colors">${label}</button>`
            )
            .join("")}
        </aside>
        <div id="settings-scroll" class="min-w-0 flex-1 overflow-y-auto px-8 pb-8">
          <section id="sec-appearance" class="settings-section">
            ${heading("Appearance")}
            ${toggleRow("reduceMotion", "Reduce Motion/Animations")}
            ${toggleRow("tabTitleSwap", "Title Changer")}
            ${toggleRow("bookmarks", "Bookmarks")}
          </section>
          <section id="sec-privacy" class="settings-section">
            ${heading("Privacy")}
            ${toggleRow("aboutBlankCloak", "About:Blank Cloak")}
          </section>
          <section id="sec-proxy" class="settings-section">
            ${heading("Proxy")}
            ${selectRow("transport", "Connection transport", "Epoxy is the default. Switch to libcurl if a site misbehaves. Applies on the next page load.", [["epoxy", "Epoxy"], ["libcurl", "libcurl"]])}
            ${selectRow("searchEngine", "Default search engine", "Used when you search from the home page or the address bar.", [["google", "Google"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"], ["brave", "Brave"]])}
          </section>
          <section id="sec-advanced" class="settings-section">
            ${heading("Advanced")}
            <div class="flex items-center justify-between py-4">
              <span class="text-[15px] text-zinc-200">Reset preferences</span>
              <button type="button" data-reset class="rounded-md border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-zinc-200 hover:bg-white/10">Reset</button>
            </div>
            <p class="text-xs text-zinc-500">Saved automatically. Stored in this browser only.</p>
          </section>
        </div>
      </div>
    `;

    const scroller = root.querySelector("#settings-scroll");
    const tabBtns = [...root.querySelectorAll("[data-tab]")];

    // Show one section at a time; the sidebar picks which one.
    let currentTab = null;
    const showTab = (id, animate = true) => {
      if (id === currentTab) return;
      currentTab = id;
      tabs.forEach(([tabId]) => {
        const sec = root.querySelector("#sec-" + tabId);
        if (sec) sec.hidden = tabId !== id;
      });
      tabBtns.forEach((b) => {
        const on = b.dataset.tab === id;
        b.setAttribute("aria-current", on ? "page" : "false");
        b.className =
          "mb-1 block w-full rounded-md px-3 py-2 text-left text-sm transition-colors " +
          (on ? "bg-white/[0.07] font-medium text-white" : "text-zinc-500 hover:text-zinc-200");
      });
      scroller.scrollTop = 0;
      const shown = root.querySelector("#sec-" + id);
      if (animate && shown) {
        // Restart the ease-in each time a section is picked.
        shown.classList.remove("lv-sec-in");
        void shown.offsetWidth;
        shown.classList.add("lv-sec-in");
      }
    };

    tabBtns.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab("appearance", false);

    root.querySelectorAll("[data-select]").forEach((sel) =>
      sel.addEventListener("change", () => {
        settings = { ...settings, [sel.dataset.select]: sel.value };
        saveSettings(settings);
      })
    );

    root.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const key = btn.dataset.toggle;
        settings = { ...settings, [key]: !settings[key] };
        saveSettings(settings);
        applyChrome();
        const on = settings[key];
        btn.setAttribute("aria-checked", on ? "true" : "false");
        btn.classList.toggle("bg-[#7dff8a]", on);
        btn.classList.toggle("bg-zinc-700", !on);
        const knob = btn.firstElementChild;
        knob.classList.toggle("left-6", on);
        knob.classList.toggle("left-1", !on);
      })
    );

    root.querySelector("[data-close]").addEventListener("click", () => {
      view = "home";
      render();
    });

    root.querySelector("[data-reset]").addEventListener("click", () => {
      settings = defaultSettings();
      saveSettings(settings);
      applyChrome();
      render();
    });

    return root;
  };

  const renderers = { home: renderHome, games: renderGames, cloud: renderCloud, settings: renderSettings };

  const renderNow = () => {
    applyChrome();
    syncNav();
    placeSearch();
    const home = view === "home";
    els.landing.classList.toggle("hidden", !home);
    els.workspace.classList.toggle("hidden", home);
    els.workspace.classList.toggle("flex", !home);
    // Chat is a full-screen view: hide the logo/search header and let it fill the frame.
    document.documentElement.classList.toggle("chat-mode", view === "cloud");
    // Settings is a centered panel: let the main area lay it out as a flex column.
    els.view.style.display = view === "settings" ? "flex" : "";
    els.view.style.flexDirection = view === "settings" ? "column" : "";
    // Drop the bottom-bar spacer on this view so the panel centers on the screen itself.
    els.workspace.style.paddingBottom = view === "settings" || view === "games" ? "0" : "";
    chatCleanup();
    chatCleanup = () => {};
    gamesCleanup();
    gamesCleanup = () => {};
    document.documentElement.classList.toggle("games-mode", view === "games");
    if (home) {
      renderShortcuts();
      els.view.replaceChildren();
    } else {
      els.view.replaceChildren(renderers[view]());
    }
  };

  // Switching to a different view cross-fades. Re-drawing the same view (for example
  // after "Reset preferences") swaps instantly, and so does everything when
  // Reduce Motion/Animations is on.
  let shownView = view;
  let firstRender = true;
  const render = () => {
    const animate = view !== shownView && !firstRender && !reduced();
    shownView = view;
    firstRender = false;
    if (animate && view !== "games" && typeof document.startViewTransition === "function") {
      document.startViewTransition(renderNow);
      return;
    }
    renderNow();
    if (animate) {
      // Browsers without the View Transitions API: fade the incoming view in.
      const el = view === "home" ? els.landing : els.workspace;
      el.classList.remove("lv-view-in");
      void el.offsetWidth;
      el.classList.add("lv-view-in");
      el.addEventListener("animationend", () => el.classList.remove("lv-view-in"), { once: true });
    }
  };

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view = btn.getAttribute("data-nav");
      render();
    });
  });

  ["hdr-home", "hdr-close"].forEach((id) =>
    document.getElementById(id).addEventListener("click", () => {
      view = "home";
      render();
    })
  );

  document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));
  els.modalFs.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const frame = els.modalBody.querySelector("iframe") || els.modalBody;
    const req = frame.requestFullscreen || frame.webkitRequestFullscreen || (() => {});
    const p = req.call(frame);
    if (p && p.then) p.then(focusGame, () => {});
    focusGame();
  });
  els.modalFav.addEventListener("click", () => {
    if (currentFavId === null) return;
    toggleFav(currentFavId);
    syncFavBtn();
  });
  // Clicking the Star / Fullscreen / X buttons must not steal keyboard focus from the game.
  [els.modalFav, els.modalFs, ...document.querySelectorAll("[data-close-modal]")].forEach((b) =>
    b.addEventListener("mousedown", (e) => e.preventDefault())
  );
  // "Game not working?" dialog: flag button opens it, Cancel / backdrop / Esc close it.
  const reportOpen = () => !els.report.hidden;
  const closeReport = () => {
    if (!reportOpen()) return;
    els.report.hidden = true;
    if (gameOpen()) focusGame();
  };
  els.modalReport.addEventListener("click", () => {
    els.reportGame.textContent = els.modalTitle.textContent || "this game";
    els.report.hidden = false;
    els.reportDiscord.focus();
  });
  els.report.querySelectorAll("[data-close-report]").forEach((el) => el.addEventListener("click", closeReport));
  els.reportDiscord.addEventListener("click", () => setTimeout(closeReport, 0));

  // Entering or leaving fullscreen (including Esc) drops focus; hand it back to the game.
  ["fullscreenchange", "webkitfullscreenchange"].forEach((t) =>
    document.addEventListener(t, () => {
      if (gameOpen()) focusGame();
    })
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (reportOpen()) closeReport();
    else closeModal();
  });

  // Keep --dock-h in sync with the bottom nav so full-screen chat stops exactly above it.
  const dock = document.querySelector("nav.dock");
  const syncDock = () => {
    const h = dock ? dock.offsetHeight : 64;
    const root = document.documentElement;
    root.style.setProperty("--dock-h", `${h}px`);
    // The background grid is 48px squares anchored to the window. Shift it so one grid line
    // lands exactly on the dock's top border (the dock is fixed to the bottom of the window).
    const gridY = (((root.clientHeight - h) % 48) + 48) % 48;
    root.style.setProperty("--grid-y", `${gridY}px`);
  };
  syncDock();
  if (dock && "ResizeObserver" in window) new ResizeObserver(syncDock).observe(dock);
  window.addEventListener("resize", syncDock);

  // Password reset emails link to /#reset=<token>: jump straight to the Chat tab.
  if (location.hash.startsWith("#reset=")) view = "cloud";

  applyChrome();
  render();
})();
