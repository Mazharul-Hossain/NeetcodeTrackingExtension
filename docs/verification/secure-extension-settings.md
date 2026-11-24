# Secure extension settings verification

Status: Automated verification passed; current production Chrome/GitHub checks remain pending user testing. See the [November 24 save-correctness follow-up](2026-11-24-save-correctness.md) for the current browser checklist.

## Original verification environment

- Node v24.22.3 on Windows; feature branch `codex/secure-extension-settings`.
- User-confirmed compatibility fixture: Windows Hello PIN, Chrome 157.0.8103.80 Official Build ARM64.
- User reported both ENROLLMENT PASS and UNLOCK PASS after the requested full browser restart. Exact Windows version was not supplied.
- Production encrypted Save was confirmed by the user; a toolbar save after refreshing the NeetCode tab was observed with the success toast. No private config file, real token, or browser profile was read.

## Automated evidence

`npm run format`, followed by `npm run check`: **125 passed, 0 failed** (November 24 follow-up). The original settings review had 90 passing tests.

The current full check includes Prettier validation, ESLint and the Node test suite. `git diff --check` passed. Earlier syntax checks also passed for `background.js`, `vault-crypto.js`, `content-script.js` and `options.js`.

Coverage includes:

- Per-tab capture, one-time release, malformed/negative-tab handling and unconfigured toolbar routing.
- Language mapping and rejection, scoped categories, complete-model capture, Windows-safe titles, exact topic/front-matter/UTC output, blank-code problem-only saves, no-op feedback, nested Markdown lists and selected-title deduplication.
- Real native HKDF/AES-GCM round trips, fresh salts/IVs, wrong PRF keys, authenticated metadata/ciphertext tampering and malformed records.
- Rejected untrusted senders, nested frames, arbitrary endpoints, invalid extensions and path traversal.
- Trusted storage initialization ordering/failure, no plaintext local token, summary redaction and matching vault/session generation.
- Document/challenge/origin/RP hash/user-verification binding, single-use and expired unlock requests.
- Worker restart preservation, Lock/Clear behavior, metadata-save races and session-deletion failure across restart.
- Atomic Git Data API create/update, preserved notes, content-dependent synthetic tree hashes, identical-tree no-op detection, UTF-8, failures at every publication stage, concurrent branch changes, sanitized errors and timeout/abort through response-body consumption.
- Options-to-worker integration using actual encryption, first setup, blank-token metadata updates, candidate-only connection test, unlock/replacement, cancellation, unsupported PRF, corrupt-vault recovery and stale prompt completion after Lock/Clear.
- Manifest/resource wiring and absence of credential storage/networking in content scripts.

Before production migration, 20 baseline tests passed against the original implementation. Isolated in-memory wrong-tab and missing-SHA mutations triggered their intended assertions, followed by passing restoration. SHA/create/update/failure assertions now live at the worker boundary; extraction and front matter remain covered at the content-script boundary.

## Batch reviews

| Batch | Review and disposition |
| --- | --- |
| 0: Compatibility | Isolated fixture reviewed; user confirmed Windows Hello PIN enrollment and restart decryption. |
| 1: Characterization | Independent review requested additional orchestration and HTTP failure coverage. Added the missing cases; reviewer confirmed batch ready, 20/20 passing before migration. |
| 2: Worker/vault | Independent review found stale metadata Save defeating Lock/Clear and response-body consumption outside timeout/abort. Both reproduced in failing tests, fixed and verified green. A further failing regression test led to durable session-generation invalidation after deletion failure. |
| 3: UI/integration | Independent review found no confirmed production bug and identified meaningful missing scenarios. Added them; late passkey completion reproduced an unwanted follow-up prompt, fixed with abort checks. Unlock/replacement and corrupt-vault cases pass. |
| 4: Documentation/distribution and final review | Settings-based README and runtime allowlist staging inspected. Independent whole-change review completed. All five findings fixed with reproducing regressions and a green full suite: delayed unlock issuance across Lock, independent durable/session cleanup, stale cross-tab forms, trigger-to-upload generation binding, and native form token exposure. |
| Toolbar recovery | Independent review identified navigation during reconnection. Added clicked-route checks and navigation ticket invalidation, reproduced with failing tests then fixed. Re-review found no remaining actionable findings; focused 20/20 and full 79/79 tests pass. |

## Implementation decisions

