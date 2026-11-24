# Configure GitHub through extension settings with PIN-assisted unlock

Status: Verifying — implementation and automated checks passed; production live checks pending

Users currently have to clone or download the extension and create an ignored `config.js` containing a GitHub token. Add an extension settings page so installed-extension users can configure GitHub without editing source files. Save an encrypted token locally, unlock it through a compatible passkey's OS/browser PIN prompt, and keep all GitHub requests in the background service worker. Users must not have to reenter the GitHub token after restarting Chrome.

Windows Hello PIN enrollment and restart decryption passed in the isolated fixture on Chrome 157.0.8103.80 ARM64. Production code uses the same extension-owned RP configuration. Current verification results are in [verification evidence](../verification/secure-extension-settings.md).

**Approval boundary:** implementation is approved. Pass Batch 0 before production changes; stop for prerequisites requiring user attention. Commits, packaging and publication require separate direction.

Format: `C:/Users/mazha/GitHub/Personal-Website/docs/PLAN_TEMPLATE.md` (read-only). This file at `docs/plans/2026-11-23-secure-extension-settings.md` is the authoritative implementation plan.

## Contract

### Inputs and triggers

- First installation (`chrome.runtime.onInstalled`, `reason === 'install'`) opens the settings page. Extension updates retain settings and do not automatically open the page.
- Users can reopen settings through Chrome's extension Options entry. The toolbar continues to save the current NeetCode problem when configured; when unconfigured it opens settings instead.
- Settings inputs: GitHub username/repository owner, repository name, personal access token, committer name, and committer email. Explain that the owner may be an organization; it need not match the token owner's login.
- Settings controls: Save, Test connection, Clear settings, Unlock with PIN, and Lock. Testing uses the current form values without implicitly saving them.
- First Save enrolls a compatible passkey and encrypts the token. After Chrome restarts, users choose Unlock with PIN and approve the system/browser authenticator prompt; they do not reenter the token. Ordinary worker restarts must not require another unlock during that browser session.
- Interpret PIN as a supported authenticator's PIN (for example Windows Hello or a passkey provider PIN), not digits collected by our form. WebAuthn requests user verification but cannot force a particular PIN UI instead of biometrics; the chosen Chrome/provider combination must demonstrate an actual usable PIN path. No biometric-specific feature is required.
- Existing `CODE_DATA` and `MANUAL_TRIGGER` flows continue to initiate problem extraction. Automatic saves still depend on observing completion of NeetCode's own GitHub-sync request; this feature does not remove that dependency.

### Required outputs

| Input / condition | Required output |
| --- | --- |
| Valid first Save / replacement token | Complete passkey setup/verification and worker-side encryption; persist public settings plus an encrypted vault in `chrome.storage.local`. Never persist plaintext token or decryption key there. Show success only after durable storage succeeds; finish locked with Unlock with PIN enabled. |
| Invalid fields / storage failure | Show a specific safe error; preserve the previous saved record. Never echo token input. |
| Reopen settings | Restore non-secret fields and `hasToken` / `isUnlocked` indicators; leave the token input empty. |
| Empty token on Save with an existing vault | Save valid public-field edits while preserving ciphertext, then lock the vault and enable Unlock with PIN; decryption is unnecessary. A new installation must provide a token and enroll protection. |
| Empty token on Test with an existing vault | Reuse the token inside the worker only while unlocked; otherwise return `VAULT_LOCKED` and offer Unlock with PIN before retrying. |
| New nonempty token | Use it for the requested Save or Test; clear the input after a successful operation. Failed requests may retain user input for correction until navigation/clear. |
| Successful Test | Confirm authentication and repository access, with the explicit qualifier that write permission and branch policies are not verified. Do not create/update/delete files. |
| Unlock with PIN | User-initiated passkey ceremony yields PRF key material; worker decrypts the stored token and caches only the token plus vault ID in restricted `chrome.storage.session`. No GitHub token entry or persistence of the PIN/key. |
| Cancelled prompt / unsupported PRF / failed decryption | Remain locked; preserve existing encrypted record; show a safe actionable error. Do not downgrade to plaintext or use a numeric PIN as an encryption key. |
| Lock | Invalidate in-flight work, remove the session token, preserve the encrypted local vault, and require a fresh user-initiated unlock. |
| Browser restart / extension reload or update | Encrypted vault remains; session token is gone; require PIN-assisted unlock. Do not promise silent unlock. |
| Clear settings | After an inline confirmation, invalidate work and remove both the local settings/vault record and session token, then reset the form. Does not revoke the GitHub token or delete the passkey from its provider; explain manual cleanup. |
| Lost/deleted passkey | Explain that the ciphertext is unrecoverable with that credential; let the user confirm Clear and configure a replacement GitHub token/passkey. Do not silently overwrite the vault. |
| Missing configuration during a save | Return `NOT_CONFIGURED`, display an actionable toast, and send no GitHub request. |
| Configured but locked during manual/automatic save | Return `VAULT_LOCKED`, offer an Open settings/Unlock action, and make no GitHub request. Do not open an authenticator prompt in the background or persist/replay the attempted upload. After unlock the user deliberately saves again. |
| Valid automatic/manual upload | Worker writes optional `solution.<extension>` and required `problem.md` under `{category}/{problem-slug}/`, using existing SHA when updating. Return only sanitized status metadata. |
| Partial upload / request failure | Report failure without claiming that both files saved. Earlier successful commits cannot be rolled back by this change. |

### Constraints

