// about:blank cloak.
//
// Opens a new window at about:blank and puts this site inside a full-size
// iframe, so the address bar shows "about:blank" while the site runs.
//
// Controlled by the "aboutBlankCloak" setting (Settings > Privacy, saved in
// localStorage under STORAGE_KEY): the cloak opens right away when the toggle
// is switched on, and once per browser tab after that when the site loads.
(() => {
  "use strict";

  const STORAGE_KEY = "lemniscate-lab-settings";
  const SESSION_KEY = "lemniscate-cloaked";

  const readSetting = (name) => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")[name] === true;
    } catch {
      return false;
    }
  };

  // Never cloak from inside the cloak's own iframe.
  const inFrame = window.top !== window;

  // The about:blank window this page opened (only set in the original tab).
  let cloakWin = null;

  // Returns true if the window opened, false if the browser blocked it.
  function openCloak() {
    const win = window.open("about:blank");
    if (!win) return false;
    cloakWin = win;

    const doc = win.document;
    doc.title = document.title;

    doc.documentElement.style.height = "100%";
    doc.body.style.cssText = "margin:0;height:100%;overflow:hidden;background:#050607;";

    const frame = doc.createElement("iframe");
    frame.src = location.origin === "null" ? location.href : location.origin + location.pathname;
    frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;";
    frame.setAttribute("allow", "fullscreen; autoplay; gamepad");
    doc.body.appendChild(frame);
    return true;
  }

  // ---- auto cloak (aboutBlankCloak) ----
  const alreadyCloaked = () => {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
  };
  const markCloaked = () => {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
  };
  const clearCloaked = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  };

  let armed = false;
  // Browsers block pop-ups that aren't triggered by a click or key press, so if
  // the automatic attempt on page load is blocked, retry on the first interaction.
  function armForInteraction() {
    if (armed) return;
    armed = true;
    const go = () => {
      armed = false;
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
      autoCloak();
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }

  function autoCloak() {
    if (inFrame || !readSetting("aboutBlankCloak") || alreadyCloaked()) return;
    if (openCloak()) markCloaked();
    else armForInteraction();
  }

  // Turning the cloak off puts things back to normal:
  //  - inside the cloaked window: that window loads the real site directly,
  //    so the address bar shows the site instead of about:blank.
  //  - in the original tab: the cloak window it opened is closed.
  function uncloak() {
    clearCloaked();
    if (inFrame) {
      try {
        window.top.location.href = location.href;
      } catch {}
      return;
    }
    if (cloakWin && !cloakWin.closed) cloakWin.close();
    cloakWin = null;
  }

  // Switching the toggle on is a click, so the browser allows the pop-up right away.
  let wasOn = readSetting("aboutBlankCloak");
  window.addEventListener("lemniscate:settings", () => {
    const now = readSetting("aboutBlankCloak");
    if (now && !wasOn) {
      clearCloaked();
      autoCloak();
    } else if (!now && wasOn) {
      uncloak();
    }
    wasOn = now;
  });

  // If it's turned off from another tab (for example the original one) while
  // this page is sitting inside a cloak window, show the site normally here too.
  // Only the cloaked page reacts, so switching it off inside the cloak never
  // makes the original tab close the window that is going back to normal.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const now = readSetting("aboutBlankCloak");
    if (!now && wasOn && inFrame) uncloak();
    wasOn = now;
  });

  autoCloak();
})();