- Effective RP ID is this extension's serialized origin, without trailing slash. Create/get omit RP fields; the worker checks the SHA-256 of that origin. Chromium's [implementation](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/webauthn/chrome_web_authentication_delegate.cc) isolates this namespace from website RP IDs.
- Both durable and session records include a public random `sessionGeneration`. Lock rotates it before removing the session, so an old session cannot become valid again merely by restarting the worker after deletion failed. It is not a decryption key.
- Public `recordGeneration` detects stale forms; pristine forms refresh on focus and dirty conflicting forms require an explicit reload. Existing v2 vaults without this additive field use the existing session generation as a compatibility default until their next update.
- Single-use upload tickets bind extraction to the initiating tab, vault/session generation and worker revision for two minutes. A locked automatic trigger sends feedback without starting extraction; Lock/Save/Clear invalidate existing tickets. No queued replay follows unlock.
- Every successful Save finishes locked: new enrollment, token replacement and public-field edits. Worker and integrated UI regressions verify no session token remains and Unlock with PIN is enabled immediately.
- NeetCode sender authorization uses the trusted sender origin plus current tab route, preserving top-frame/extension-ID checks and upload-ticket binding across SPA navigation. Regression cases cover a roadmap-origin document navigating to a problem and rejected foreign origins/nonproblem tabs.
- Native form token input has no submission name, and extension CSP forbids native form submission.
- Toolbar clicks outside a NeetCode problem open settings with an explanation. A bounded readiness probe automatically recovers missing receivers by injecting the packaged script in the isolated top frame, using `scripting` and existing NeetCode access. Registration is idempotent; only readiness is retried, never the upload. Failed recovery shows a fixed, actionable error at the top of Options. Recovery, duplicate registration, blocked/locked access and ambiguous delivery have regression coverage.
- Toolbar messages and upload tickets bind the clicked URL. Navigation invalidates outstanding tickets, and content scripts check the expected URL before extraction and after payload construction. Review identified the navigation race; regressions now cover switching problems during recovery and extraction.
- Content-script triggers explicitly acknowledge receipt separately from upload completion. A failing regression reproduced the missing acknowledgement; the fix and foreign-sender rejection pass independent review. Live inspection found the reload-tab notice while unlocked; refreshing the existing NeetCode tab restored toolbar saving, with a visible success toast.
- Minimum Chrome is 157, the verified browser baseline; unsupported PRF never falls back to plaintext storage.
- Existing local secrets and `.gitignore` stay untouched. Changes are organized into local commits; no release archive or store publication was performed. A user-requested production toolbar save was exercised through Chrome.

## Manual and distribution checks

- The settings HTML/CSS was visually previewed in a local Chrome tab. This is layout evidence only; a file URL does not provide extension runtime APIs.
- A temporary clean verification directory was populated from this exact allowlist: `manifest.json`, `background.js`, `vault-crypto.js`, `content-script.js`, `options.html`, `options.js`, `options.css`, `icon.png`, `LICENSE`. Enumeration matched all nine files. No config/env/docs/test artifacts were included; no ZIP was created.
- User reported the production Options status: "Settings saved. Your token is encrypted on this device." This confirms the main settings Save path; no credential value was provided in chat.
- User confirmed the connection-test result: "Authentication and repository access verified. Write permission is not verified."
- Live Chrome inspection showed the production vault unlocked and the toolbar redirect notice asking to reload the NeetCode tab. After refreshing the existing Spiral Matrix tab, clicking the extension displayed "Saved via click" without redirecting. The editor contained starter code. This verifies the worker-reported manual upload success; repository contents were not independently inspected.
- Still pending on the current implementation: production Chrome restart/unlock, actual page/content-script storage denial, real automatic create/update/no-op saves, and toolbar plus automatic reconnection after extension reload. Earlier compatibility-fixture and manual-save evidence does not complete these checks.
- Real submission URL transitions must also be checked: any tab URL change or loading event invalidates pending capture/tickets, and page URL matching includes the query string. Automated tests verify rejection; they do not show whether NeetCode changes routes during submission.
- Both trigger paths now use the bounded automatic receiver-recovery helper. This is covered by synthetic browser-boundary tests and has not yet been exercised in live Chrome for the current revision. The extension uses `scripting` plus existing NeetCode host access; `activeTab` was removed.
- Use the [current browser checklist](2026-11-24-save-correctness.md) to record actual results without treating automated tests as production verification.
- Never place a real token or PIN in this report, screenshots, test fixtures or chat. User credential entry and PIN prompts remain user-only.