1. Keep plain JavaScript and Manifest V3; add no runtime packages, framework, server, analytics, or remotely loaded scripts/styles/fonts.
2. Use `chrome.storage.local` for public settings and encrypted vault only; `chrome.storage.session` for the unlocked token and vault ID only. Restrict both to `TRUSTED_CONTEXTS` and await both restrictions before any credential operation. Fail closed on initialization errors. Session storage survives worker suspension but is cleared on browser restart and extension reload/update. [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).
3. Chrome does not encrypt extension storage for us. Encrypt the token with AES-256-GCM using key material derived from WebAuthn PRF; never store the PIN, PRF output, or derived key on disk. This protects the locked token against theft of ciphertext alone, subject to authenticator and browser security. It does not protect against compromised extension code, malware reading the unlocked session, or compromised passkey storage. [Chrome privacy guidance](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy), [W3C PRF explainer](https://github.com/w3c/webauthn/blob/main/explainers/prf-extension.md).
4. The trusted settings page handles newly entered tokens and transient WebAuthn PRF output; it never receives a decrypted stored token. The worker owns vault encryption/decryption, local/session storage and GitHub requests. WebAuthn must run in the visible extension page, not the service worker. Never use `storage.sync`, page `localStorage`, query strings, exports, or generated config/env files for secrets.
5. Recommend a fine-grained token restricted to the selected repository, Contents read/write, and an expiration. Explain that Clear removes the local record but does not revoke the token at GitHub. [GitHub Contents API permissions](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).
6. Treat content-script messages as untrusted input, even from this extension. Validate sender, operation, fields, and destination; never expose a generic fetch or arbitrary GitHub-file-write proxy. [Chrome messaging security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#security-considerations).
7. Preserve category selection, Markdown/KaTeX formatting, topics, UTC dates, blank-code problem-only behavior, current extension mapping (`py`, `java`, `cpp`, `c`, `js`), default branch, commit message format, and create/update semantics. Correcting the existing C# `.c` mapping is outside this migration.
8. Preserve existing JavaScript header comments but update their responsibilities/dependencies. Add equivalent headers to new JavaScript files only. No agent headers in `manifest.json`, README, `.gitignore`, or HTML/CSS.
9. Leave the user's ignored local `config.js` and `.gitignore` untouched. Do not read, migrate, print, commit, or distribute real credentials. Removal means removing runtime dependency and distribution exposure, not deleting the user's local file.
10. WebAuthn PRF is capability-dependent. Use `userVerification: 'required'`; reject missing PRF results, cancellation, malformed proof, and cryptographic failures. A successful ordinary passkey assertion alone does not prove PRF support. A hash/signature of a passkey or a short extension PIN is not a substitute encryption key. [W3C PRF ceremony requirements](https://github.com/w3c/webauthn/blob/main/explainers/prf-extension.md).

### Completion criteria

- [ ] A clean extension directory with no `config.js` loads successfully in Chrome and opens settings on first install only.
- [ ] All five fields, Save/Test/Clear, and Unlock/Lock work. After a full browser restart a demonstrated PIN path unlocks the existing encrypted token without token reentry; worker restart alone does not relock.
- [ ] Local storage contains no plaintext token, PIN, PRF output or encryption key; session storage contains the token only while unlocked. Cancellation/unsupported PRF/corrupt ciphertext fail closed.
- [ ] Batch 0 has established a valid relying-party configuration and tested Chrome/provider versions, without a backend, desktop helper, broad host permissions or a third-party domain borrowed without control.
- [ ] Content-script attempts to read local and session settings are denied in live Chrome, including after worker restart.
- [ ] Website/content-script senders cannot read/save/test/clear settings, choose a repository, or inject request URLs/headers.
- [ ] GitHub network requests originate only in the worker; tokens appear only in its Authorization header, never in messages back to content scripts, UI text, logs, fixtures, or packaged files.
- [ ] Automated characterization/security tests pass; configured manual and automatic save paths are demonstrated in Chrome with controlled data.
- [ ] Connection tests make no write requests and do not claim write access; clear/replacement cancels further old-credential work.
- [ ] README describes encrypted setup, PIN-assisted unlock, locked-save behavior, loss/reset and Clear/passkey cleanup accurately. Packaging contains no config/env files or credentials.
- [ ] Evidence and remaining limitations are recorded here; Web Store publication is not implied by local verification.

### Out of scope

This plan covers local extension settings, PIN-assisted token protection, and the existing GitHub save workflow. Publication and unrelated changes to capture, formatting, languages, or output structure are separate work. PIN management belongs to Windows/the chosen provider; recovery is limited to clearing settings and configuring a replacement token/passkey.

## Existing code trace

Line references are from the reviewed working tree, before implementation. No token values were inspected.

| Stage | Owning file / symbol | Current behavior / evidence | Existing coverage |
| --- | --- | --- | --- |
| Load configuration | `manifest.json`, `content_scripts[0].js` | Injects `config.js` then `content-script.js` at `document_start`, currently in all frames. | No automated tests; manifest inspected. |
| Expose configuration resource | `manifest.json`, `web_accessible_resources` | Lists `config.js` for `<all_urls>`. Remove this exposure entirely; a constant in an isolated script is not itself a page global, but a web-accessible secret file is a separate disclosure risk. | Inspection only. |
| Capture automatic code | `background.js:16-52`, `pendingCodeByTab`, `onBeforeRequest` | Decodes `requestBody.raw[0]`, parses `parsed.data || parsed`, stores `{ title: problemId, code: rawCode }` by tab for `executeCodeFunctionHttp`. | Syntax check only. |
| Release automatic save | `background.js:54-85`, `onCompleted` | After `githubFunctionHttp` completes, sends `CODE_DATA` to the tab and deletes its pending code. No GitHub response/success validation is performed here. | No behavior tests. |
| Manual save | `background.js:87-89`, `chrome.action.onClicked` | Sends `MANUAL_TRIGGER` to the active tab without a configuration guard. | No behavior tests. |
| Route/extract code | `content-script.js:486-523`, `getCode`, runtime listener | Uses `.inputarea`, falling back to `.view-lines .view-line`; automatic messages supply code directly. Logs the entire incoming message. | No DOM fixtures. |
| Extract and format page | `content-script.js:20-44,143-208,268-456`, `waitForElement`, `getLanguage`, `waitForTopics`, `formatArticleComponent`, `getCategory`, `processAndUpload` | Waits for title/article/language/topics; formats Markdown/math/tags/UTC date; category is System Design or Data Structures & Algorithms. | No characterization tests. |
| Build upload body | `content-script.js:210-266`, `addToGithub` | Reads `config.github.username/repo_name/token/committer_name/committer_email`; builds path, commit message, UTF-8/Base64 and request objects. The log says background/GitHub, but actual fetch runs here. | No API mocks. |
| Read/create/update | `content-script.js:95-140`, `findExistingFile`, `uploadToGitHub` | GET Contents; 404 means absent; use existing SHA on PUT; accept 200/201. Raw GitHub bodies are returned/logged; raw GET error body is placed in an exception. | Syntax check only. |
| User feedback | `content-script.js:437-484`, `processAndUpload`, misspelled `conentAdded` | Shows toast based on final result; optional solution uploads before problem. A solution failure can still be followed by a problem upload, then failure is returned. | No result/partial-failure tests. |
| Setup/documentation | `README.md`; `.gitignore` | README teaches creating `config.js`; ignore rule excludes it. README has conflicting date/category and Run/Submit instructions. | Manual inspection. |

Proposed setup/unlock flow: **visible Options page → user-verified passkey PRF → validated worker message → worker AES-GCM vault / restricted session token**. GitHub flow: **existing trigger → content-script extraction/Markdown → `UPLOAD_PROBLEM` without credentials → worker checks unlocked session and calls GitHub → sanitized result → toast**. There is no existing PIN/crypto implementation or coverage to reuse.

## Mandatory pre-test gate for refactoring and migrations

Applicable: this moves working upload/configuration behavior across the content-script/worker boundary. Existing behavior must be characterized before moving it. Writing this plan does not execute that migration.

### Baseline and coverage map

Baseline: commit `791d1d76500e2a1b83f608f6d8efac1df50e52f0`; Node `v24.22.3`; Windows PowerShell. Preserve the uncommitted JavaScript header comments. There is no package manifest, build pipeline, or test suite. Local `config.js` is ignored and must remain untouched.

Fresh planning checks: `node --check background.js`, `node --check content-script.js`, and `git diff --check` all passed. These prove syntax/patch hygiene only, not extension behavior or credential isolation. Live Chrome and GitHub checks have not been performed.

| Behavior / contract | Existing test to reuse | Missing scenario / new test needed | Required pre-change result | Required post-change result |
| --- | --- | --- | --- | --- |
| Per-tab capture and sync-completion trigger | None | `tests/background.test.cjs`: two tabs, malformed body, negative tab ID, no pending code, cleanup, toolbar trigger | Pass on unchanged worker using mocked Chrome events | Same trigger behavior with config guard/top-frame targeting added |
| Page extraction/formatting | None | `tests/content-script.test.cjs`: editor primary/fallback, empty code, tags, KaTeX, Unicode, both categories, date | Pass with small DOM fixtures/fake clock and synthetic config | Same bytes/paths for supported inputs; no credentials or GitHub fetch |
| File creation/update | None | Content-script baseline fixture: GET 404→PUT without SHA; GET 200→PUT with SHA; 401/403/409/422/network errors; solution/problem ordering | Pass with fake config and intercepted fetch; no live writes | Equivalent worker tests; intentional sanitized errors and stop-on-first-failure |
| Missing config and storage isolation | None; new behavior | Worker tests for absent record and failed/delayed `setAccessLevel` | New requirements may fail before implementation; keep distinct from characterization | Zero GitHub requests until configured and storage restriction resolves |
| Options and token lifecycle | None; new behavior | `tests/options.test.cjs` plus worker security cases and live Chrome | New requirements fail before implementation | Form never receives stored token; restart/save/test/clear behave as specified |
| PIN-assisted encrypted vault | None; new behavior | `tests/vault.test.cjs` plus actual Chrome/provider PRF verification | New requirements fail before implementation; feasibility not established | Ciphertext persists; PIN unlocks after browser restart; worker restart preserves unlocked session; lock/clear remove session token |

### Characterization and regression sensitivity

- After approval, create a dependency-free harness using `node:test`, `node:assert/strict`, and `node:vm`; load existing classic scripts into isolated contexts with fake Chrome APIs, fetch, clock, and minimal DOM fixtures. Use synthetic tokens only; never load local `config.js`.
- First run preserving-behavior characterization tests against the unchanged production scripts. Record exact commands and results in this plan.
- Demonstrate sensitivity in an isolated in-memory copy: remove SHA propagation and separately misroute a captured tab; the respective assertions must fail for the intended reason, then pass when restored. Do not leave mutations in production files.
- Add new-feature tests separately; record their expected failures before implementation. Do not describe new security requirements as working baseline behavior.
- If fixtures expose pre-existing behavior gaps, record them, preserve unrelated behavior, and distinguish intentional changes below. Do not mark an unavailable baseline as passed.

### Gate result

- [x] Available baseline syntax/patch checks executed; starting state recorded.
- [x] Required behavior mapped to coverage gaps.
- [x] Missing characterization tests pass before production changes.
- [x] Regression sensitivity demonstrated and restoration confirmed.
- [ ] Baseline failures and intentional behavior changes accounted for.

Gate status: Passed — 20 pre-migration characterization tests passed, including isolated wrong-tab and missing-SHA mutation sensitivity followed by passing restoration. HTTP/SHA coverage migrated to worker tests; exact extraction/front-matter output remains covered. See verification evidence.

## Implementation plan

### Batch 0 — Prove PIN/PRF feasibility before production changes

This is a required gate, not a claim that all Windows Hello or Google Password Manager configurations work. During approved execution, use synthetic secrets in a separate disposable extension fixture; no real token, production wiring, backend, helper installation or broad host permissions.

1. Use Chrome's extension-owned relying party: omit `rp.id` / `rpId` to accept the extension-specific default, and keep extension identity stable between setup and unlock. Chromium explicitly supports this; no publisher domain or additional host permission is required. Confirm the effective RP-ID hash in actual authenticator data before production validation code is finalized. [Chromium WebAuthn origin rules](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/webauth/origins.md).
2. In a normal extension tab, demonstrate create/get with PRF and `userVerification: 'required'` using an actual PIN-capable authenticator. Check PRF results rather than just browser WebAuthn support. If create produces no PRF output, test a following get ceremony before rejecting setup.
3. Encrypt a synthetic sentinel, close/restart Chrome, derive the same key after PIN approval, and decrypt it. Verify no key/plaintext persists locally, cancellation returns no key, and ordinary worker restarts retain a trusted session token.
4. Record Chrome/Windows/provider versions, RP configuration and actual PIN prompt behavior here. The browser/provider chooses verification UI; do not promise that the extension can force Windows PIN instead of other OS methods.
5. If PRF or the valid RP configuration cannot meet these requirements, stop this feature and report the precise unsupported prerequisite. No plaintext or custom-PIN fallback. Resolve the design and obtain approval for any changed architecture before production work.

Gate status: Passed for the user-tested Windows Hello PIN / Chrome 157 ARM64 environment: fixture enrollment and restart decryption succeeded. The extension-owned RP requires no extra domain/host permission; production validation uses the serialized extension-origin hash. Exact Windows version was not supplied. Production live checks remain separate.

### Batch 1 — Establish regression evidence

| File / symbol | Responsibility / proposed change | Existing pattern to reuse |
| --- | --- | --- |
| New `tests/helpers/extension-harness.cjs`, `event`, `loadScript`, `backgroundFixture`, `contentFixture`; `tests/helpers/worker-harness.cjs`, `workerFixture` | Isolated VM contexts, mocked event listeners/storage/messages/fetch, synthetic DOM, captured logs; helpers return handles for assertions. | Classic script execution; native Node test runner, no runtime package. |
| New `tests/background.test.cjs` | Capture/message characterization; worker storage/security/GitHub cases live in `tests/worker.test.cjs`. | `pendingCodeByTab` and current webRequest callbacks. |
| New `tests/content-script.test.cjs` | Existing extraction/Markdown/upload characterization, then credential-free message integration. | Existing functions and selectors; exact output fixtures. |
| New `tests/options.test.cjs` | New settings form behavior and secret-handling assertions. | DOM event listeners and runtime messages planned below. |
| New `tests/vault.test.cjs`, `tests/fixtures/pin-vault/` | Native Web Crypto round-trip/tamper tests plus an isolated Chrome feasibility fixture with synthetic data. Separate mocked UI coverage from actual authenticator evidence. | `node:test`, `node:crypto` Web Crypto and extension APIs; no runtime library. |

- [x] Add only missing baseline characterization cases, run `node --test tests/background.test.cjs tests/content-script.test.cjs`, and satisfy the pre-test gate before moving production behavior.
- [x] Record the two isolated sensitivity runs and passing restoration. Freeze expected formatting/path behavior; migrate ownership assertions rather than preserving the insecure credential location.
- [x] Add failing cases for the new settings/security contracts to their owning test files before their implementation. Review boundary: the baseline evidence is independently reviewable; no credentials or live network access are needed.

### Batch 2 — Move settings, credentials, and GitHub requests into the worker

| File / symbol | Responsibility / proposed change | Existing pattern to reuse |
| --- | --- | --- |
| `background.js`, new `SETTINGS_KEY = 'githubSettingsV2'`, `SESSION_KEY = 'githubVaultSessionV1'`, `GITHUB_API_ORIGIN = 'https://api.github.com'`, `GITHUB_API_VERSION = '2022-11-28'` | Separate encrypted durable record and unlocked memory record; retain existing GitHub API version. | Existing API URL/version from content script. |
| `background.js`, new `storageReady` | Top-level promise restricts local and session storage to trusted contexts. Register listeners synchronously, await inside handlers, and never globally cache token/key. | Existing service-worker entry point. |
| `background.js`, new `isOptionsSender(sender)`, `isProblemSender(sender)` | Require `sender.id === chrome.runtime.id`. Settings operations require sender URL equal to `chrome.runtime.getURL('options.html')`, not a NeetCode content script. Uploads require a real tab, `frameId === 0`, HTTPS `neetcode.io` and `/problems/` path. Validate parsed URLs, not substring matches. | Chrome MessageSender metadata, not fields supplied inside the message. |
| `background.js`, new `getSettingsSummary()`, `saveSettings(input, unlockProof, sender, revision, expectedVersion)`, `clearSettings()`, `getUnlockedSettings()`, `lockVault()` | Summary includes only public fields, `hasToken`, `isUnlocked`. Blank-token metadata edits preserve ciphertext; new/replacement token requires fresh setup/unlock proof and worker encryption. Clear removes local/session records; lock removes session only. GitHub operations require matching session vault ID. | Current config field meanings; new locked state. |
| `background.js`, new `validateSettings(input)`, `validateUploadPayload(payload)` | Validate fields independently of whether ciphertext can be unlocked; require a session token before actual use. Exact data contract below. | Existing repo/title/category/language behavior. |
| `background.js`, new `handleMessage(message, sender)`, runtime listener | Dispatch only the named operations below; callback listener returns literal `true` for handled async requests and sends one response. | Existing Chrome runtime messaging. |
| New `vault-crypto.js`, `deriveVaultKey(prfOutput, keySalt)`, `encryptToken(token, prfOutput, metadata)`, `decryptToken(vault, prfOutput)` | Worker-only bundled classic script loaded with `importScripts`. Implement HKDF-SHA-256 → AES-256-GCM; no runtime dependencies; algorithm/metadata contract below. | Native Web Crypto. |
| `background.js`, new `beginVaultCeremony(mode, sender, revision)`, `completeVaultUnlock(proof, sender)`, `pendingCeremonies` | Issue short-lived challenge bound to trusted Options document, mode and settings revision; validate/consume once. No generic key retrieval or credential export. | New security boundary; see ceremony contract below. |
| `background.js`, new `githubRequest(settings, endpointPath, init, operationContext)`, `testGitHubConnection(input)` | Construct API URLs internally, set Authorization/Accept/API-version headers; 15-second timeout per request, `redirect: 'error'`, no automatic write retries. Test GET `/user`, then GET `/repos/{owner}/{repo}`. | Existing fetch/Authorization pattern, now worker-only. |
| `background.js`, moved `findExistingFile(settings, pathName, operationContext)`, `uploadToGitHub(settings, pathName, dataToAdd, operationContext)` | Preserve absent-file 404, SHA handling, committer identity, and 200/201 success; never send raw bodies/errors to clients. Rename `addToGithub` to worker `upsertGitHubFile(settings, file, context)`; remove unused `owner/repo/path: 'PATH'` body fields. | Existing Contents GET/PUT flow. |
| `background.js`, new `uploadProblem(payload, revision, uploadTicket, sender)`, `encodeUtf8Base64(content)`, `publicError(error)` | Worker constructs allowed paths and commit message, encodes contents without unbounded argument spread, uploads solution then problem. Stop after first failure; return partial saved-file metadata. | Existing path, UTF-8/Base64, and commit conventions. |
| `background.js`, new `settingsRevision`, `activeRequests`, `operationQueue`, `invalidatePendingWork()` | Serialize upload/settings mutations. Save/clear/lock invalidate jobs and ceremonies and abort active requests; recheck revision/unlocked state before each network request. In-flight commits may already have completed. | New lifecycle protection; no durable job queue or automatic replay. |
| `background.js`, existing request/action handlers; new `chrome.runtime.onInstalled` | Preserve capture/release logic; target frame 0. Open options for install, unconfigured toolbar click or locked toolbar click. Never prompt from an automatic submission; return safe locked feedback. | Existing pending capture and messages. |

#### Settings record and validation

Persist under `SETTINGS_KEY`: `{ schemaVersion: 2, username, repoName, committerName, committerEmail, vault, sessionGeneration, recordGeneration }`. The `vault` record is `{ version: 1, vaultId, rpId, credentialId, prfSalt, keySalt, iv, ciphertext }`, with binary fields base64url encoded. There is no plaintext `token` property. Map old conceptual names `repo_name`, `committer_name`, `committer_email` to camelCase; no automatic file import. Public summary contains public fields plus `hasToken`, `isUnlocked` and public `recordGeneration`; omit ciphertext, keys, PRF output and token.

Session record under `SESSION_KEY`: `{ vaultId, sessionGeneration, token }`, restricted to trusted contexts. Do not persist decryption keys even in the session record. Session token must match the current durable vault ID and public random sessionGeneration. Lock rotates the durable generation before deleting session data, invalidating stale tokens across worker restarts even if session deletion fails. Every successful Save removes the unlocked session and finishes locked, including first setup, token replacement and public-field edits. Only explicit COMPLETE_VAULT_UNLOCK may cache the token in session storage; Unlock with PIN must be enabled immediately after Save. A failed clear/lock is not success; block authenticated work until cleanup succeeds.

#### Encryption and PIN ceremony contract

- `vaultId`: fresh random 16 bytes per new/replacement token. `prfSalt` and `keySalt`: independent random 32-byte values; AES-GCM `iv`: fresh random 12 bytes for every encryption, 128-bit authentication tag. Never reuse an IV/key pair.
- Derive a non-extractable AES-256 key with HKDF-SHA-256 from the 32-byte PRF output using stored `keySalt` and UTF-8 info `NeetcodeTrackingExtension:vault:v1`. AES-GCM additional data is UTF-8 JSON of the ordered tuple `[1, vaultId, rpId, credentialId, prfSalt, keySalt]`. Reject malformed lengths/unknown versions; tampering or wrong credentials must fail authentication. Encrypt UTF-8 token only. No PIN-based derivation or hardcoded encryption keys.
- `BEGIN_VAULT_SETUP` / `BEGIN_VAULT_UNLOCK` return `{ ceremonyId, challenge, rpId, credentialId?, prfSalt, userId? }` to Options only. Random challenge is 32 bytes; pending ceremony expires after 120 seconds, binds sender document identity, mode, vault and settings revision, and is single use. Worker restart may invalidate a pending prompt safely; retrying is allowed.
- Options calls `navigator.credentials.create` / `get` from a normal visible tab, with `userVerification: 'required'`, PRF input `prfSalt` and the validated RP configuration from Batch 0. First setup must prove that the same credential can reproduce PRF output in a following get before persisting a token.
- `unlockProof`: `{ ceremonyId, credentialId, clientDataJSON, authenticatorData, prfOutput }`, binary fields base64url encoded. Worker validates origin/challenge/type, expected RP-ID hash and user-verification flag, credential ID and pending ceremony bindings before using PRF output. Setup's completing proof is a get assertion, not the create attestation. AES-GCM authentication validates the persisted decryption key; this local vault is not a server authentication service. Sender checks remain mandatory; proof fields from an arbitrary caller are not trusted attestations.
- `SAVE_SETTINGS` with a new token consumes a setup proof (first save) or fresh unlock proof (replacement). First setup has no ciphertext yet, so its successful get output must match the enrollment output within the trusted Options flow; cover loss/replacement/cancellation in real Chrome evidence. A metadata-only Save with blank token preserves the existing vault unchanged. `COMPLETE_VAULT_UNLOCK` decrypts existing ciphertext and sets session token, then returns summary only.
- Release Options references to token/PRF bytes promptly; release worker key/output references after crypto. JavaScript cannot guarantee memory zeroization. No raw secrets/proofs in logs, storage events, errors, content messages or persistent artifacts. The worker never receives or asks for the OS PIN itself.

- Require nonempty strings; trim surrounding whitespace. Owner is a single GitHub user/organization identifier, 1–39 ASCII alphanumerics/hyphens, no leading/trailing hyphen. Repository is 1–100 ASCII alphanumerics/`.`/`_`/`-`, excluding `.` and `..`; reject URLs, slashes, backslashes, control characters, and a pasted `.git` suffix with a useful hint. Encode each URL path segment.
- Committer name: 1–200 characters, no control characters; email: at most 254 characters, one `@` with nonempty parts and no whitespace/control characters. No overstrict provider/domain allowlist.
- Token: nonempty ASCII non-whitespace value, at most 1,024 characters; reject control/header-injection characters without assuming a token prefix. Blank means reuse the existing vault; Test/upload require it unlocked. Do not trim/alter internal whitespace to make it pass. Metadata-only Save need not decrypt an unchanged vault.
- Upload: `{ category, title, date, files }`, at most two distinct files. `category` must equal one of the two current categories. `title` is the existing normalized slug, 1–200 characters, rejecting `/`, `\\`, control characters, `.` and `..`. `date` must be a real UTC calendar date in `YYYY-MM-DD` form. Each file is `{ kind: 'solution' | 'problem', extension, content }`; require exactly one `problem`/`md`, and at most one solution with `py|java|cpp|c|js`. Combined raw UTF-8 content must not exceed 1 MiB; reject larger messages clearly. Do not accept caller-supplied URL, owner, repo, path, headers, SHA, committer, or token.

Public form concurrency: each Save creates a fresh `recordGeneration`; Options passes its observed version as `expectedVersion`. Stale Saves fail before writing. On focus, pristine fields refresh; dirty conflicting forms discard token input and require Reload settings. Existing v2 records without recordGeneration retain their vault through a sessionGeneration compatibility default.

Trigger concurrency: worker issues a two-minute, single-use upload ticket only while unlocked. Bind it to tab, vault ID, session generation and worker revision. Lock/Save/Clear invalidate tickets. Locked automatic triggers send `SAVE_BLOCKED` without DOM extraction.

#### Message contract

| Type | Allowed sender / request fields | Response on success |
| --- | --- | --- |
| `GET_SETTINGS` | Options page; no payload | `{ ok: true, settings: <public summary or null> }` |
| `BEGIN_VAULT_SETUP` | Options page; no payload; reject if existing vault unless explicitly resetting | `{ ok: true, ceremony: <setup challenge/options> }` |
| `BEGIN_VAULT_UNLOCK` | Options page; no payload | `{ ok: true, ceremony: <existing-vault challenge/options> }` |
| `COMPLETE_VAULT_UNLOCK` | Same Options document; `unlockProof` for pending unlock | `{ ok: true, settings: <public summary> }` |
| `LOCK_VAULT` | Options page; no payload | `{ ok: true, settings: <locked public summary> }` |
| `SAVE_SETTINGS` | Options page; five form fields, `expectedVersion` from summary and `unlockProof` for new/replacement token | `{ ok: true, settings: <public summary> }` |
| `TEST_CONNECTION` | Options page; current form values; blank token resolves from unlocked session only; a typed candidate may be tested transiently without saving | `{ ok: true, message: 'Authentication and repository access verified. Write permission is not verified.' }` |
| `CLEAR_SETTINGS` | Options page; no payload | `{ ok: true }` |
| `UPLOAD_PROBLEM` | Authorized top-frame NeetCode content script; `payload` plus a single-use worker-issued `uploadTicket` bound to tab/vault/session/revision | `{ ok: true, updated: <any file updated>, files: [{ kind, status, updated }] }` |
| `OPEN_SETTINGS` | Authorized top-frame NeetCode content script; no payload | `{ ok: true }` after `runtime.openOptionsPage()` |

Failure envelope: `{ ok: false, error: { code, message }, files?: <already saved file statuses> }`. Codes: `UNAUTHORIZED`, `INVALID_SETTINGS`, `INVALID_UPLOAD`, `NOT_CONFIGURED`, `VAULT_LOCKED`, `PRF_UNSUPPORTED`, `UNLOCK_CANCELLED`, `INVALID_UNLOCK_PROOF`, `VAULT_DECRYPT_FAILED`, `STORAGE_UNAVAILABLE`, `AUTH_FAILED`, `ACCESS_DENIED`, `REPO_NOT_FOUND`, `CONFLICT`, `GITHUB_VALIDATION`, `RATE_LIMITED`, `NETWORK_ERROR`, `TIMEOUT`, `SETTINGS_CHANGED`, `GITHUB_ERROR`. Fixed safe messages only; never echo exception text, server bodies, headers, request objects, proofs or settings. GET-file 404 is an internal absent-file result; repository-test 404 means missing or inaccessible. Unknown types have no side effects. Browser prompt exceptions map to safe cancellation/unsupported feedback, not leaked exception dumps.

- [x] Implement worker operations against the failing storage/sender/API tests; keep existing trigger tests passing. Assert storage is restricted before first credential persistence/use and failure results in zero GitHub calls.
- [x] Run `node --test tests/vault.test.cjs`: native Web Crypto round trip; fresh IV per encryption; wrong PRF output, altered ciphertext/IV/metadata, invalid versions/lengths and expired/replayed/cross-document proofs fail safely. Inspect every local-storage write for absence of token/key/PIN.
- [x] Test lock, clear, worker restart, browser-session loss, failed session write and credential replacement. Assert locked calls make no GitHub requests and old pending proofs cannot restore a cleared/replaced session.
- [x] Assert fake-token sentinels never occur in serialized responses, logs, returned exceptions, or content-script-bound messages. Test forged senders, nested frames, traversal, arbitrary endpoint fields, redirects, timeouts, and malformed stored records.
- [x] Test GET 404/create, GET 200/SHA/update, Unicode, sequential files, failure/partial success, queue ordering, worker reload, and clear/save while a request is pending. Assert no later request uses the invalidated credential and no cleared queued job writes.
- [x] Review boundary: all privileged operations and their failure behavior pass mocked tests; no real credentials or repository writes required.

### Batch 3 — Add settings UI and connect the credential-free content script

| File / symbol | Responsibility / proposed change | Existing pattern to reuse |
| --- | --- | --- |
| New `options.html`, `#settings-form`, `#github-username`, `#github-repository`, `#github-token`, `#committer-name`, `#committer-email`, `#save-settings`, `#test-connection`, `#clear-settings`, `#confirm-clear`, `#cancel-clear`, `#settings-status`, `#unlock-vault`, `#lock-vault`, `#vault-status` | Labeled form, password-type token input, inline clear confirmation, accessible status and locked/unlocked state. No PIN input, token reveal/export, remote scripts or automatic authenticator prompt. | Native form plus worker validation. |
| New `options.js`, `loadSettings()`, `readFormSettings()`, `handleSave(event)`, `handleTest()`, `handleClear()`, `handleUnlock()`, `handleLock()`, `enrollVaultCredential()`, `requestVaultProof(ceremony)`, `renderSettingsSummary(settings)`, `setBusy(isBusy)`, `showStatus(message, isError)` | Own user-initiated WebAuthn create/get and transient serialization; all storage/crypto/token recovery/GitHub calls remain in worker. Clear transient token/PRF data after successful handoff and on clear/exit; reject stale results after lock/clear/navigation. | Chrome runtime messaging and WebAuthn after Batch 0. |
| New `options.css` | Scoped, responsive form layout and visible focus/error/status styling; system fonts, no remote assets. | No existing settings UI to preserve. |
| `content-script.js`, `addContentToGitHub`, new `buildUploadPayload(code, questionTitle, questionContent, language)` | Preserve Markdown/front matter/date/category preparation, build optional solution + required problem descriptors, send a single `UPLOAD_PROBLEM`. This function is now orchestration, not authenticated networking. | Current enrichedMarkdown and title normalization. |
| `content-script.js`, remove `findExistingFile`, `uploadToGitHub`, `addToGithub`, `dataToAdd`, `dataToFind`, all `config.github` reads | Content script no longer owns credentials, storage access, API URLs, request headers, file SHA, or Base64 encoding. | Logic moved to worker in Batch 2. |
| `content-script.js`, `processAndUpload`, `conentAdded` → `uploadResult`, `showToast`, runtime listener | Consume `{ ok, updated, error }`; on `NOT_CONFIGURED` / `VAULT_LOCKED`, offer Open settings via `OPEN_SETTINGS`. No direct PIN prompts or automatic replay. Remove raw message/code/Markdown/API logs. | Existing toasts and trigger handling. |
| `manifest.json`, `options_ui`, `minimum_chrome_version`, `content_scripts`, `web_accessible_resources`, permissions | Options in a tab; minimum Chrome at least `122` for extension WebAuthn and raised to the actual tested PRF floor after Batch 0. Inject only `content-script.js`, top frame only; remove config resources. Keep needed hosts/permissions; add only a demonstrated publisher-controlled RP host if required, never broad HTTPS access. Keep scripting for automatic toolbar receiver recovery on NeetCode; remove unused cloudfunctions access. Retain release version until packaging. | Existing Manifest V3; Batch 0 defines RP/version values before this edit. |

- [x] Write failing UI tests for blank-first-run form, restoring `hasToken`, blank-token reuse, safe errors, pending states, confirmation cancellation, successful clear, and stale responses. Add content-script tests proving no credential lookup or GitHub fetch.
- [x] Implement form/message integration and explicit user-initiated Unlock/Lock. Guidance: 'Your token is encrypted on this device. Unlock with a compatible passkey PIN after restarting Chrome. Keep access to that passkey; clearing settings does not revoke the GitHub token.' Explain that prompt appearance is controlled by the provider and storage is unlocked for the current browser session.
- [x] Test PIN cancellation, missing PRF, lost credential, corrupted vault, replaced credential, concurrent tabs, lock/clear during prompts and blocked automatic uploads. Verify no plaintext fallback or fake PIN form.
- [x] Update the manifest only once replacement wiring works; check JSON validity and all referenced local resources. Do not add comments to JSON.
- [ ] Run all automated tests; inspect a clean install and restart in Chrome, including top-frame-only behavior. Review boundary: end-to-end settings and existing saves work without any `config.js` present.

### Batch 4 — Document migration and verify distribution boundary

| File / symbol | Responsibility / proposed change | Existing pattern to reuse |
| --- | --- | --- |
| `README.md`, Installation, File Structure, How It Works, Usage, Troubleshooting, Security Notes | Replace config setup with settings/enrollment/PIN unlock. Explain provider requirements, encrypted local vs unlocked session state, Lock/Clear, lost-passkey reset and separate GitHub revocation. Preserve test limitation/worker ownership; fix conflicting usage text. No invented store URL. | Existing user README. |
| `docs/README.md`, this plan | Update status/evidence, code locations and deferred items after approved implementation. | This is the single scope register. |
| New `tests/manifest.test.cjs` | Assert manifest paths exist, no config dependency/web-accessible secrets, expected permissions/options entry/top-frame configuration; inspect source for worker-only API/credential ownership. | Native Node file/JSON APIs. |
| Local `config.js`, `.gitignore`, `icon.png`, `LICENSE` | No edits. Keep local secrets out of Git and distribution. | Existing ignore rule and assets. |

- [x] Update user documentation and run the verification checkpoint below. JavaScript comments should reflect the new ownership; do not restore comments in README/.gitignore.
- [x] After implementation approval, prepare a temporary clean directory from an explicit allowlist: `manifest.json`, `background.js`, `vault-crypto.js`, `content-script.js`, `options.html`, `options.js`, `options.css`, `icon.png`, `LICENSE`. Exclude feasibility fixtures and all secret/config/env files; never zip the working directory or rely on ignore rules. No publication/upload is authorized.
- [ ] Inspect the staged file list, load that directory in Chrome, and demonstrate no config/env dependency. Real API write verification uses only a user-designated disposable repository/problem; until supplied, mark live writes pending rather than selecting the user's configured repository.
- [ ] Record final evidence/limitations and present the result for review. Any later commit, release version bump, package upload, or publication follows the user's separate direction.

## Verification plan

No existing development guide applies; these are the exact proposed commands and prerequisites. Node 24 is available locally. Browser checks require Chrome with the staged extension loaded and synthetic/mock data first. Never capture token input/Authorization headers in screenshots, logs, or evidence artifacts.

| Check | Script / invocation | What it proves | Environment / evidence | Status |
| --- | --- | --- | --- | --- |
| Baseline syntax | `node --check background.js`; `node --check content-script.js` | Existing scripts parse | Planning baseline, Node v24.22.3 | Pass, 2026-11-23 |
| Baseline patch hygiene | `git diff --check` | Existing tracked changes have no whitespace errors | Planning baseline | Pass, 2026-11-23 |
| PIN/PRF feasibility gate | Batch 0 synthetic extension fixture; record actual Chrome/Windows/provider/RP setup, create→get→encrypt→restart→PIN→decrypt | Actual PIN-capable PRF path; no live token/backend/helper; no claim of universal Windows Hello support | Real Chrome; mock tests cannot pass this gate | Pass: user-confirmed fixture enrollment/restart decrypt, Chrome 157 ARM64 Windows Hello PIN |
| Characterization gate | `node --test tests/background.test.cjs tests/content-script.test.cjs` before production changes | Specified existing extraction/network behavior; isolated mutation sensitivity recorded separately | Fake config, DOM, Chrome, fetch only | Implemented; automated checks passed; see verification evidence |
| Focused security/UI | `node --test tests/background.test.cjs tests/options.test.cjs` | Sender restrictions, storage ordering, redaction, non-writing connection test, lifecycle and form behavior | Synthetic token sentinel; assert logs/messages never contain it | Implemented; automated checks passed; see verification evidence |
| Vault crypto/regression | `node --test tests/vault.test.cjs` | Encryption/tamper handling, fresh IV, no persistent secrets and proof binding | Native Web Crypto plus synthetic proofs; not hardware evidence | Implemented; automated checks passed; see verification evidence |
| Integration checkpoint | `node --test tests/background.test.cjs tests/content-script.test.cjs tests/options.test.cjs tests/vault.test.cjs tests/manifest.test.cjs` | All scoped automated acceptance scenarios | Mocked APIs; not proof of Chrome/PRF enforcement | Implemented; automated checks passed; see verification evidence |
| New script syntax/manifest | `node --check background.js`; `node --check vault-crypto.js`; `node --check content-script.js`; `node --check options.js`; `node -e "JSON.parse(require('node:fs').readFileSync('manifest.json','utf8'))"`; `git diff --check` | Script/JSON syntax and patch hygiene | After final source changes | Implemented; automated checks passed; see verification evidence |
| Residual credential references | `rg -n 'config\.github|Authorization|api\.github\.com|storage\.(local|session|sync)' background.js vault-crypto.js content-script.js options.js manifest.json` | Inspect worker-only GitHub/storage ownership; crypto helper performs no persistence; manifest host expected | Static review, not an absence-of-bugs guarantee | Implemented; automated checks passed; see verification evidence |
| Clean installation/update | Stage allowlist; install, enroll synthetic token, restart browser, unlock using PIN, restart worker, manually lock/unlock | No token reentry; ciphertext survives; browser restart locks; worker restart does not; form stays blank | Real Chrome/provider; no PIN/token screenshots | Production Save user-confirmed; full restart/clean-stage checks pending |
| Actual access isolation | In content-script context attempt local `githubSettingsV2` and session `githubVaultSessionV1` reads before/after worker restart, with a fake token | Both storage areas denied to content scripts; public summary has only `hasToken` / `isUnlocked` and non-secret settings | Record denial/status only, never storage contents | Pending actual Chrome enforcement check; automated boundaries pass |
| Vault failure/recovery | Cancel PIN; unsupported PRF; wrong/lost credential; corrupt ciphertext; clear or lock during pending proof; session write fails | Locked state and existing ciphertext preserved where appropriate; no fallback/replay; explicit recovery guidance | Synthetic secrets, real prompt where applicable | Automated cases pass; live browser cases pending |
| Manual/automatic saves | Use a designated disposable repo: toolbar save, submit then observed sync completion, repeat update, blank-code problem save | Files/Markdown match expected output, correct worker-origin requests and safe toasts | Live Chrome/GitHub; no target chosen yet | Pending; controlled target needed |
| Failure/lifecycle browser checks | Wrong/expired token, inaccessible repo, offline test, clear during delayed request, worker restart, iframe page | Safe feedback, no post-clear follow-up requests, no duplicate frame uploads | Controlled data; no network-body screenshots | Automated cases pass; live browser cases pending |
| Distribution inspection | Enumerate staged allowlist and load it in Chrome; inspect Git diff | No config/env/credentials/unrelated changes distributed; all needed resources exist | Local staging only; no Web Store submission | Nine-file allowlist staged and inspected; clean-stage browser load pending |

## Approved and pending decisions

| Decision | Status | Rationale / evidence | Owner / blocking effect |
| --- | --- | --- | --- |
| Five fields; Save/Test/Clear; first-install settings; remove config dependency | Required | Installed-extension configuration without source edits | Implemented; final live checks pending |
| Background-only GitHub requests; encrypted local storage; memory-only unlocked token | Required | Keep secrets out of content scripts and plaintext disk storage | Restrict both storage areas before use |
| PIN-assisted passkey PRF unlock | Required | Unlock after restart without reentering the GitHub token | PIN path confirmed in compatibility fixture |
| AES-GCM local vault + PRF + session cache | Proposed implementation | Encrypted persistence and one manual unlock per browser session | Implemented; compatibility fixture passed |
| Extension-owned RP | Implemented | Default RP is isolated to the extension origin; worker checks its SHA-256 | Actual provider flow confirmed by compatibility fixture |
| Authenticator/provider and minimum Chrome version | Verified fixture baseline | Windows Hello PIN, Chrome 157.0.8103.80 ARM64; minimum set to 157 | Production live verification pending; no universal PIN compatibility claim |
| Blank token preserves ciphertext; no decrypted token retrieval/reveal/export | Proposed implementation | Metadata edits preserve vault; Test/upload require unlocked session | Included in plan approval |
| Read-only connection test using authenticated user + repo metadata | Proposed implementation | Public repository GET alone is insufficient authentication evidence; successful reads cannot prove Contents write/branch policy permission | Included in plan approval |
| Top-frame-only injection/messages; bounded uploads; stop after first write failure; sanitize errors/logs | Proposed intentional behavior changes | Prevent duplicate frame actions, constrain privileged operations, avoid misleading partial-success reports | Included in plan approval; characterize old behavior first |
| No import/deletion of legacy file; runtime-only allowlist staging | Proposed migration | Prevent copying a developer secret into a distribution | Local secret remains user's responsibility; explain replacement/revocation without inspecting it |
| Minimum Chrome at least 122; narrow RP permission only if needed; current GitHub API version retained | Proposed implementation | Extension WebAuthn requires newer baseline than storage alone | Record final tested minimum and RP config in Batch 0 before manifest edits |
| Execution | Implemented; verifying | Automated tests and batch fixes pass | Complete remaining production live checks |

## Implementation notes for agents

- Read this contract and baseline first, then `manifest.json`, worker triggers, content-script upload functions, and README. Treat existing header-only edits as work to preserve.
- Use the writing-plans workflow for this planning artifact; after approval use the applicable execution, testing, and verification skills. Use the computer-use skill if controlling live Chrome. No special GitHub connector, secret file read, or OAuth setup is needed for mocked tests.
- The worker owns storage, vault encryption/decryption, sender authorization, URL/path building, headers and GitHub requests. Options owns the form plus visible WebAuthn ceremonies and transient PRF handoff; content script owns DOM extraction/formatting only. `vault-crypto.js` is loaded only by the worker.
- Never collect, derive keys from, store or log an OS PIN. Never interpret a plain WebAuthn signature as a decryption key. Browser user verification is not a promise of one exact PIN dialog; Batch 0 must demonstrate the supported PIN path.
- Treat PRF outputs and unlock proofs as secrets. Lock/clear invalidate pending ceremonies and uploads; a late successful prompt must never resurrect a cleared token. `getUnlockedSettings()` compares session vault ID before every authenticated job.
- Do not copy Chrome's example storage-change logger: change objects can contain tokens. Do not log runtime messages/settings, user code, request bodies, or GitHub error bodies. Use fixed safe status codes/messages.
- A compromised content script can still request the narrowly allowed problem saves; sender validation cannot establish that NeetCode page content is honest. Restrict destinations and scope rather than claiming complete compromise resistance.
- Register worker listeners at evaluation time; await `storageReady` inside handlers. Use callback `sendResponse` + literal `true` for asynchronous responses rather than requiring newer promise-listener support.
- In-memory pending capture and jobs may be lost when Chrome terminates the worker, as pending capture can be today. Do not persist code/token-bearing jobs or replay writes automatically. Bound requests; surface a failed/interrupted message to the caller for a deliberate retry.
- Do not introduce unrelated DOM observer timeouts or broad refactors. Record newly discovered prerequisite failures before expanding scope.

### Deferred work tracking

This repo has no existing deferred-marker convention. Use the stable IDs here as the authoritative register; add a code comment only if an approved implementation leaves a relevant limitation at that boundary. Do not treat deferral as completion of an in-scope requirement.

| ID | Owning boundary | Rationale / next action | Exit condition | Status |
| --- | --- | --- | --- | --- |
| SETTINGS-D01 | `manifest.json` / release docs | Web Store listing, privacy disclosures, policy review, release version and submission are a later publication task. | Separate release work is reviewed and explicitly authorized. | Deferred |
| SETTINGS-D03 | `background.js` automatic trigger | Automatic capture depends on NeetCode's own sync completion and service-worker memory. | Separately approved trigger/lifecycle redesign with new regression evidence. | Deferred |
| SETTINGS-D04 | `content-script.js` language mapping | Existing C# `.c` mapping is preserved to keep migration bounded. | Separate language-correction change is requested and verified. | Deferred |

## Results and handoff

- Deliverables: settings page, PIN-assisted encrypted vault, trusted session lifecycle, worker-only GitHub requests, credential-free extraction, manifest migration, tests and user documentation implemented.
- Verification: 90 automated tests, script syntax and patch hygiene pass. Fixture PIN enrollment/restart decryption, production encrypted Save and connection test confirmed by the user. Independent batch/final reviews completed and findings fixed with regression tests. Settings layout previewed; clean nine-file runtime allowlist staged and inspected. Live toolbar saving after unlock displayed success. Automatic page-script recovery now avoids requiring users to refresh existing NeetCode tabs; navigation checks and one-time save delivery prevent saving the wrong page or replaying uploads. Recovery is regression-tested; the new recovery path still needs live Chrome verification. See linked verification evidence for batch reviews and live-check limits.
- Remaining work: production restart/storage-isolation checks, live automatic page-script recovery after extension reload, and automatic GitHub save/update verification. Production connection test and toolbar success were confirmed; no credentials were read from legacy config.
- Integration: focused local commits on the feature branch; merge and store publication pending.

Final status: Verifying — implementation complete; remaining live checks require user interaction.
