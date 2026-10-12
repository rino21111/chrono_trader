// Trading rules shared by the domain and surfaced to the UI (via the portfolio
// snapshot). Kept in one place so the rules can be tuned per build or, later,
// per scenario without hunting through the engines.

// Buying power = equity × MAX_LEVERAGE. At 1 this is cash-only: you can deploy
// what you actually have and no more.
//
// Margin was tried and removed — it added a risk dial without adding a decision.
// The interesting call in this game is *which* vision to back and *when*, not how
// much rope to give yourself, and 3× mostly turned a good read into a blowout and
// a bad one into a wipeout. The cap mechanism stays (it's what enforces cash-only
// and what stops a short from exceeding the account) — it just ships at 1.
export const MAX_LEVERAGE = 1;

// Whether sells may open/extend a short position (negative shares). Shorts are
// still fully collateralised: a short consumes buying power 1:1, same as a long.
export const ALLOW_SHORT = true;
