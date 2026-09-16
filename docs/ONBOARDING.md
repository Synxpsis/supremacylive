# Onboarding — new contributor setup

This is for Matt (GitHub: `tinkerfasttrack`) and whichever Claude Code instance he's running
locally. Follow it top to bottom on a fresh machine to go from nothing installed to opening your
first PR. Repo: `Synxpsis/supremacylive`. Matt already has **Write** access — no invite step
needed, just auth.

If you're a Claude Code instance running this for the first time in this repo: read
[`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`CLAUDE.md`](../CLAUDE.md) right after finishing this
doc — they're the actual working rules. This doc only gets you to the point where you can follow
them.

## 1. Prerequisites

- **Node.js 24** — matches what CI and deploy run on. Check with `node --version`. Install from
  [nodejs.org](https://nodejs.org) or a package manager (`winget install OpenJS.NodeJS.LTS`,
  `brew install node@24`, etc.) if missing.
- **git** — `git --version`. Install from [git-scm.com](https://git-scm.com) if missing.
- **GitHub CLI (`gh`)** — `gh --version`. Install from [cli.github.com](https://cli.github.com)
  (`winget install GitHub.cli`, `brew install gh`, `apt install gh`). This repo's workflow (this
  doc, `CONTRIBUTING.md`) assumes `gh` for opening PRs and checking CI status — it's not optional
  tooling here.

## 2. Authenticate

### git identity

```
git config --global user.name "Matt"
git config --global user.email "<matt's email>"
```

Use whatever name/email should show up as the commit author. Doesn't have to match the GitHub
account email.

### GitHub CLI + git credentials

```
gh auth login
```

Choose:
- `GitHub.com`
- `HTTPS` as the preferred protocol (simplest — `gh` will also offer to configure git's
  credential helper for you; say yes)
- `Login with a web browser` (opens a one-time code + browser flow — no token to copy/paste)

Once this finishes, both `gh` and plain `git push`/`git pull` over HTTPS work without any further
setup. Confirm with:

```
gh auth status
```

You should see `tinkerfasttrack` logged in with the `repo` scope.

**If you'd rather use SSH remotes instead of HTTPS:** generate a key (`ssh-keygen -t ed25519`),
add it at https://github.com/settings/keys, then use the `git@github.com:...` clone URL in step 3
instead. Not necessary if `gh auth login` above worked — HTTPS is enough.

## 3. Clone the repo

```
gh repo clone Synxpsis/supremacylive
cd supremacylive
```

(`gh repo clone` is equivalent to `git clone` but uses your `gh` auth automatically — no URL
fiddling either way.)

## 4. Install and run locally

```
npm install
npm run dev
```

`wrangler dev` starts the Worker and a local D1 instance entirely on-machine. **No Cloudflare
account, login, or API token is needed for this** — those only exist as GitHub Actions secrets
for the production deploy, and you won't have or need access to them. If `npm run dev` gets you a
local server, you're set up correctly.

## 5. Verify the tooling that gates every PR

```
npm run lint
npm run validate
```

Both should pass clean on an untouched checkout (`lint` may show a handful of pre-existing
warnings — that's expected and doesn't fail CI; see `CONTRIBUTING.md`). This is exactly what
`.github/workflows/ci.yml` runs on every PR, so if it's clean locally it'll be clean in CI.

## 6. Open your first PR

`main` is protected — there is no direct push, for anyone but the repo owner. Every change,
including yours, goes through a branch and a PR:

```
git checkout -b matt/short-description
# make a change
git add <files>
git commit -m "..."
git push -u origin matt/short-description
gh pr create
```

Then `gh pr checks <number>` to watch CI, or just check the PR page. Once `Lint and validate`
passes, it's mergeable — an approval is not currently required (see `CONTRIBUTING.md` for why),
but ping the other person for a look on anything touching auth, D1 schema, matchmaking, or
payments logic.

**Merging deploys to production within a minute or two.** There's no staging environment. Treat
every merge as a release — if you're not sure a change should go live right now, say so in the PR
instead of merging it.

## 7. Guardrails specific to this Claude instance

- `.github/CODEOWNERS` routes `design-system/`, `CLAUDE.md`, and `.github/` (CI/deploy config,
  branch rules) to `@Synxpsis` specifically — if a change touches those paths, flag it to Alex
  before merging rather than merging solo, even though nothing technically blocks it yet.
- You have Write access, not Admin — repo settings, branch protection, and the Cloudflare
  deploy secrets aren't visible or editable from this account. If a task seems to need any of
  those, that's a sign to stop and ask rather than look for a workaround.
- UI work follows Command Console v1.0 — read `CLAUDE.md` before writing any UI. No raw hex, no
  px font-size, no border-radius outside tokens. If a value/component/state doesn't exist in
  `public/tokens.css`, flag the gap instead of inventing one locally.

## 8. Where to go next

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the actual process rules this doc pointed you to
- [`CLAUDE.md`](../CLAUDE.md) — UI/design-system rules
- [`docs/README.md`](README.md) — full technical inventory (architecture, mechanics, API, known issues)
- [`SECURITY.md`](../SECURITY.md) — how to report anything exploitable rather than opening a public issue
