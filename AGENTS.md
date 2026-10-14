# Tally — agent guide

Shared instructions for any coding agent. Claude-specific notes live in CLAUDE.md.

> **Commit rule:** never `git commit` or `git push` without explicit approval —
> propose a message and wait. Exception: "deploy" means add + commit + push.

## Where things are

The app lives in `app/` (client) and `server/`. **[Design](design/index.html)** is
the project documentation — read the relevant pages before major work; start from
`design/assets/pages.js` for the page list. How the code is built (esbuild into
`app/dist/`, where TypeScript is used) is [Build & runtime](design/build.html).

## Conventions

- Start every JS/TS file with a header comment describing what it does and why.
- Keep a UI module's JS, HTML and CSS together in one folder.

## Keeping Design current

Update Design when you find it out of sync with the code, after a new feature or
major change, and add a page for a major feature that lacks one. Be succinct and
cross-link rather than repeating — state intent and invariants, and name the file
that holds a value instead of copying it. Keep the [Glossary](design/glossary.html)
current and link to it. Docs for things outside `app/` and `server/` go under the
Tooling group.

## Testing

For new features, ~90% confidence is enough — the human tests faster than an
agent. Bug fixes are the exception: write a test that proves the bug is fixed.
