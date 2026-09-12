# Known issues

A ledger, not a wishlist — things that are actually broken, missing, or inconsistent right now, with
where they were found and their current status. Feature ideas and roadmap belong wherever the team
tracks those, not here. Update this file in the same commit that fixes or newly discovers something.

## Open bugs

### `game.html`'s `Escape` key never clears a selection
Two `case 'Escape':` arms exist in the same `switch` inside the keyboard handler
(`_onKey` around `game.html:440-444`) — `case 'Escape': this.exit(); break;` and, a few lines later,
another `case 'Escape':` that clears `multi`/`marquee`/`sel`/`armed`/`mode`. JavaScript `switch`
matches the first case with that value; the second arm is dead code. Escape always exits to the hub;
it can never just clear a selection. Found during the Command Console migration
(`design-system/HANDOFF-GAPS.md`, "Not design-system related" section), left untouched at the time as
out of scope for that pass. **Still open.**

## Design-system gaps

The Command Console v1.0 migration surfaced a longer list of token gaps, judgment calls, and
deliberate scope decisions during its rollout — full detail in
[`design-system/HANDOFF-GAPS.md`](../design-system/HANDOFF-GAPS.md) rather than duplicated here. Short
version of what's still open there:

- No `--sl-signal-edge` token (a brightened-border shape several hover/selected states need); two
  places fall back to a raw `rgba(255,255,255,0.55)` literal instead.
- No translucent-ink token; canvas label plates and the match-HUD hint bar each solved this
  independently (`color-mix()` for DOM, a hand-rolled hex→rgba cache for canvas).
- `Reinforce`'s button colour (`--sl-info`) isn't actually specified anywhere for "a free action
  available near the selection" — it's a reasonable guess, not a documented mapping.
- The hub's 1v1-queue "live queue" state has no armed-frame treatment, despite Foundations naming it
  as an armed-frame example.
- `--sl-focus-ring` isn't retrofitted onto every interactive element (nothing violates the
  accessibility floor — no bare `outline: none` — but the polished custom ring isn't wired up broadly).

## Fixed this session (2026-09-11 – 2026-09-12)

Kept here for traceability — these were real bugs, now resolved on `main`:

