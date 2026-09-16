# Migration report — Command Console v1.0 → production

Full six-step migration from HANDOFF.md is live on supremacy.live, www.supremacy.live and
editor.supremacy.live as of this pass (six commits on `main`, one per step). This file is the
"anything that had to be invented comes back here" side of the pipeline — per the Revision
Procedure, these are requests back to the design project, not decisions to silently re-litigate
in the repo next time.

## Token gaps (had to use a raw value or a nearby substitute)

1. **No `--sl-signal-edge` token.** The faction slots each get a `-wash` and an `-edge` (e.g.
   `--sl-faction-self-edge: rgba(61,143,212,0.55)`), but `signal` only gets `-wash` and `-glow`.
   Several hover/selected states need exactly this shape — a brightened *border*, not a filled
   wash — and the Components sheet itself reaches for a bare `rgba(255,255,255,0.55)` literal in
   at least two places (the icon-button hover swatch, the filter-chip selected border) rather than
   a token. Production now does the same (Sign out / Cancel / Menu hover borders, chip borders) —
   which means a future rename of that literal in the design file won't be caught by find-and-replace
   the way a real token would be. Recommend adding `--sl-signal-edge: rgba(255,255,255,0.55)` and
   updating Foundations/Components to use it.

2. **No translucent-ink token.** Several places layer a partly-transparent version of an ink step —
   canvas label plates, the match-HUD hint bar under `backdrop-filter: blur()`. Production now
   builds these two ways: `color-mix(in srgb, var(--sl-ink-100) 76%, transparent)` for DOM CSS
   (works, but `color-mix` is a fairly recent CSS feature — worth confirming it's an acceptable
   floor), and a hand-rolled `parseInt(hex) → rgba()` cache for canvas (`board-render.js`,
   `game.html`'s march-label fill), since canvas can't do `color-mix` on a CSS custom property at
   all. Recommend either an explicit set of ink-at-alpha tokens, or blessing `color-mix()` in the
   spec so the next screen doesn't reinvent this.

3. **Reinforce action has no assigned status colour.** Build barracks and Develop industry both
   read naturally as "afford = ok, can't = danger" (implemented that way now — see below). Reinforce
   isn't a purchase, so that mapping doesn't fit; it's shipped as `--sl-info`, which isn't wrong but
   isn't specified anywhere either. Worth a line in the Components sheet about what "a free action
   available near the selection" gets styled as.

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
