# Supremacy Live — CLAUDE.md

Read this file first, in full, every time you start working in this repo — before writing any
code, before running any other tool. It's the entry point. Everything it points to below is
required reading for the area you're touching, not optional background.

## Scope

Supremacy Live is a real-time, no-turns territory-control game (`README.md`, `docs/OVERVIEW.md`).
Two people ship to it: Alex (owner, GitHub `Synxpsis`) and Matt (GitHub `tinkerfasttrack`, write
access). Production is live at supremacy.live and editor.supremacy.live; a merge to `main` deploys
within a minute or two, with no staging environment in between. Treat every session in this repo
as production-adjacent — there is no sandbox to fail safely in.

## Before writing any code

Read these, in order, before touching a file — read them, don't skim them, and don't rely on a
previous session's memory of what they said, since they're living documents and change:

1. This file, in full — you're doing that now.
2. [`CONTRIBUTING.md`](CONTRIBUTING.md) — branch/PR/CI process, how a merge becomes a production deploy.
3. [`docs/README.md`](docs/README.md) — the documentation index — then whichever specific docs
   actually cover the area you're touching. [`docs/GLOSSARY.md`](docs/GLOSSARY.md) first if any
   term in the task is unfamiliar; `ARCHITECTURE.md` / `MECHANICS.md` / `MAP_SYSTEM.md` / `API.md`
   / `AI.md` / `RENDERING.md` / `KNOWN_ISSUES.md` as relevant to the change.
4. If the task touches anything a player or GM sees: [`design-system/UI-RULES.md`](design-system/UI-RULES.md)
   (condensed) and [`design-system/HANDOFF.md`](design-system/HANDOFF.md) (full spec) — see
   "Design system" below.
5. If the task touches auth, sessions, or anything exploitable: [`SECURITY.md`](SECURITY.md).
6. First session in this repo, or setting up tooling from scratch: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

**Always check the docs before assuming.** If a question about behavior, schema, API shape, or
design intent isn't answered by what's already written, don't guess and don't infer it from a
similar-looking codebase you've worked in before — read further, or ask. A wrong assumption
shipped to production is a worse outcome than a paused turn spent asking a question.

## GitHub

- `main` is protected: PRs required, the `Lint and validate` CI check must pass, review approval
  is optional (see `CONTRIBUTING.md` for why a 2-person team doesn't mandate cross-review yet).
  Alex can bypass as repo admin; nobody else can — direct pushes to `main` from any other account
  will simply be rejected.
- [`.github/CODEOWNERS`](.github/CODEOWNERS) routes `design-system/`, `CLAUDE.md`, and `.github/`
  to Alex specifically. Flag changes in those paths to Alex instead of merging solo, even where
  nothing technically blocks the merge yet.
- Full workflow — branch naming, opening a PR, what CI actually checks, what "merge = deploy"
  means in practice — lives in `CONTRIBUTING.md`. Don't duplicate it here; read it there.

## Notion

Not wired up for this project yet. `docs/README.md`'s code-grounded documentation set is the only
authoritative source right now — don't assume a Supremacy Live Notion workspace exists, and don't
search or fetch Notion for project context, until `docs/README.md` says that's changed.

## Design system

UI rules used to live in this file; they've moved to
[`design-system/UI-RULES.md`](design-system/UI-RULES.md) (condensed — read before any UI work,
every time) and [`design-system/HANDOFF.md`](design-system/HANDOFF.md) (full spec). This file
stayed the whole-repo entry point; the design system now owns its own rules since there's more
than UI to document here. Command Console v1.0 in one sentence: achromatic, zero-radius outside
the loading spinner, token-only — no value, component, or state gets invented locally. If it's not
in `public/tokens.css`, that's a gap to flag, not fill.

## Dos and don'ts

**Do:**
- Read the docs relevant to a task before forming an opinion about how something works.
- Flag a design-system or documentation gap instead of filling it locally.
- Ask Alex or Matt (GitHub PR/issue comments, or Google Chat) when the docs don't answer the question.
- Update the relevant doc in the same PR that changes the behavior it describes — `docs/README.md`'s
  own rule, and it applies to this file and `design-system/` too.

**Don't:**
- Don't push directly to `main` — open a PR, always, even for a one-line fix.
- Don't invent a token, component, state, or API shape that isn't already specified.
- Don't touch `.github/workflows/`, branch protection settings, or repo secrets. You likely don't
  have access to the latter; changes to the former should go through Alex regardless of access.
- Don't commit anything resembling a secret, token, password, or `.dev.vars` content.
- Don't mark a change "done" without actually running it — see the checklist below.

## General guidelines

- Two-person team, no dedicated QA, no staging environment beyond CI and the checklist below.
  Verification is the contributor's job, every time, not a safety net that catches it later.
- Prefer reading docs/source over asking a human when the answer is genuinely in the repo; prefer
  asking a human over guessing when it isn't. Neither substitutes for the other.
- Documentation is a living artifact, not a snapshot. If code changes a fact stated in `docs/`,
  this file, or `design-system/`, update the doc in the same commit — not a follow-up.

## Before you commit — checklist

Every item, every time, before `git commit`:

- [ ] Read the docs relevant to this change (see "Before writing any code" above) — not skimmed.
- [ ] `npm run lint` passes with no new errors. (Pre-existing warnings are fine — see `CONTRIBUTING.md`.)
- [ ] `npm run validate` passes.
- [ ] If UI changed: checked it line-by-line against `design-system/UI-RULES.md` — no raw hex, no
      px font-size, no ms literal, no `border-radius`, achromatic, mono numerals, correct frame.
- [ ] If gameplay or server logic changed: actually ran it. Start `npm run dev` and exercise the
      changed path yourself — reading the diff back is not verification.
- [ ] If UI changed and a browser is available: drove the actual change on the local dev server
      with Claude in Chrome (or a manual browser pass if that tool isn't available) — click through
      the real flow, don't just confirm the markup looks plausible. If something looked wrong,
      that's a blocker, not a note for later.
- [ ] No secrets, tokens, or credentials anywhere in the diff.
- [ ] D1 schema changes are a new file under `migrations/`, never an edit to one already shipped.
- [ ] Commit message explains why, not just what.
- [ ] Change lands via a PR against `main`, per `CONTRIBUTING.md` — never a direct push.
