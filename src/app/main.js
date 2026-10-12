// Bootstrap. Wires the store to the DOM. (Design doc build order: this is the
// last piece — everything below it is pure/independent of the UI.)

import { store } from "../state/gameStore.js";
import { mountApp } from "../ui/app.js";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  mountApp(root, store);
});

// Handy for debugging in the console; not used by the game.
window.__chrono = { store };
