# Content inventory

What actually exists in the game right now, itemized — and, just as importantly, what doesn't exist
yet where a reader might expect it to. This is the doc to check before assuming a system ("units,"
"currencies," "cosmetics") has more depth than it currently does.

## Units

**One unit type, total.** A "troop" is an undifferentiated integer — no name, no stats, no visual
distinction beyond whose seat owns it. It exists in exactly two states:

- **Garrison** — stationary, sitting on a tile (`S.garrisons["c,r"]`).
- **Stack** — in transit between tiles (`S.stacks[]`: `{ id, seat, count, path, leg, prog, from }`).

There is no unit roster, no tech tree, no per-unit-type combat modifiers. Combat is pure subtraction
of counts (see [MECHANICS.md](MECHANICS.md) → Combat). If a future unit-type system gets built, it
slots in here — `garrisons`/`stacks` would need to become keyed collections of typed counts rather
than a single integer.

## Currencies

**One currency: coin**, stored as milli-coin (integer, `S.money[seat]`, ×1000 of the displayed value —
see [GLOSSARY.md](GLOSSARY.md)). No secondary/premium currency exists anywhere in the sim, the client,
or the schema. Two income sources (capital wealth, industry yield) — see
[MECHANICS.md](MECHANICS.md) → Currency.

## Structures

| Structure | Effect | Cost | Where |
|---|---|---|---|
| Barracks | +1 troop / 2.5s, capped at 150 per tile | Escalating per barracks already owned | Any owned tile in a **fully secured** territory (capital captured) |
| Industry | +1.5 coin/s | Flat 25 coin | Same territory-ownership requirement; barred on capital tiles |

One structure per tile, always. No structure has more than one tier, no structure can be upgraded —
"build a barracks" is a single, non-scaling purchase repeated as many times as the treasury and map
allow.

## Maps

| Key | Territories | Tiles | Status |
|---|---|---|---|
| `duel` | 4 | 100 | **Live** — the only board used by ranked 1v1 and the AI test match. Live-editable via `editor.supremacy.live`, backed by D1. |
| `solo` | 4 | 100 | Single-player campaign board, asymmetric by design. Not routed to by any live UI entry point; reachable via `?board=solo` if the AI test-match link is edited, or direct URL. Serves as the AI's tuning reference. |
| `grand` | 25 | 625 | **Shelved as of 2026-09-12** — fully defined and playable via explicit `?board=grand`, but no default anywhere points at it anymore. See [KNOWN_ISSUES.md](KNOWN_ISSUES.md). |

Board authoring format, symmetry rules, and the live-editor pipeline are in
[MAP_SYSTEM.md](MAP_SYSTEM.md).

## Factions / cosmetics

No purchasable or unlockable cosmetics of any kind exist — no skins, no avatars, no emotes, no
battle-pass-style content, no shop. The closest thing to "cosmetic content" is four **built-in seat-
color palettes** defined in `tokens.css`, switched via `data-faction` on `<html>`:

| Palette | Self | Foe | Notes |
|---|---|---|---|
| `cobalt-ember` (default) | blue | red | "Cold self, hot foe — reads instantly on the board." |
| `verdant-ember` | green | red | Legacy — matches the pre-v1 client |
| `cobalt-amber` | blue | amber | Deuteranopia/protanopia-safe (separated by lightness, not just hue) |
| `rose-verdant` | green | magenta | Tritanopia-safe |

**Not currently user-selectable anywhere in the live UI.** Both `index.html` and `game.html` hardcode
`data-faction="cobalt-ember"`; there is no settings control to switch it, despite all four palettes
being fully defined and referenced in the design system's own reference screens as switchable. This is
purely an accessibility feature waiting on UI wiring, not a monetization surface — worth keeping
distinct from "cosmetics" in the commercial sense if that's ever built.

Third and fourth faction slots (`--sl-faction-third`/`-fourth`) exist in every palette but are unused —
nothing in the sim or client supports more than 2 seats today (see [OVERVIEW.md](OVERVIEW.md)).

## Accounts

Username + email + password, no OAuth/SSO, no email verification, no password reset flow. See
[API.md](API.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Game modes

- **1v1 online**, matchmade via FIFO queue, `duel` board only.
- **AI test match**, `duel` board, opponent = `None` / `Passive` / `Steady` / `Ruthless`.

No ranked ladder/rating, no tournaments, no party/group queue, no spectate, no replay.
