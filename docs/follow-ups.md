# Follow-up tracker

Updated November 24, 2026. Open entries record decisions or verification still needed; they are not confirmed defects unless stated.

| ID | Finding | Status | Next step |
| --- | --- | --- | --- |
| DATE-001 | `created:` and commit-message dates use UTC. Evening saves in New York can therefore have the following calendar date. | Open preference decision; current behavior is documented and unchanged. | Decide whether dates should follow the device's local timezone. If changed, cover both sides of local midnight and UTC midnight in tests and update the README. Preserve existing Markdown creation dates. |
| REF-001 | Slash-containing default branches, such as `solutions/practice`, are encoded as `heads/solutions%2Fpractice`. Synthetic tests accept this form; real GitHub compatibility has not been verified. | Open verification question; no confirmed failure. | Test ref lookup and non-forced publication on an initialized disposable repository with a slash-containing default branch. Record the result in the [browser verification checklist](verification/2026-11-24-save-correctness.md). Change encoding only if evidence warrants it. |

## Resolved feedback issue

Commit `ca0295a` adds a fixed toast when the content script rejects an automatic save because its expected URL differs from the current URL, including query-only changes:

> The page changed before the automatic save arrived. Click the extension again to save this problem.

The regression is in `tests/content-integration.test.cjs`. This covers a message that reaches the content script. A capture discarded earlier by tab navigation can still be cancelled before any message arrives; the [real submission URL-transition check](verification/2026-11-24-save-correctness.md) remains pending.
