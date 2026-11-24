# Project documentation

| Document | Scope | Status |
| --- | --- | --- |
| [Secure extension settings plan](plans/2026-11-23-secure-extension-settings.md) | Settings page, encrypted local token with PIN-assisted passkey unlock, background GitHub requests, migration, and verification | Implemented; automated checks passed; live verification pending |
| [Verification evidence](verification/secure-extension-settings.md) | Test results, batch reviews, compatibility and remaining live checks | 125 automated tests passed; earlier production Save user-confirmed; current live checks pending |
| [Save-correctness follow-up](verification/2026-11-24-save-correctness.md) | No-op saves, automatic reconnection, title deduplication and current browser checklist | Automated checks passed; all listed live checks pending user testing |
| [Follow-up tracker](follow-ups.md) | UTC/local date preference, slash-containing branch verification and resolved stale-save feedback | Two open follow-ups; stale-message toast fixed |
| [Security and code review](verification/2026-11-23-security-review.md) | Bugs, vulnerability review, fixes, and Chrome Web Store release gates | Two reproduced bugs fixed and re-reviewed; submission checks remain |

The linked plan is the authoritative active plan for this scope. Installation and usage instructions remain in the [project README](../README.md).
