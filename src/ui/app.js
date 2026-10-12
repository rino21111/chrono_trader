// Top-level UI orchestrator (design doc section 13 App.tsx).
//
// Subscribes to the store and swaps between three "screens" — menu, game,
// debrief — based on status. Within a screen, every state change is forwarded to
// the mounted panels' update() methods, which do targeted DOM updates. This
// keeps the per-frame market tick cheap and preserves input focus/selection.

import { el, clear } from "./dom.js";
import { mountMenu } from "./components/menu.js";
import { mountGameHeader } from "./components/gameHeader.js";
import { mountVisionFeed } from "./components/visionFeed.js";
import { mountMarketTable } from "./components/marketTable.js";
import { mountTradePanel } from "./components/tradePanel.js";
import { mountPortfolioPanel } from "./components/portfolioPanel.js";
import { mountBreakingNews } from "./components/breakingNews.js";
import { mountDebrief } from "./components/debrief.js";

function screenCategory(status) {
  if (status === "playing" || status === "paused") return "game";
  if (status === "finished") return "finished";
  return "menu";
}

export function mountApp(root, store) {
  let category = null;
  let current = null; // { node, update }

  function build(cat) {
    clear(root);
    if (cat === "menu") {
      current = mountMenu(store);
    } else if (cat === "game") {
      current = mountGameScreen(store);
    } else {
      current = mountDebrief(store);
    }
    root.appendChild(current.node);
  }

  store.subscribe((state) => {
    const cat = screenCategory(state.status);
    if (cat !== category) {
      category = cat;
      build(cat);
    }
    if (current) current.update(state);
  });

  // Initial paint.
  category = screenCategory(store.state.status);
  build(category);
  current.update(store.state);
}

function mountGameScreen(store) {
  const header = mountGameHeader(store);
  const feed = mountVisionFeed(store);
  const news = mountBreakingNews(store);
  const market = mountMarketTable(store);
  const trade = mountTradePanel(store);
  const portfolio = mountPortfolioPanel(store);

  // THE VEIL: what pausing means. A paused board that stays readable is a board
  // you can study at leisure, and reading under no time pressure is the one
  // thing the week is built to deny — so pause hides it: the grid blurs
  // underneath and this cover takes the screen until resume. The header stays
  // sharp; the clock's position isn't a secret and the Pause/Resume key must
  // stay reachable.
  const veil = el("div", { class: "pause-veil", role: "status", hidden: "" }, [
    el("div", { class: "veil-title" }, "Paused"),
    el("p", { class: "veil-sub" }, "The board stays dark until you resume."),
    el("button", { class: "btn veil-resume", onClick: () => store.resume() }, "Resume"),
  ]);

  const node = el("div", { class: "game-screen" }, [
    // One static field behind the WHOLE screen — every panel sits on it and it
    // shows through all the gaps, the grid padding, the open vision column and the
    // buffer margins (including around the portfolio bar), so the signal field the
    // premonitions surface from is continuous everywhere. aria-hidden, purely
    // decorative. See `.board-static` in app.css.
    el("div", { class: "board-static", "aria-hidden": "true" }),
    header.node,
    // Two rows in one grid so the bottom bar aligns to the columns above it:
    //   row 1: visions to read | the whole market to scan | the selected name
    //   row 2: the BREAKING NEWS ticker (under the visions) | the portfolio dock
    //          (under market + trade, so the account readout lines up with the
    //          two framed columns rather than spanning the whole width).
    // The ticker is where realized events surface; the feed above keeps only the
    // premonitions. See `.game-grid` in app.css for the placement.
    el("div", { class: "game-grid" }, [
      feed.node,
      market.node,
      trade.node,
      news.node,
      portfolio.node,
    ]),
    veil,
  ]);

  const parts = [header, feed, news, market, trade, portfolio];
  function update(state) {
    for (const p of parts) p.update(state);
    const veiled = state.status === "paused";
    node.classList.toggle("is-veiled", veiled);
    if (veiled === veil.hidden) veil.hidden = !veiled;
  }

  return { node, update };
}
