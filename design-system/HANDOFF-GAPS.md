# Migration report — Command Console v1.0 → production

Full six-step migration from HANDOFF.md is live on supremacy.live, www.supremacy.live and
editor.supremacy.live as of this pass (six commits on `main`, one per step). This file is the
"anything that had to be invented comes back here" side of the pipeline — per the Revision
Procedure, these are requests back to the design project, not decisions to silently re-litigate
in the repo next time.

## Token gaps (had to use a raw value or a nearby substitute)

1. **~~No `--sl-signal-edge` token.~~ Resolved in tokens v1.1.** The token existed already —
   `--sl-seam-signal` — it was just still gold from the pre-achromatic palette while Foundations
   drew this edge as white. v1.1 fixes the value (now `rgba(255,255,255,0.55)`, matching the raw
   literal production had been reaching for) rather than adding a new token. Every raw-literal call
   site this gap originally flagged (Sign out / Cancel / Menu hover borders, the profile chip
   border, `editor.html`'s `.btn:hover`) now reads `var(--sl-seam-signal)` instead.

2. **No translucent-ink token — the token gap itself is closed, consumer migration isn't.**
   tokens v1.1 adds `--sl-veil-000/100/200` (literal rgba, not `color-mix()`, specifically so the
   canvas renderer can resolve them via `getComputedStyle` on a custom property). Nothing consuming
   this shape today has actually been switched over yet, though: `board-render.js`'s hand-rolled
   `parseInt(hex) → rgba()` cache and `game.html`'s `color-mix()` hint-bar plate are both still
   doing their own thing. Left alone deliberately — that's a canvas/HUD refactor, not something a
   docs/token pass should do as a drive-by. Whoever picks this up next: swap both to the new veil
   steps and this gap closes for real.

3. **~~Reinforce action has no assigned status colour.~~ Resolved in tokens v1.1.** Added
   `--sl-action-free` (aliased to `--sl-info`, since it's still a system offer rather than a new
   hue) and `--sl-action-free-wash`. `game.html`'s Reinforce button now reads these instead of
   `--sl-info`/`--sl-info-wash` directly — same rendered colour, but now it means what it says.

## Judgment calls (reference didn't cover the exact case)

4. **Radius on small circular indicators.** `UI-RULES.md` says "the only non-zero radius in the
   system is the loading spinner," but Foundations' own radio-button example draws a filled circular dot.
   Production keeps `border-radius: 50%` on small (≤11px) decorative dots — the mode-picker bullet,
   the editor's province-list dot — since flattening a "dot" into a square reads as broken, not
   as a design choice, and the reference contradicts the literal `UI-RULES.md` line anyway. Everything
   bigger (avatar/coin icon badges, previously circular) is now square, matching the Components
   sheet's square "VK" avatar tag. Worth resolving the `UI-RULES.md` wording one way or the other.

5. **Seam alpha continuum collapsed to two steps.** The legacy client used a dozen-plus distinct
   alpha values for what the system now treats as one of two hairline weights
   (`--sl-seam` 0.09 / `--sl-seam-strong` 0.18). Production picked "< 0.13 → seam, ≥ 0.13 → seam-strong"
   as the cutoff and applied it uniformly — reasonable, but it's a judgment call, not something the
   migration table specified beyond its two named examples (0.08 and 0.14).

6. **Font-size rounding.** Same shape of problem for type: the legacy client used roughly 30 distinct
   `px` sizes; the token scale has 14. Production rounded each to its nearest token by role (a
   heading gets a display size, a value paired with a mono number gets a data size), which shifts a
   few sizes slightly (e.g. the landing hero title 78px → 64px/`--sl-fs-d1`, the hub heading 40px →
   44px/`--sl-fs-d2`). Flagging in case any of these were meant to be exact, not nearest-fit.

7. **News-card category tint.** The hub's three news-card background gradients originally carried an
   arbitrary per-category hue (gold/green/red) with no tie to real game state — a clear rule-3
   violation once the gold chrome strip made it obvious. Rather than flattening them to pure grey,
   production ties them to the closest matching status token via `color-mix()`
   (Update→`--sl-info`, Community→`--sl-ok`, Dev log→`--sl-danger`), which keeps the three cards
   visually distinct while staying inside the "hue only for real state" rule. This is closer to an
   editorial call than a mechanical migration — worth the design team's eyes on whether "info/ok/danger"
   are the right three categories, or whether news cards should just be uniform.

8. **"Armed frame" scope.** Foundations' four-frame section describes the armed frame as marking
   "the one thing awaiting the player's input — a selected province, an armed order, a live queue,"
   and caps it at one per screen. Production reads "a selected province" literally: the match HUD's
   entire sidebar becomes the armed frame (bracket ticks) whenever a province or a multi-selection
   is active, rather than trying to carve out a smaller sub-region. The hub's 1v1-queue "live queue"
   case — also named in that same sentence — was **not** wired up; the mode-picker/launch area has
   no armed-frame treatment while queueing. That's a real gap against the spec's own example list,
   left out for scope/time, not by design intent.

## Scope decisions

9. **`public/proto3d.html`** (a standalone 3D-engine test page, not linked from anywhere in the
   live product, no `run_worker_first` route) was left entirely out of the migration — no token
   link, no colour/font swap. It still uses the pre-migration literals end to end. It's dev scratch,
   not a shipped screen, but flagging in case it's expected to stay in sync.

10. **Screens II reference (landing/auth/matchmaking/profile/clan/social/settings/notifications)**
    — only landing, auth and hub exist as real screens in this codebase today; profile, clan, social,
    settings-as-a-page and notifications aren't built features yet. The migration applied the design
    system to every screen that exists, but didn't build out the other eight as new speculative UI —
    that would be new product surface, not a design-system migration. When those features get built,
    they have a ready-made reference to build against.

11. **Explicit `--sl-focus-ring` styling** wasn't retrofitted onto every interactive element. Nothing
    in the app currently does `outline: none` without a visible replacement (checked — the one place
    that removes the browser default, the editor's inline province-name field, swaps it for a
    border-bottom colour change), so the accessibility floor isn't violated, but the polished custom
    ring called out in Foundations isn't wired up either. Left as a nice-to-have beyond the three
    literal "screen is done" criteria (no raw hex / no px font-size / no ms literal).

## Not design-system related, flagged in passing

- `game.html`'s keyboard handler has two `case 'Escape':` arms in the same `switch` — the first
  (`this.exit()`) always wins, so Escape always quits to the hub instead of ever reaching the second
  arm's clear-selection behavior. Pre-existing, unrelated to this migration, left untouched.
- The production D1 `duel` map's four provinces (verrand/kolstig/aumere/dunmar) currently have empty
  `name` fields — confirmed via `/api/maps/duel` directly, not a rendering bug. Editor screenshots
  taken against production during QA show blank province-name inputs and blank board labels for
  this reason; local `wrangler dev`'s fresh D1 seed had real names, which is why this wasn't caught
  until the production smoke-test.
