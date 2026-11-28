# Editor failure diagnostics

Date: November 24, 2026.

Manual-save failures now begin with a fixed diagnostic code, such as `[EDITOR_API_UNAVAILABLE]`. The [README reference](../../README.md#editor-error-codes) explains each code and the information needed for a bug report.

The page reader distinguishes unavailable APIs, missing/ambiguous editors, unavailable models, invalid snapshots, oversized code, and editor API failures. The worker validates page-returned codes against an allowlist and separately identifies injection failures and the five-second timeout. The content script preserves recognized codes and uses fixed fallbacks for messaging failures or malformed responses. Raw page, Chrome, and worker error messages are not displayed.

Verification:

- Failing regression tests were added before implementation for page diagnostics, worker allowlisting, toast prefixes, messaging failures, and invalid responses.
- `npm run format`, followed by `npm run check`: **151 passed, 0 failed**, including Prettier and ESLint.
- Independent review found no actionable issues; 35 targeted editor/integration tests passed independently.
- Successful full/empty editor captures and credential isolation remain covered. No new permissions, message types, or runtime dependencies were added.

No live Chrome test was performed for this initial diagnostic change. The subsequent [Monaco adapter investigation](2026-11-27-monaco-adapter.md) identified and fixed the underlying reader failure, with a successful reader check in real Chrome and user-confirmed manual saves. A code identifies the failing stage; it does not establish the cause on its own. Remaining checks are tracked in the [browser checklist](2026-11-24-save-correctness.md#pending-live-checks).
