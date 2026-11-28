# Project documentation

Latest verification: [Automatic-save trigger and November 28 reviews](verification/2026-11-27-automatic-trigger.md), including a real automatic GitHub save and 173 passing tests after review fixes. The [Monaco editor adapter](verification/2026-11-27-monaco-adapter.md), earlier [five P2 fixes](verification/2026-11-24-p2-fixes.md) and remaining live checks are recorded separately.

| Document | Scope | Status |
| --- | --- | --- |
| [Automatic-save trigger investigation](verification/2026-11-27-automatic-trigger.md) | Status-call filtering, SPA loading events, document binding and local-change reviews | 173 tests passed; earlier live automatic save verified in commit ae08ce4 |
| [Monaco editor adapter](verification/2026-11-27-monaco-adapter.md) | Discover the loaded editor without fixed module IDs; select the visible editable model | Real Chrome reader and subsequent manual-save checks passed |
| [Editor failure diagnostics](verification/2026-11-24-editor-diagnostics.md) | Fixed error codes for editor reads and manual-save reporting | Initial 151 tests passed; subsequent browser investigation identified and fixed the reader failure |
| [Secure extension settings plan](plans/2026-11-23-secure-extension-settings.md) | Settings page, encrypted local token with PIN-assisted passkey unlock, background GitHub requests, migration, and verification | Implemented; automated checks passed; live verification pending |
| [Verification evidence](verification/secure-extension-settings.md) | Test results, batch reviews, compatibility and remaining live checks | 125 automated tests passed; earlier production Save user-confirmed; current live checks pending |
| [Save-correctness follow-up](verification/2026-11-24-save-correctness.md) | No-op saves, automatic reconnection, title deduplication and current browser checklist | Manual checks and automatic create passed; remaining composite live checks are listed |
| [Follow-up tracker](follow-ups.md) | UTC/local date preference, slash-containing branch verification and resolved stale-save feedback | Two open follow-ups; stale-message toast fixed |
| [Security and code review](verification/2026-11-23-security-review.md) | Bugs, vulnerability review, fixes, and Chrome Web Store release gates | Two reproduced bugs fixed and re-reviewed; submission checks remain |

The linked plan is the authoritative active plan for this scope. Installation and usage instructions remain in the [project README](../README.md).
