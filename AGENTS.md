# Agent instructions

NeetCode Tracking 2.0 is a Manifest V3 Chrome extension that saves NeetCode solutions to the user's GitHub repository. Read [README.md](README.md) for setup, behavior and the Development section; this file only adds rules for automated changes.

## Before you finish

- Run `npm run format`, then `npm run check` (Prettier check, ESLint, tests). Both must pass.
- Add or update a test in `tests/` for every behavior change. Use synthetic tokens and data only; never a real token, PIN or private repository content.
- Keep layout-only changes out of logic commits. If you add a formatting-only commit, list its hash in `.git-blame-ignore-revs`.
- Commit titles are imperative and sentence case, with no `feat:`-style prefixes. Bodies explain why and how the change was verified.

## Code structure

- No build step and no runtime dependencies. Extension files are classic scripts, not ES modules: `background.js` loads `vault-crypto.js` with `importScripts`, and the test harness reads top-level names from a Node VM. Keep top-level declarations that tests use.
- Prettier and ESLint enforce style; don't hand-format against them or disable rules inline without a comment explaining why.

## Security rules (not enforced by tooling)

- Only `background.js` handles the token, the vault and GitHub requests. `content-script.js` must never receive the token, its key or a GitHub URL; `tests/manifest.test.cjs` checks part of this.
- Every new runtime message type must be added to the sender checks in `background.js` (`isOptionsSender` for the Options page, `isProblemSender` for NeetCode problem pages).
- Show users only fixed, predefined messages (worker errors come from `ERROR_MESSAGES` in `background.js`); never surface raw browser, network or GitHub errors. Do not log tokens, unlock material, solution code or GitHub responses.
- Do not add permissions, host permissions or remote code without updating the README permissions table and `PRIVACY.md`.
- Release packages contain only the allowlisted files listed in the README. Never read or package `config.js`, `.env` or browser profiles.
