# Onboarding — new contributor setup

If you landed here from https://supremacy.live/llms.txt, this is where it sends you — keep going,
you're in the right place.

This is for Matt (GitHub: `tinkerfasttrack`) and whichever Claude Code instance he's running
locally. Follow it top to bottom on a fresh machine to go from nothing installed to opening your
first PR. Repo: `Synxpsis/supremacylive`. Matt already has **Write** access — no invite step
needed, just auth.

If you're a Claude Code instance running this for the first time in this repo: **read
[`CLAUDE.md`](../CLAUDE.md) in full before doing anything else** — it's the whole-repo entry
point (scope, process, dos/don'ts, pre-commit checklist) and it says to read
[`CONTRIBUTING.md`](../CONTRIBUTING.md) and the relevant docs next. This onboarding doc only gets
your local machine to the point where you can follow them; it isn't a substitute for reading them.

Commands below work the same in any shell unless a step says otherwise. Where install commands
differ by OS, each has its own tab — use the one for your machine and skip the others.

## Getting help

If the docs don't answer a question, ask rather than guess — see `CLAUDE.md`'s "Always check the
docs before assuming" rule. Reach Alex (or Matt) via:
- GitHub — PR or issue comments, so the answer stays attached to the work
- Google Chat — for anything faster than a PR comment; Matt already has this set up with Alex directly
- Email — alex@supremacy.live, mainly for anything security-sensitive (see `SECURITY.md`)

## 1. Prerequisites

Install these three, then confirm each with the version command shown.

**Windows:**
```
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install GitHub.cli
```

**macOS** (via [Homebrew](https://brew.sh) — install that first if you don't have it):
```
brew install node@24
brew install git
brew install gh
```

**Linux** (Debian/Ubuntu shown; use your distro's package manager — `dnf`, `pacman`, etc. — if different):
```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo apt-get install -y gh
```
(If `gh` isn't in your distro's default repos, follow the Linux install steps at
[cli.github.com](https://cli.github.com/manual/installation) — it's a one-time repo-add, not a
manual binary download.)

**All platforms — confirm:**
```
node --version   # expect v24.x — matches what CI and deploy run on
git --version
gh --version
```

This repo's workflow (this doc, `CONTRIBUTING.md`) assumes `gh` for opening PRs and checking CI
status — it's not optional tooling here, on any platform.

## 2. Authenticate

### git identity

Same command on every OS:
```
git config --global user.name "Matt"
git config --global user.email "<matt's email>"
```
Use whatever name/email should show up as the commit author — doesn't have to match the GitHub
account email.

### GitHub CLI + git credentials

Also the same command on every OS:
```
gh auth login
```

Choose:
- `GitHub.com`
- `HTTPS` as the preferred protocol (simplest — `gh` will also offer to configure git's
  credential helper for you; say yes)
- `Login with a web browser` (opens a one-time code + browser flow — no token to copy/paste)

Once this finishes, both `gh` and plain `git push`/`git pull` over HTTPS work without any further
setup, on Windows, macOS, or Linux alike. Confirm with:

```
gh auth status
```

You should see `tinkerfasttrack` logged in with the `repo` scope.

**If you'd rather use SSH remotes instead of HTTPS:** generate a key —
```
ssh-keygen -t ed25519 -C "your-email@example.com"
```
(macOS/Linux: also run `eval "$(ssh-agent -s)"` then `ssh-add ~/.ssh/id_ed25519` so the key is
picked up automatically; Windows' OpenSSH agent usually does this on its own via `ssh-agent`
service) — then add the printed public key at https://github.com/settings/keys, and use the
`git@github.com:...` clone URL in step 3 instead. Not necessary if `gh auth login` above worked —
HTTPS is enough for everything in this doc.

## 3. Clone the repo

```
gh repo clone Synxpsis/supremacylive
cd supremacylive
```

(`gh repo clone` is equivalent to `git clone` but uses your `gh` auth automatically — no URL
fiddling on any platform.)

## 4. Install and run locally

```
npm install
npm run dev
```

`wrangler dev` starts the Worker and a local D1 instance entirely on-machine, identically on
Windows, macOS, and Linux. **No Cloudflare account, login, or API token is needed for this** —
those only exist as GitHub Actions secrets for the production deploy, and you won't have or need
access to them. If `npm run dev` gets you a local server, you're set up correctly.

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
- Read `CLAUDE.md`'s pre-commit checklist before every commit, not just once at setup — it
  includes actually running the change (`npm run dev`) and, for UI changes, driving it in a real
  browser (Claude in Chrome, if available) rather than trusting the diff.
- UI work follows Command Console v1.0 — read `design-system/UI-RULES.md` before writing any UI.
  No raw hex, no px font-size, no border-radius outside tokens. If a value/component/state doesn't
  exist in `public/tokens.css`, flag the gap instead of inventing one locally.

## 8. Where to go next

- [`CLAUDE.md`](../CLAUDE.md) — whole-repo rules, read every session, not just this first one
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the process rules this doc pointed you to
- [`design-system/UI-RULES.md`](../design-system/UI-RULES.md) — UI/design-system rules
- [`docs/README.md`](README.md) — full technical inventory (architecture, mechanics, API, known issues)
- [`SECURITY.md`](../SECURITY.md) — how to report anything exploitable rather than opening a public issue
