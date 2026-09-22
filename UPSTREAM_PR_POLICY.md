# Upstream PR policy — LOCAL ONLY, never send to RallyPat

Upstream is https://github.com/RallyPat/LibreTune (`upstream` remote).
This file lives on `dev` only. It must never appear in any PR to upstream.

Rules for any branch intended for upstream:

1. The branch must contain ONLY the intended fix. NEVER include `dev`
   work — no features, no refactors, no drive-packs, no agent/MCP code.
2. NEVER add `Co-authored-by` trailers or any co-auth attribution.
3. Base the branch on `upstream/main`, not on the fork's stale `main`.
4. Verify with `git log --oneline upstream/main..BRANCH` and
   `git diff --stat upstream/main..BRANCH` before pushing.

History notes (2026-09-20):

- The July 2026 rebrand already reached upstream via PR #53 ("New Logo")
  and PR #54 ("Promote/logo dash cleanup"). Upstream `main` ships the new
  cam-lobe logo on all OS bundles. No icon fix is owed upstream.
- The fork's `origin/main` predates that merge, which is why main-based
  local builds showed the old monochrome icon. That staleness is local only.
- `dev` carries an extra local icon regeneration (`055921b`, transparent
  logo) on top of #54. Same artwork, different bytes — keep it here, do not
  push it upstream as a "fix".
- Local branch `fix/refresh-app-icons` was built against the stale fork
  main and must NOT be pushed or PR'd anywhere. Delete it once the fork
  main is synced with upstream.
