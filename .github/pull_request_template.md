## What changed and why

<!-- One or two sentences. Link an issue if there is one. -->

## How this was tested

<!-- Commands run, scenarios clicked through in the browser, or "not tested" if that's the truth. -->

## Checklist

- [ ] `npm run lint` and `npm run validate` pass locally (CI will also check this)
- [ ] UI changes follow `CLAUDE.md` / `design-system/HANDOFF.md` (tokens only, achromatic, zero radius, mono numerals)
- [ ] D1 schema changes ship as a new file in `migrations/`, not an edit to an existing one
- [ ] No secrets, tokens, or `.dev.vars` content in the diff

## Deploy note

Merging this to `main` deploys to production immediately (see `.github/workflows/deploy.yml`). Flag in the PR description if this should be merged at a specific time.
