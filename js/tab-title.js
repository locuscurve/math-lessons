// Tab title swapper.
// When the page is hidden (tab switch, minimize) or the window loses focus,
// the tab title changes to "New Tab"; it goes back when you return.
// The favicon is never set, so the browser shows its default icon.
// Can be turned on/off in Settings (saved as "tabTitleSwap").
(() => {
  "use strict";

  const AWAY_TITLE = "New Tab";
  const STORAGE_KEY = "lemniscate-lab-settings";
  // Inside the about:blank iframe, change the title of the outer window
  // (same origin, so it is reachable); otherwise use this page.
  const topDoc = (() => {
    try { return window.top.document; } catch { return document; }
  })();
  const originalTitle = topDoc.title;

  // Read the setting each time so toggling it in Settings applies instantly.
  // Defaults to disabled if nothing is saved yet.
  const isEnabled = () => {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return s.tabTitleSwap === true;
    } catch {
      return false;
    }
  };

  // Make sure no custom favicon is present so the default icon shows.
  document.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove());

  function goAway() {
    if (isEnabled()) topDoc.title = AWAY_TITLE;
  }

  function comeBack() {
    topDoc.title = originalTitle;
  }

  document.addEventListener("visibilitychange", () => {
    document.hidden ? goAway() : comeBack();
  });

  // Also react when you click into another window without hiding the tab.
  window.addEventListener("blur", goAway);
  window.addEventListener("focus", comeBack);
})();