| Issue | Fix | Commit |
|---|---|---|
| 3D troop-count labels froze on screen at their last position after a march completed, ignoring all further camera movement | A `CSS2DObject` nested under a removed parent (`sphere.remove(label)` was missing before `scene.remove(sphere)`) never got its DOM node cleaned up — Three only fires the removal event on the object removed directly, not recursively. See [RENDERING.md](RENDERING.md). | `e6101e5` |
| 3D garrison/troop/march labels rendered dead-centered on their tile/piece/sphere instead of offset above it | `CSS2DRenderer` overwrites `element.style.transform` inline every frame from the object's `.center`, silently overriding the CSS `transform` rule each label declared for its offset. Switched to `CSS2DObject.center`. | `e6101e5` |
| 3D camera had no selection-centering or lock — free to pan/rotate away from a tile mid-order | Selecting/arming a tile now recentres the orbit target and freezes rotate/pan (zoom stays live) until the selection clears. | `e6101e5` |
| `build()`/`industry()` allowed constructing on a tile owned individually even when the surrounding territory's capital hadn't fallen yet — territory was still contested | Both commands now also require `territoryOwner(M, S.owners, p) === seat`, returning `'territory not secured'` otherwise. | `dec3489` |
| A seat reduced to zero territories saw no game-over and had no legal moves left, since the win check only fired once the *other* seat reached the map's needed count | Added an elimination check in `step()`: zero territories = immediate loss, gated to real 2-seat matches so `solo` (no real seat 1) isn't affected. | `dec3489` |
| AI test match defaulted to the `grand` board (25 territories) instead of the board ranked 1v1 actually uses | Hub's test-match link and `game.html`'s board-resolution fallback both now default to `duel`; `grand` remains fully defined and reachable via explicit `?board=grand`. | `a74602b` |
| 3D board tiles were a flat, paper-thin plane — hard to visually distinguish from the void background, no sense of raised ground | Land tiles are now an extruded slab (top face still at `y=0`, so no overlay needed changes); gap tiles get a recessed water mesh instead of being hidden. See [RENDERING.md](RENDERING.md). | `628eda2` |
| In the 3D renderer, every structure (capitals, cities, barracks, industry) was coloured via a hardcoded seat 0 = self / seat 1 = foe mapping instead of the viewer-relative one ground tiles already used correctly — a seat-1 player saw their own capital in the opponent's colour while the ground under it was correctly self-coloured. Found via live 1v1 testing between two real accounts. | `upsertPiece()` now takes the same viewer-relative `seatColour` closure `update()` already threads through to every ground tile, instead of reaching for the standalone hardcoded function. Verified by rebuilding a live match's 3D scene under a forced seat-1 perspective. | `931a8c2` |
| The production `duel` board's live D1 content had lost its **entire `cities` array** (not just blank names, as first suspected — the array was completely empty: `"cities": []`). No capitals existed anywhere, so capital income (`sim.js`'s `cap.wealth` payout, which requires an actual city object at the centre tile) never fired for anyone — capturing territory produced no economic benefit at all, which is what "taking territory doesn't do anything" was actually describing. Ownership/combat itself was unaffected (that logic is purely tile-coordinate-based, no city object needed). | Restored via `PUT /api/maps/duel` with `map.js`'s known-good static `MAPS.duel` definition (real names, all 8 cities, correct wealth/garrison/seat values) — confirmed both by the automatic symmetry check passing and by re-reading `/api/maps/duel` afterward. A pre-existing corruption, not something this session's own editor changes caused (last write predates this session by ~2 days per its `updatedAt`). | data-only, no commit — see `worker.js`'s `handlePutMap` |
| The 3D camera's one-time initial placement (`game.html`'s `wire()`) offset from the player's own home by a **fixed world-space direction**, not one mirrored per seat the way the 2D camera's `viewYaw()` correctly is. Home sits in a different board corner per seat, so the fixed offset only pointed toward the board's interior for seat 0; for seat 1 it pointed *away* from the board entirely, past their own home's outer corner, into a steep near-horizontal grazing angle across the whole map. Live 1v1 testing reported this as two symptoms of the one bug: the camera "started backwards," and the board "looked black" (a raking angle lights mostly tile side-walls, not tops — read as missing colour, but wasn't). Distinct from the structure-piece colour bug above, found in the same testing pass — fixing one didn't fix the other. | Camera now offsets along the vector from home toward the board's centre — the same direction on every board, automatically mirrored for whichever corner a seat's home is in — instead of a fixed absolute direction. Verified seat 0's framing is pixel-identical (the math reduces to the old fixed offset for a home in that corner) and that a forced seat-1 rebuild now gets the same well-lit, correctly-oriented framing, with no black board. | `282c5d7` |

## Known limitations (by design or by scope, not bugs)

- **No reconnect** in a live match — a dropped connection is a forfeit after a 15s grace period, with
  no way to rejoin. Explicit v1 scope decision (`src/match.js`'s header comment), not an oversight.
- **No spectate or replay.** The client always renders "seat 0" as the viewing player with no seat
  remapping — a structural blocker for either feature, not just a missing menu option.
- **2-seat matches only.** Nothing in the sim, matchmaker, or board model supports more than two
  players in one match.
- **`grand` board shelved** (see [OVERVIEW.md](OVERVIEW.md), [MAP_SYSTEM.md](MAP_SYSTEM.md)) — not
  deleted, just not defaulted to anywhere as of 2026-09-12.
- **Faction palette not user-selectable** despite four being fully defined — see
  [CONTENT_INVENTORY.md](CONTENT_INVENTORY.md).
- **`public/proto3d.html`** is unmigrated scratch code, not a shipped screen — see
  `design-system/HANDOFF-GAPS.md` item 9.
