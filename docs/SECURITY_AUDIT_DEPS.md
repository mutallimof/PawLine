# Dependency vulnerability assessment

*Run `npm audit` before each release. This file records the standing
assessment so the same known-noise items aren't re-investigated each time.*

## Current status (final pre-launch pass)

- **Production dependencies: 0 vulnerabilities.** `npm audit --omit=dev`
  is clean. This is what actually ships to users.
- **Dev dependencies: 2 (1 moderate, 1 high), both the same root issue** —
  the esbuild dev-server advisory (GHSA-67mh-4wv8-2f99), pulled in through
  Vite. 

### Why the dev-only items are not being "fixed"

The advisory is that esbuild's **local development server** lets any website
your browser visits send requests to `localhost:<vite-port>` and read the
response. It affects only `npm run dev` on a developer's machine. It is
**not present in the production build** (`npm run build` uses Rollup, and
the output is static files served by Vercel — no esbuild dev server exists
in production). 

`npm audit fix --force` would install Vite 8 (a major, breaking change) to
silence it. Taking a breaking framework upgrade days before launch, to
resolve an issue that cannot affect production or users, is the wrong
trade. The correct action is a planned, tested Vite major upgrade *after*
launch, on its own, where it can be verified in isolation.

**Developer mitigation until then:** don't browse untrusted sites while
`npm run dev` is running, or bind the dev server to localhost only (it is
by default). Zero user-facing exposure either way.

## Recommended ongoing practice
- Enable **Dependabot** on the GitHub repo (Settings → Code security →
  Dependabot alerts + security updates). It will open PRs for genuine
  production-dependency fixes automatically.
- Before each release: `npm audit --omit=dev` must be clean. Dev-only
  advisories are assessed case by case and recorded here.
