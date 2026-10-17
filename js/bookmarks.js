// Bookmarks (quick apps) for the Lemniscate home page.
//
// - Tiles sit under the search bar, six per row (three on phones).
// - Clicking a tile opens that site through the proxy (see openBookmark).
// - "Edit" shows a pencil and an x on every tile plus a "+ Add" tile;
//   the pencil opens the Name / URL form. Up to 18 bookmarks.
// - Changes are saved in localStorage ("lemniscate.bookmarks.v1").
// - Settings > Appearance > Bookmarks hides the whole section. Hiding never
//   touches the saved list, so turning it back on shows the bookmarks exactly
//   as they were.
// - Settings > Reset preferences fires "lemniscate:reset-bookmarks", which puts
//   the default bookmarks back (even if every bookmark had been deleted).
//
// Depends on: <div id="bookmarks"></div> in index.html and css/bookmarks.css.
(() => {
  "use strict";

  const root = document.getElementById("bookmarks");
  if (!root) return;

  const STORAGE_KEY = "lemniscate.bookmarks.v1";
  const SETTINGS_KEY = "lemniscate-lab-settings";

  const ROBLOX_URL = "https://nowgg.fun/apps/a/19900/b.html";
  const MAX_BOOKMARKS = 18;
  const FAVICON_API = "/api/favicon?domain=";
  const ICON_DIR = "images/icons/";
  const SNAPCHAT_URL = "https://www.snapchat.com/?original_referrer=none";

  const CHATGPT_URL = "https://toolbaz.com/writer/chat-gpt-alternative#google_vignette";

  const DEFAULTS = [
    { name: "YouTube", url: "https://www.youtube.com/", icon: ICON_DIR + "youtube.png" },
    { name: "TikTok", url: "https://www.tiktok.com/", icon: ICON_DIR + "tiktok.png" },
    { name: "GeForce", url: "https://play.geforcenow.com/", icon: ICON_DIR + "geforce.png" },
    { name: "Roblox", url: ROBLOX_URL, icon: ICON_DIR + "roblox.png" },
    { name: "FMHY", url: "https://fmhy.net/video", icon: ICON_DIR + "fmhy.png" },
    { name: "Movy", url: "https://www.movy.sx/", icon: ICON_DIR + "movy.png" },
    { name: "Twitch", url: "https://www.twitch.tv/", icon: ICON_DIR + "twitch.png" },
    { name: "Snapchat", url: SNAPCHAT_URL, icon: ICON_DIR + "snapchat.png" },
    { name: "Instagram", url: "https://www.instagram.com/", icon: ICON_DIR + "instagram.png" },
    { name: "Discord", url: "https://discord.com/app", icon: ICON_DIR + "discord.png" },
    { name: "Legacy", url: "https://sites.google.com/view/lemniscate-legacy", icon: ICON_DIR + "legacy.png" },
    { name: "ChatGPT", url: CHATGPT_URL, icon: ICON_DIR + "chatgpt.png" },
  ];

  const DEFAULT_ICONS = new Map(
    DEFAULTS.filter((d) => d.icon).map((d) => [d.url, d.icon])
  );

  // Earlier default links keep their icons too (Snapchat and ChatGPT links changed).
  DEFAULT_ICONS.set("https://www.snapchat.com/web", ICON_DIR + "snapchat.png");
  DEFAULT_ICONS.set("https://duck.ai/chat", ICON_DIR + "chatgpt.png");
  DEFAULT_ICONS.set("https://duck.ai/", ICON_DIR + "chatgpt.png");

  const ownIcon = (v) =>
    typeof v === "string" &&
    /^images\/icons\/[a-z0-9_-]+\.png$/.test(v)
      ? v
      : "";

  // Turns a Scramjet address back into the real URL. Normal URLs are returned
  // unchanged (they must never be percent-decoded, or "?q=a%26b" would turn
  // into "?q=a&b").
  function unwrapProxyUrl(value) {
    if (typeof value !== "string" || !value.trim()) return value;

    let candidate = value.trim();
    const marker = "/scramjet/";

    for (let pass = 0; pass < 4; pass += 1) {
      let parsed;

      try {
        parsed = new URL(candidate, location.origin);
      } catch (_) {
        break;
      }

      if (parsed.origin !== location.origin || !parsed.pathname.startsWith(marker)) break;

      let target = parsed.pathname.slice(marker.length) + parsed.search + parsed.hash;

      for (let i = 0; i < 3 && !/^https?:\/\//i.test(target); i += 1) {
        try {
          target = decodeURIComponent(target);
        } catch (_) {
          break;
        }
      }

      candidate = target;
    }

    return candidate;
  }

  const uid = () => Math.random().toString(36).slice(2, 10);

  const withIds = (list) =>
    list.map((b) => ({
      id: uid(),
      name: b.name,
      url: b.url,
      icon: b.icon || "",
    }));

  const OLD_DEFAULT_LISTS = [
    [
      "https://www.youtube.com/",
      "https://www.tiktok.com/",
      "https://play.geforcenow.com/",
      "https://www.roblox.com/",
      "https://geometrydash.io/",
      "https://kick.com/",
      "https://www.twitch.tv/",
      "https://www.snapchat.com/web",
      "https://www.instagram.com/",
      "https://discord.com/app",
    ],

    [
      ROBLOX_URL,
      "https://fmhy.net/video",
      "https://www.movy.sx/",
      "https://sites.google.com/view/lemniscate-legacy",
    ],

    [
      ROBLOX_URL,
      "https://fmhy.net/video",
      "https://www.movy.sx/",
      "https://sites.google.com/view/lemniscate-legacy",
      "https://duck.ai/",
    ],

    [
      "https://www.youtube.com/",
      "https://www.tiktok.com/",
      "https://play.geforcenow.com/",
      ROBLOX_URL,
      "https://fmhy.net/video",
      "https://www.movy.sx/",
      "https://www.twitch.tv/",
      "https://www.snapchat.com/web",
      "https://www.instagram.com/",
      "https://discord.com/app",
      "https://sites.google.com/view/lemniscate-legacy",
      "https://duck.ai/",
    ],

    // Previous default set (ChatGPT pointed at duck.ai).
    [
      "https://www.youtube.com/",
      "https://www.tiktok.com/",
      "https://play.geforcenow.com/",
      ROBLOX_URL,
      "https://fmhy.net/video",
      "https://www.movy.sx/",
      "https://www.twitch.tv/",
      SNAPCHAT_URL,
      "https://www.instagram.com/",
      "https://discord.com/app",
      "https://sites.google.com/view/lemniscate-legacy",
      "https://duck.ai/",
    ],
  ].map((list) => list.join("|"));

  function migrate(b) {
    b = { ...b, url: unwrapProxyUrl(b.url) };

    if (b.url === "https://www.roblox.com/") {
      b = { ...b, url: ROBLOX_URL };
    }

    const own = DEFAULT_ICONS.get(b.url);

    return own && !b.icon
      ? { ...b, icon: own }
      : b;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          const valid = parsed.filter(
            (b) =>
              b &&
              typeof b.name === "string" &&
              typeof b.url === "string"
          );

          if (
            OLD_DEFAULT_LISTS.includes(
              valid.map((b) => b.url).join("|")
            )
          ) {
            return withIds(DEFAULTS);
          }

          return valid
            .map((b) => ({
              id: b.id || uid(),
              name: b.name,
              url: b.url,
              icon: ownIcon(b.icon),
            }))
            .map(migrate);
        }
      }
    } catch (_) {}

    return withIds(DEFAULTS);
  }

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(items)
      );
    } catch (_) {}
  }

  let items = load();
  let editing = false;
  let formTarget = null;

  function normalizeUrl(value) {
    let v = value.trim();

    if (!v) return null;

    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      v = "https://" + v;
    }

    try {
      const u = new URL(v);

      if (
        u.protocol !== "http:" &&
        u.protocol !== "https:"
      ) {
        return null;
      }

      return u.toString();
    } catch (_) {
      return null;
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return "";
    }
  }

  function iconSources(b) {
    if (b.icon) return [b.icon];

    const host = hostOf(b.url);
    if (!host) return [];

    const h = encodeURIComponent(host);

    return [
      FAVICON_API + h,
      "https://www.google.com/s2/favicons?sz=128&domain=" + h,
      "https://icons.duckduckgo.com/ip3/" + h + ".ico",
    ];
  }

  function openBookmark(url) {
    const destination = unwrapProxyUrl(url);
    const input = document.getElementById("search");
    const proxyReady =
      typeof $scramjetLoadController === "function" ||
      typeof window.__loadProxy === "function";

    if (proxyReady && input) {
      input.value = destination;

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
    } else {
      console.warn(
        "[bookmarks] Proxy not loaded on this page; opening in a new tab instead."
      );

      window.open(
        url,
        "_blank",
        "noopener"
      );
    }
  }

  const SVG_NS =
    "http://www.w3.org/2000/svg";

  function svgIcon(pathD) {
    const svg =
      document.createElementNS(
        SVG_NS,
        "svg"
      );

    svg.setAttribute(
      "viewBox",
      "0 0 24 24"
    );

    svg.setAttribute(
      "fill",
      "none"
    );

    svg.setAttribute(
      "stroke",
      "currentColor"
    );

    svg.setAttribute(
      "stroke-width",
      "2"
    );

    svg.setAttribute(
      "stroke-linecap",
      "round"
    );

    svg.setAttribute(
      "stroke-linejoin",
      "round"
    );

    svg.setAttribute(
      "aria-hidden",
      "true"
    );

    const p =
      document.createElementNS(
        SVG_NS,
        "path"
      );

    p.setAttribute("d", pathD);
    svg.append(p);

    return svg;
  }

  const PENCIL =
    "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z";

  const CROSS =
    "M6 6l12 12M18 6L6 18";

  function el(
    tag,
    props = {},
    ...children
  ) {
    const node =
      document.createElement(tag);

    Object.entries(props).forEach(
      ([k, v]) => {
        if (k === "class") {
          node.className = v;
        } else if (k === "text") {
          node.textContent = v;
        } else {
          node.setAttribute(k, v);
        }
      }
    );

    node.append(...children);

    return node;
  }

  const toggle = el(
    "button",
    {
      type: "button",
      class: "bm-toggle",
      text: "Edit",
    }
  );

  const count = el(
    "span",
    { class: "bm-count" }
  );

  const bar = el(
    "div",
    { class: "bm-bar" },
    count,
    toggle
  );

  const grid = el(
    "div",
    {
      class: "bm-grid",
      role: "list",
    }
  );

  const nameInput = el(
    "input",
    {
      id: "bm-name",
      type: "text",
      maxlength: "40",
      autocomplete: "off",
      placeholder: "YouTube",
    }
  );

  const urlInput = el(
    "input",
    {
      id: "bm-url",
      type: "text",
      autocomplete: "off",
      placeholder:
        "https://www.youtube.com",
    }
  );

  const errorLine = el(
    "div",
    {
      class: "bm-error",
      role: "alert",
    }
  );

  const resetBtn = el(
    "button",
    {
      type: "button",
      class: "bm-btn bm-reset",
      text: "Reset to defaults",
    }
  );

  const cancelBtn = el(
    "button",
    {
      type: "button",
      class: "bm-btn ghost",
      text: "Cancel",
    }
  );

  const saveBtn = el(
    "button",
    {
      type: "submit",
      class: "bm-btn primary",
      text: "Save",
    }
  );

  const form = el(
    "form",
    {
      class: "bm-form",
      hidden: "",
      novalidate: "",
    },
    el(
      "div",
      { class: "bm-field" },
      el(
        "label",
        {
          for: "bm-name",
          text: "Name",
        }
      ),
      nameInput
    ),
    el(
      "div",
      { class: "bm-field" },
      el(
        "label",
        {
          for: "bm-url",
          text: "URL",
        }
      ),
      urlInput
    ),
    errorLine,
    el(
      "div",
      { class: "bm-actions" },
      resetBtn,
      cancelBtn,
      saveBtn
    )
  );

  root.classList.add("bm");
  root.append(
    bar,
    grid,
    form
  );

  function tile(b) {
    const t = el(
      "div",
      {
        class: "bm-tile",
        role: "listitem",
        tabindex: "0",
        "aria-label": b.name,
      }
    );

    const sources =
      iconSources(b);

    let visual;

    if (sources.length) {
      let i = 0;

      visual = el(
        "img",
        {
          class: "bm-icon",
          alt: "",
          loading: "lazy",
          referrerpolicy:
            "no-referrer",
        }
      );

      visual.addEventListener(
        "error",
        () => {
          i += 1;

          if (i < sources.length) {
            visual.crossOrigin =
              "anonymous";

            visual.src =
              sources[i];
          } else {
            visual.replaceWith(
              glyph(b.name)
            );
          }
        }
      );

      visual.src = sources[0];
    } else {
      visual = glyph(b.name);
    }

    const tools = el(
      "div",
      { class: "bm-tools" }
    );

    const edit = el(
      "button",
      {
        type: "button",
        class: "bm-tool",
        "data-act": "edit",
        "aria-label":
          "Edit " + b.name,
      }
    );

    edit.append(
      svgIcon(PENCIL)
    );

    const remove = el(
      "button",
      {
        type: "button",
        class: "bm-tool",
        "data-act": "remove",
        "aria-label":
          "Remove " + b.name,
      }
    );

    remove.append(
      svgIcon(CROSS)
    );

    tools.append(
      edit,
      remove
    );

    t.append(
      visual,
      el(
        "span",
        {
          class: "bm-name",
          text: b.name,
        }
      ),
      tools
    );

    const activate = () => {
      if (editing) {
        openForm(b.id);
      } else {
        openBookmark(b.url);
      }
    };

    t.addEventListener(
      "click",
      (e) => {
        const btn =
          e.target.closest(
            ".bm-tool"
          );

        if (btn) {
          e.stopPropagation();

          if (
            btn.dataset.act ===
            "edit"
          ) {
            openForm(b.id);
          } else {
            removeItem(b.id);
          }

          return;
        }

        activate();
      }
    );

    t.addEventListener(
      "keydown",
      (e) => {
        if (e.target !== t) return;

        if (
          e.key === "Enter" ||
          e.key === " "
        ) {
          e.preventDefault();
          activate();
        }
      }
    );

    return t;
  }

  function glyph(name) {
    const letter =
      (
        name.replace(
          /[^A-Za-z0-9]/g,
          ""
        )[0] || "•"
      ).toUpperCase();

    return el(
      "span",
      {
        class: "bm-glyph",
        text: letter,
      }
    );
  }

  function render() {
    root.dataset.editing =
      String(editing);

    toggle.textContent =
      editing ? "Done" : "Edit";

    grid.replaceChildren();

    if (
      !items.length &&
      !editing
    ) {
      grid.append(
        el(
          "div",
          {
            class: "bm-empty",
            text:
              "No bookmarks yet. Press Edit, then Add, to create one.",
          }
        )
      );
    }

    items.forEach((b) =>
      grid.append(tile(b))
    );

    if (
      items.length <
      MAX_BOOKMARKS
    ) {
      const add = el(
        "button",
        {
          type: "button",
          class: "bm-add",
          text: "+ Add",
        }
      );

      add.addEventListener(
        "click",
        () => openForm("new")
      );

      grid.append(add);
    }

    count.textContent =
      items.length +
      " / " +
      MAX_BOOKMARKS;
  }

  function openForm(id) {
    if (
      id === "new" &&
      items.length >=
        MAX_BOOKMARKS
    ) {
      return;
    }

    formTarget = id;

    const b = items.find(
      (x) => x.id === id
    );

    nameInput.value =
      b ? b.name : "";

    urlInput.value =
      b ? b.url : "";

    errorLine.textContent =
      "";

    form.hidden = false;

    form.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });

    nameInput.focus();
  }

  function closeForm() {
    formTarget = null;
    form.hidden = true;
    errorLine.textContent =
      "";
  }

  form.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();

      const url =
        normalizeUrl(
          urlInput.value
        );

      if (!url) {
        errorLine.textContent =
          "Enter a valid web address, like https://example.com.";

        urlInput.focus();
        return;
      }

      const name =
        nameInput.value.trim() ||
        hostOf(url).replace(
          /^www\./,
          ""
        );

      if (
        formTarget ===
        "new"
      ) {
        if (
          items.length >=
          MAX_BOOKMARKS
        ) {
          errorLine.textContent =
            "You can have up to " +
            MAX_BOOKMARKS +
            " bookmarks.";

          return;
        }

        items.push({
          id: uid(),
          name,
          url,
          icon: "",
        });
      } else {
        const b = items.find(
          (x) =>
            x.id === formTarget
        );

        if (b) {
          Object.assign(
            b,
            {
              name,
              url,
              icon:
                url === b.url
                  ? b.icon
                  : "",
            }
          );
        }
      }

      save();
      closeForm();
      render();
    }
  );

  cancelBtn.addEventListener(
    "click",
    closeForm
  );

  form.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key ===
        "Escape"
      ) {
        closeForm();
      }
    }
  );

  resetBtn.addEventListener(
    "click",
    () => {
      if (
        !confirm(
          "Replace all bookmarks with the defaults?"
        )
      ) {
        return;
      }

      items =
        withIds(DEFAULTS);

      save();
      closeForm();
      render();
    }
  );

  function removeItem(id) {
    items = items.filter(
      (b) => b.id !== id
    );

    if (
      formTarget === id
    ) {
      closeForm();
    }

    save();
    render();
  }

  window.addEventListener(
    "lemniscate:add-bookmark",
    (event) => {
      const rawUrl =
        event.detail?.url;

      const url =
        normalizeUrl(
          typeof rawUrl ===
            "string"
            ? rawUrl
            : ""
        );

      if (!url) {
        window.dispatchEvent(
          new CustomEvent(
            "lemniscate:bookmark-result",
            {
              detail: {
                ok: false,
                message:
                  "That page does not have a valid web address.",
              },
            }
          )
        );

        return;
      }

      const existing =
        items.find(
          (b) => b.url === url
        );

      if (existing) {
        window.dispatchEvent(
          new CustomEvent(
            "lemniscate:bookmark-result",
            {
              detail: {
                ok: true,
                message:
                  `${existing.name} is already bookmarked.`,
              },
            }
          )
        );

        return;
      }

      if (
        items.length >=
        MAX_BOOKMARKS
      ) {
        window.dispatchEvent(
          new CustomEvent(
            "lemniscate:bookmark-result",
            {
              detail: {
                ok: false,
                message:
                  `You can have up to ${MAX_BOOKMARKS} bookmarks.`,
              },
            }
          )
        );

        return;
      }

      const host =
        hostOf(url).replace(
          /^www\./,
          ""
        );

      const name =
        host || "Bookmark";

      items.push({
        id: uid(),
        name,
        url,
        icon: "",
      });

      save();
      render();

      window.dispatchEvent(
        new CustomEvent(
          "lemniscate:bookmark-result",
          {
            detail: {
              ok: true,
              message:
                `${name} added to bookmarks.`,
            },
          }
        )
      );
    }
  );

  toggle.addEventListener(
    "click",
    () => {
      editing = !editing;

      if (!editing) {
        closeForm();
      }

      render();
    }
  );

  function bookmarksEnabled() {
    try {
      return (
        JSON.parse(
          localStorage.getItem(
            SETTINGS_KEY
          ) || "{}"
        ).bookmarks !== false
      );
    } catch (_) {
      return true;
    }
  }

  function applyEnabled() {
    const on =
      bookmarksEnabled();

    root.hidden = !on;

    if (
      !on &&
      (editing ||
        formTarget !== null)
    ) {
      editing = false;
      closeForm();
      render();
    }
  }

  window.addEventListener(
    "lemniscate:settings",
    applyEnabled
  );

  window.addEventListener(
    "lemniscate:reset-bookmarks",
    () => {
      items =
        withIds(DEFAULTS);

      editing = false;

      save();
      closeForm();
      render();
    }
  );

  // Public API used by the proxy viewer's star button (js/proxy.js):
  //   LemniscateBookmarks.has(url)            -> true / false
  //   LemniscateBookmarks.add({ name, url })  -> { ok, message? }
  //   LemniscateBookmarks.remove(url)
  // Same storage, limit and tiles as the Add form above.
  const urlKey = (u) =>
    normalizeUrl(unwrapProxyUrl(typeof u === "string" ? u : "")) || "";

  window.LemniscateBookmarks = {
    has(url) {
      const key = urlKey(url);
      return !!key && items.some((b) => urlKey(b.url) === key);
    },

    add({ name, url } = {}) {
      const clean = urlKey(url);

      if (!clean) {
        return { ok: false, message: "That page does not have a valid web address." };
      }

      if (items.some((b) => urlKey(b.url) === clean)) {
        return { ok: true };
      }

      if (items.length >= MAX_BOOKMARKS) {
        return { ok: false, message: `You can have up to ${MAX_BOOKMARKS} bookmarks.` };
      }

      const label =
        (typeof name === "string" ? name.trim() : "") ||
        hostOf(clean).replace(/^www\./, "") ||
        "Bookmark";

      items.push({ id: uid(), name: label.slice(0, 40), url: clean, icon: "" });

      save();
      render();

      return { ok: true };
    },

    remove(url) {
      const key = urlKey(url);
      if (!key) return;

      const gone = items.filter((b) => urlKey(b.url) === key).map((b) => b.id);
      items = items.filter((b) => urlKey(b.url) !== key);

      if (formTarget !== null && gone.includes(formTarget)) {
        closeForm();
      }

      save();
      render();
    },
  };

  applyEnabled();
  render();
})();
