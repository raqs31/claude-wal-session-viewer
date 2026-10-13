---
name: wal
description: "Install, update or start the local wal session viewer (`wal`) and report its URL."
disable-model-invocation: true
argument-hint: "[install | update | run [--port=N] [--source=<config-dir>]...]"
model: sonnet
---

# wal

Get the user from nothing to an open viewer: the `wal` command from
`@raqs31/claude-wal-session-viewer` (https://github.com/raqs31/claude-wal-session-viewer), which
shows the events this plugin's hook records and the usage and cost in the transcripts.

Arguments: `$ARGUMENTS`

## Pick the job

- `install` → **Install**.
- `update` → **Update**.
- `run ...` or `start ...` → **Run**, passing everything after that first word to `wal`.
- Nothing → `command -v wal`. Found: ask whether to run it, check for updates, or reinstall. Not
  found: **Install**, then offer **Run**.
- Anything else, flags without `run` included → don't guess a job from it. Ask which job was
  meant (**Install**, **Update**, **Run**), quoting what wasn't recognized. If they pick **Run**,
  pass any `--` arguments on to `wal`.

Ask with AskUserQuestion whenever a choice is the user's: route, clone dir, replacing a file,
applying an update.

## Prerequisites

Check before installing or running, and stop with the reason if one fails:

- `node --version` is 24 or newer: the package declares `engines.node >=24`, and a checkout runs
  its TypeScript through Node's type stripping. Don't install Node yourself; the user picks the
  version manager.
- `npm` on PATH; `git` too for the checkout route.
- Linux or macOS. `scripts/wal` is bash and the browser opener is `xdg-open`/`open`; say Windows
  isn't covered rather than improvising.

## Install

Ask for the route: **GitHub Packages** or **Git checkout**.

### GitHub Packages

1. `npm whoami --registry=https://npm.pkg.github.com`. On `ENEEDAUTH`, the user logs in themselves
   so the token never passes through this conversation. Tell them to create a classic token with
   `read:packages` at https://github.com/settings/tokens, run
   `! npm login --scope=@raqs31 --auth-type=legacy --registry=https://npm.pkg.github.com`, and enter
   their GitHub username and the token as the password. Re-check afterwards.
2. `npm view @raqs31/claude-wal-session-viewer version --registry=https://npm.pkg.github.com`. On
   `E404` no release has been published yet: say so and offer the checkout route.
3. `npm install -g @raqs31/claude-wal-session-viewer --@raqs31:registry=https://npm.pkg.github.com`.
   On `EACCES`, npm's global prefix is a system dir: report it and let the user choose a fix
   (`npm config set prefix ~/.local`, a Node version manager). Never retry with `sudo`.
4. Verify: `command -v wal && wal --help`.

### Git checkout

1. Ask for the clone dir, default `~/.local/share/claude-wal-session-viewer`. If it already holds
   this repo, `git -C <dir> pull --ff-only` updates it. If it holds anything else, stop and ask.
2. `git clone https://github.com/raqs31/claude-wal-session-viewer.git <dir>`
3. Link it onto PATH: `mkdir -p ~/.local/bin && ln -s <dir>/scripts/wal ~/.local/bin/wal`. If
   `~/.local/bin/wal` exists, show `ls -l` of it and ask before replacing. `scripts/wal` resolves
   its own realpath, so the symlink still finds the checkout.
4. Verify: `command -v wal && wal --help`. If `command -v` resolves elsewhere (an npm install
   earlier on PATH) or nothing (`~/.local/bin` not on PATH), tell the user which and how to fix
   their PATH.

The first `wal` run from a checkout installs dependencies and builds the page, so it takes a minute.

## Run

1. Start `wal` with the user's arguments using Bash `run_in_background: true`. It runs in the
   foreground until stopped, so a plain call would block until the timeout.
2. Wait for the line `wal viewer:  http://127.0.0.1:<port>` in the task's output and report that
   URL. `wal` opens it in the browser itself when an opener exists. The default port is 7878 (or
   `$WAL_PORT`), and a busy port moves it up, at most 10 times, so read the port from the line
   rather than assuming it.
3. While it starts, run the viewer check from **Update** (find the install, compare), without the
   plugin check or any prompt, so the start is never held up. Skip it silently on a network or auth
   error. If a newer version exists, add one line to the report: installed → latest, and
   `/wal-hook:wal update`.
4. Tell the user the server lives as long as this background task: ask Claude to stop it, or end
   the session. For a server that outlives the session, run `wal` in their own terminal.

The server binds `127.0.0.1` only because the data holds prompts, file contents and command output.
Don't help expose it beyond the machine.

## Update

Check the viewer, then the plugin, and report both before changing anything.

### Find the install

`realpath "$(command -v wal)"` tells which kind it is:

- Ends in `/dist/scripts/cli.js`: the npm package. Installed version:
  `npm ls -g @raqs31/claude-wal-session-viewer --depth=0`. Latest: the `npm view` command from
  GitHub Packages step 2, with the same `ENEEDAUTH` handling as step 1.
- Ends in `/scripts/wal`, two levels below a dir whose `git -C <dir> remote get-url origin` names
  `raqs31/claude-wal-session-viewer`: a checkout. Releases land on origin's default branch, which
  `git -C <dir> ls-remote --symref origin HEAD` prints as `ref: refs/heads/<branch>`. If
  `git -C <dir> branch --show-current` names another branch, say so and leave it; switching is the
  user's call. Otherwise `git -C <dir> fetch --quiet origin <branch>`, and
  `git -C <dir> log --oneline HEAD..origin/<branch>` lists what's new.
- Anything else, or nothing: not this viewer (another tool can own the name `wal`). Say what
  `command -v wal` points at and offer **Install**.

### Viewer

If it's behind, show installed → latest (npm) or the new commits (checkout), ask, then:

- npm: the install command from GitHub Packages step 3, with `@latest` after the package name.
- checkout: `git -C <dir> pull --ff-only origin <branch>`. If it refuses (local commits or
  changes), report that and stop. Don't reset or stash, because that's the user's work. The next
  `wal` run installs changed dependencies and rebuilds the page.

A running viewer keeps serving the old code until it restarts; if this session runs one, offer to
restart it.

### Plugin

1. `claude plugin marketplace update claude-wal-session-viewer` refreshes the catalog.
2. Installed: `version` of `wal-hook@claude-wal-session-viewer` in `claude plugin list --json`.
   Latest: `version` in `<installLocation>/plugins/wal-hook/.claude-plugin/plugin.json`, with
   `installLocation` from `claude plugin marketplace list --json`.
3. If it's behind, ask, then `claude plugin update wal-hook@claude-wal-session-viewer`. The new hook
   and this skill load only after Claude Code restarts; say so.

## Old per-project logs

When the page shows the legacy banner, `wal legacy` folds old `<cwd>/.ai/logs/wal.jsonl` files into
per-session ones. It prompts `[m]igrate / [d]elete / [s]kip` per file, and the Bash tool has no
stdin, so tell the user to run `! wal legacy` themselves.

## Events tab is empty

Usage and cost come from transcripts alone; events need the hook. Check, in order:

- `node` is on the PATH Claude Code runs hooks with: the hook is `node .../wal-hook.mjs`.
- The hook is installed in every Claude config dir in use: each `CLAUDE_CONFIG_DIR` workspace needs
  its own `/plugin install wal-hook@claude-wal-session-viewer`.
- The session has a WAL at all: `<config>/projects/<slug>/<session>.wal.jsonl`, beside its
  transcript. Sessions that ran before the hook was installed have none.
