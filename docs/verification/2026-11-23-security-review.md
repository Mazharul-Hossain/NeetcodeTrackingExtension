# NeetCode Tracking 2.0 security and code review

Date: November 23, 2026
Version: 2.0.0
Scope: working-tree changes and new runtime/test files against baseline `791d1d76500e2a1b83f608f6d8efac1df50e52f0`.

## Result

Two reproduced runtime bugs were fixed. Independent re-review found no remaining actionable issue in those fixes. The separate vault/security review found no confirmed actionable vulnerability in the reviewed trust, encryption, storage, or network boundaries.

Automated checks pass. Chrome Web Store submission remains gated on the publication and live-browser checks below. This review does not establish compatibility with untested browsers or passkey providers.

## Findings and fixes

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1: data integrity | Automatic capture could send the first problem's code to another problem after navigation during asynchronous ticket issuance. Navigation invalidated existing tickets, but a fresh unbound ticket could be created afterward. | Fixed. Capture resolves Chrome's actual tab URL and records its navigation generation. Both capture resolution and ticket issuance reject navigation. Automatic and manual triggers carry the expected URL; content checks before extraction and after payload construction, and the worker checks the ticket against the sender's route. Backend problem IDs need not match URL slugs. |
| P2: reliability | Missing topic markup or required page elements could leave an acknowledged save waiting forever and retain observers. | Fixed. Missing optional tags produce an empty list. Required-element waits have a ten-second deadline, observer cleanup, and cancellation. The extraction operation has a shared deadline and page-hide cancellation, with a fixed visible error on failure. |
| Release requirement | There was no dedicated privacy policy for the store's privacy-policy field. Public-repository visibility was insufficiently explicit in setup. | Added `PRIVACY.md`, linked it from README, and disclosed GitHub transmission and public-repository visibility in Options. Publish the policy at a publicly accessible URL and supply it in the Chrome Web Store dashboard before submission. |

Each code fix was preceded by a failing reproduction. New regressions cover navigation during capture-URL resolution and storage access, rejection at the worker boundary, backend-ID/URL differences, missing optional tags, required-element timeout feedback, and observer cleanup on cancellation.

## Security and development checks

- Settings and passkey operations require the extension's Options document; problem messages require this extension, the NeetCode origin, and the top frame.
- Content scripts receive no token or encryption key, and cannot select arbitrary GitHub destinations, headers, repositories, or file paths.
- Local and session storage are restricted to trusted contexts. Durable token storage uses authenticated AES-256-GCM, HKDF-SHA-256, random salts and IVs, and authenticated metadata. The derived key and PRF output are not persisted with the vault.
- Unlock requests are document/challenge/origin/credential-bound, expire, require verification flags, and are single use. Existing ciphertext must decrypt successfully. Options is trusted to obtain the PRF output; this is local vault encryption rather than a server-side WebAuthn login service.
- Save, Lock, and Clear invalidate pending work. Session-generation checks protect against stale sessions across worker restarts and partial cleanup failures.
- GitHub requests use a fixed HTTPS origin, bounded payloads, validated paths, redirects disabled, abort/timeout handling through response-body consumption, and fixed public error messages.
- Manifest V3 uses packaged scripts, explicit permissions and two scoped host permissions. No remotely hosted executable code, `eval`, dynamic HTML insertion, or production console logging was found in the reviewed runtime sources. No third-party runtime dependency or build step is present.
- Toolbar recovery probes readiness, injects only the packaged isolated top-frame script, and registers one receiver. It does not refresh the editor or retry an upload with an uncertain outcome.
- Release packaging uses the documented explicit runtime allowlist. Ignored legacy credential files and browser profiles were not read. No real token or PIN was used in automated checks.

## Verification

- `node --test tests/*.test.cjs`: **90 passed, 0 failed**.
- Syntax checks passed for `background.js`, `content-script.js`, `vault-crypto.js`, and `options.js`.
- `git diff --check` passed; Git only reported LF/CRLF normalization notices.
- Independent vault/security reviewer: 54 targeted tests passed; no confirmed actionable finding in its scope.
- Independent runtime reviewer reproduced both bugs, then re-reviewed the fixes and URL-based capture contract; no remaining actionable finding in the final targeted review.

## Required before store submission

1. Publish the privacy policy at an accessible URL, enter it in the developer dashboard, and ensure listing/dashboard data disclosures match actual behavior. Publishing and dashboard submission were not performed in this review.
2. Verify the final extension in live Chrome after reload/update and browser restart: retained encrypted vault, PIN unlock, automatic receiver recovery, and manual and automatic create/update saves. Earlier manual saving and the Windows Hello compatibility fixture succeeded; the latest automatic-route and DOM-timeout fixes have automated evidence only.
3. Confirm local and session storage are inaccessible from a content-script context in live Chrome, including after worker restart. Mocked enforcement and authorization tests are not a substitute for this browser check.
4. Build and inspect the final allowlisted package. Never upload the whole working directory; exclude `config.js`, `.env`, tests, docs, and other local files. Provide the store's required listing assets and permission justifications.

## Known limits

An unlocked token is present in trusted session storage. Malware or compromised trusted extension code can access an unlocked token. Passkey-provider support outside the tested Windows Hello/Chrome configuration is unverified. Automatic capture still depends on NeetCode's own GitHub-sync event and temporary worker memory; interrupted jobs are not persisted or replayed. The inherited C# `.c` mapping and visible-editor fallback remain documented limits.

## References

- [Chrome messaging security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#security-considerations)
- [Chrome extension security guidance](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [Manifest V3 remote-code restrictions](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [User-data privacy requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
