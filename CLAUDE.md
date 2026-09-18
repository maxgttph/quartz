# Deploying learning.maxgtph.com

This repo is checked out at `~/quartz` on the container that serves the site,
next to `~/learning-vault` — siblings on purpose (see
`learning-vault/.claude/skills/learn/SKILL.md`, which greps for a directory
literally named `learning-vault`, one level up from here):

- `~/learning-vault/` — the notes. Own git repo, `main` branch.
- `~/quartz/` (this repo) — the site code. Own git repo, `learning-vault`
  branch. `vault/` in here is a symlink to `../learning-vault`.

## After `/learn` writes or edits a note

1. Review the new/changed files under `~/learning-vault/`.
2. **Commit and push only when the user says so** — `/learn` itself never
   commits (see its own "What this skill does NOT do"), and neither should
   you on its behalf:

       cd ~/learning-vault && git add -A && git commit -m "..." && git push

3. Rebuild the site, from here:

       npm run build

   This regenerates `content/fr/` and `content/en/` from `vault/` (symlinks +
   generated index pages) and rebuilds `public/fr/` and `public/en/`.
4. That's the whole deploy. No restart, no Docker, nothing to push anywhere
   else: `learning.maxgtph.com` is served by the `quartz-learning` systemd
   unit, which points at this checkout's `public/` directly and picks up the
   new build the moment `npm run build` finishes.

## If you change this repo's own code (theme, plugins, `quartz.config.yaml`, ...)

Same idea: commit and push (branch `learning-vault`), then `npm run build`.
You do **not** have permission to restart the `quartz-learning` systemd unit
(this user has no sudo) — you should never need to: it only serves static
files out of `public/`, so a rebuild alone is enough. If it's ever actually
down, that's an operator problem, not something to work around from here.

## What you can commit to which repo

- Notes, templates, anything under `~/learning-vault/` → the `learning-vault`
  repo.
- Config, theme, scripts, anything in this repo outside `vault/` (the
  symlink) → this repo, `learning-vault` branch.
- Never commit inside `vault/` directly — it's a symlink to
  `~/learning-vault/`, so anything written there already lands in the vault
  repo, not here.
