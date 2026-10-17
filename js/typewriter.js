// Typewriter loop for the landing-page subtext (Orbitron, all caps).
// Types "LEMNISCATE", holds 15s, backspaces, types "INFINITE ENTERTAINMENT",
// holds 30s, backspaces, and repeats forever.
// When "Reduce Motion/Animations" is on in Settings, it stays static on
// "LEMNISCATE" with no caret and no effects (applies live when toggled).
(() => {
  "use strict";

  const textEl = document.getElementById("typewriter-text");
  const caretEl = document.getElementById("typewriter-caret");
  if (!textEl || !caretEl) return;

  const STORAGE_KEY = "lemniscate-lab-settings";
  const SEQUENCE = [
    { text: "LEMNISCATE", hold: 15000 },
    { text: "INFINITE ENTERTAINMENT", hold: 30000 },
  ];
  const TYPE_MS = 90;      // delay per typed character
  const ERASE_MS = 50;     // delay per backspace
  const PAUSE_MS = 400;    // beat between erasing and typing

  const reduced = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}").reduceMotion === true;
    } catch {
      return false;
    }
  };

  // Each run gets a token; changing it cancels any in-flight loop.
  let token = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms) => ms + Math.random() * ms * 0.5 - ms * 0.15;

  async function typeText(text, my) {
    caretEl.classList.add("typing");
    for (let i = 1; i <= text.length; i++) {
      if (my !== token) return false;
      textEl.textContent = text.slice(0, i);
      await sleep(jitter(TYPE_MS));
    }
    caretEl.classList.remove("typing");
    return my === token;
  }

  async function eraseText(my) {
    caretEl.classList.add("typing");
    for (let i = textEl.textContent.length - 1; i >= 0; i--) {
      if (my !== token) return false;
      textEl.textContent = textEl.textContent.slice(0, i);
      await sleep(ERASE_MS);
    }
    caretEl.classList.remove("typing");
    return my === token;
  }

  async function run() {
    const my = ++token;

    if (reduced()) {
      caretEl.style.display = "none";
      textEl.textContent = SEQUENCE[0].text;
      return;
    }

    caretEl.style.display = "";
    textEl.textContent = "";
    await sleep(400);
    while (my === token) {
      for (const step of SEQUENCE) {
        if (!(await typeText(step.text, my))) return;
        await sleep(step.hold);          // caret keeps blinking while idle
        if (my !== token) return;
        if (!(await eraseText(my))) return;
        await sleep(PAUSE_MS);
        if (my !== token) return;
      }
    }
  }

  // React live when the setting is toggled.
  let lastReduced = reduced();
  window.addEventListener("lemniscate:settings", () => {
    const now = reduced();
    if (now !== lastReduced) {
      lastReduced = now;
      run();
    }
  });

  run();
})();
