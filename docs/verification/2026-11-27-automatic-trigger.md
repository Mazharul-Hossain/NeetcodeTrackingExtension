# Automatic-save trigger investigation

Date: November 27, 2026.

## Report and observed evidence

The user reports manual verification checks 1–4 passed: file accuracy, repeat/update saves, Chrome restart/unlock, and editor panel selection. They then report NeetCode's own sync created commit `28f61dd`, without an extension automatic save. The commit itself has not been inspected.

On the open Plus One page, resource timing metadata confirmed HTTP 200 requests to both `/api/executeCodeFunctionHttp` and `/api/githubFunctionHttp`. No request bodies, solution contents or credentials were printed. This metadata does not identify the GitHub operation or establish which capture check failed.

Public NeetCode bundle inspection showed that `githubFunctionHttp` multiplexes `getGitHubStatus`, `getSyncStatus`, settings operations, historical submission syncs, and `commitToGitHub`. The latter receives the submitted problem, code and language. Public source was inspected as text, not executed.

## Confirmed defect and change

The extension consumed a pending submission on any request to that endpoint. A failing regression reproduced a status request triggering an automatic save and consuming the pending capture.

The worker now consumes captures only for POST requests whose decoded operation is `commitToGitHub`. The bounded JSON decoder is shared with execution capture. Other operations and missing, malformed, oversized or unreadable bodies leave the pending capture untouched. Regression tests cover those cases and existing request correlation, navigation, cancellation and ordering behavior.

This fixes a confirmed trigger defect. It is not yet evidence that this defect caused the specific failure associated with `28f61dd`.

`npm run format` followed by `npm run check` passed: formatting, ESLint and all 161 tests.

## Captured failure and submission-route fix

The user's repeat submission was captured with temporary page instrumentation that recorded request metadata and History API route changes only. It logged no code, tokens, PINs or response bodies. The instrumentation was stopped and its original browser methods restored after capture.

The sequence was:

1. Execution POST started on `/problems/plus-one/history?submissionIndex=2`; the body supplied string `problemId`, `rawCode` and `lang` fields.
2. NeetCode replaced the URL with `/problems/plus-one/history?submissionIndex=3`.
3. Two milliseconds later, a `commitToGitHub` POST started with string `problemId`, `code` and `language` fields.
4. Execution and GitHub requests completed with HTTP 200.

The extension's URL-change handler discarded the pending capture at step 2, before the commit request could associate it. This is the directly observed blocker. A read-only DOM probe also confirmed the results route retains a nonempty problem description and exactly one problem-panel title.

The worker now rebinds pending and in-flight automatic captures only across Question/Submissions routes for the same problem, allowing a numeric `submissionIndex` change while preserving all other query parameters and the fragment. The commit operation must also match the captured backend problem ID and code. A rejected binding cannot revive when returning to the original problem. Full document loads still discard captures; all URL changes still revoke existing upload tickets. Fresh tickets and content delivery require the exact resulting page URL.

A failing regression reproduced the observed transition before the fix. Tests cover transitions before and during sync, Question-to-Submissions navigation, unrelated commit bodies, switching problems, other query changes, malformed submission indices, full document loads and leaving/returning. `npm run format` followed by `npm run check` passed: formatting, ESLint and all 165 tests.

## Live verification

### Chrome loading-event follow-up

After the route-only fix, a worker trace confirmed execution capture succeeded but was absent at the subsequent commit request, with no route rebinding. A same-URL `history.replaceState` probe then directly reproduced Chrome emitting `tabs.onUpdated` with `status: loading` and no changed URL, followed by `complete`. Treating every loading event as a document reload was therefore incorrect for this site.

Automatic captures now survive these loading signals. Actual NeetCode `main_frame` requests discard pending work using the existing webRequest permission. Execution and commit requests must share Chrome's document ID and originate from the top frame; recovery injection, delivery and automatic upload tickets are bound to that document. This also protects against a different document loaded from cache, where a network navigation event may be absent. URL transitions still require the previously described same-problem binding, and existing tickets are revoked on loading signals and URL changes.

Chrome documents request document IDs in its [webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest) and document-targeted delivery in its [tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs). No new permission was added. Added regressions cover the observed loading sequence, actual same-URL document navigation, and rejected cross-document commit/ticket use. All 167 tests, formatting and lint passed.

The corrected extension was reloaded; the user unlocked it and submitted again. Repository history was refreshed and inspected in real Chrome. The extension created [ae08ce4](https://github.com/Mazharul-Hossain/neetcode-submissions-r8yxpmr9/commit/ae08ce4bd754aa49726414e01804813b89892dbf), titled `Added plus-one on 2026-11-28`, immediately after NeetCode's own [submission-7 commit](https://github.com/Mazharul-Hossain/neetcode-submissions-r8yxpmr9/commit/f60d67e29e765711f536144f2fa88143ce80b458). Both were displayed at November 27, 2026, 9:19 PM EST. The extension's date label follows its documented UTC policy.

The extension commit contains both `Data Structures & Algorithms/plus-one/problem.md` and `Data Structures & Algorithms/plus-one/solution.py`. This confirms the submitted-code automatic-create path completed in the real browser and repository. The agent inspected file paths and metadata without printing solution contents and did not initiate a submission or GitHub write.

The temporary final trace was absent after the worker restarted, so it does not establish internal event ordering for the successful run. The commit itself is the end-to-end evidence. Temporary diagnostic globals were removed and the separate worker DevTools window was closed afterward. No repository code was changed between the passing 167-test check and this live result.

Automatic update, unchanged-code/no-op saves, and overlapping submissions still need separate live checks. The first live automatic save is now verified; broader items remain in the save-correctness checklist.

## Review of local changes — November 28, 2026

Reviewed the complete tracked and untracked local changes, including the Monaco adapter, fixed error-code handling, problem-title lookup, automatic-save lifecycle, tests and documentation. The earlier changes were evaluated against the captured browser evidence rather than assumed necessary merely because they were already implemented.

| Retained change | Reason |
| --- | --- |
| Bounded Monaco discovery and editable-editor selection | The real page does not expose global Monaco and contains read-only output editors; the production reader was verified in Chrome. |
| Scoped problem-title lookup | The title is outside the description article, and unrelated modal headings make a document-wide heading search ambiguous. |
| GitHub operation filtering | A reproduced regression shows status polling can otherwise consume a submission; this was a real additional defect, rather than the sole cause of the reported failure. |
| Same-problem submission-route rebinding | The captured submission changes its history URL before starting its commit request. |
| Actual document-navigation cancellation and document binding | Chrome emitted loading for a same-document History API call; document identity protects replacement pages without treating that loading signal as a reload. |
| Fixed diagnostic codes | User-requested reporting that does not expose raw browser, network or GitHub errors. |

The review reproduced and corrected two remaining issues:

- A loading-only signal advanced the route generation even though captures were preserved. If Chrome's tab URL lookup was still pending, its original generation check rejected a valid capture. Loading alone now revokes existing tickets without changing the route generation; URL changes and actual document navigations retain their existing checks. This removes the redundant workaround that updated each capture's generation on loading events.
- Rejected route bindings prevented uploads but retained the cancelled solution in pending memory. Rejected captures are now removed, using identity checks so asynchronous cleanup cannot delete a newer submission. Regressions cover both release and the newer-submission race.

The mismatched-commit regression fixture was also corrected to supply valid frame and document metadata, so it tests the problem/code checks rather than passing because metadata was absent. A redundant missing-capture check was removed. No temporary tracing hooks, hardcoded Monaco module IDs, debug logging, runtime dependencies or additional permissions were found in production changes.

`npm run format`, then `npm run check`: formatting, ESLint and all **170 tests passed**. The review fixes have automated verification; the earlier live commit remains evidence for the pre-review production flow and was not repeated for this review.

## Independent final review — November 28, 2026

An independent reviewer found a further delayed-lookup race: an allowed submission URL transition could arrive before the initial `tabs.get` resolved, causing the initial generation guard to discard the capture before rebinding. The original transition tests awaited that lookup and missed this ordering.

The initial lookup now shares a bounded binding record with a request-associated capture. A generation mismatch is accepted only for exactly one observed transition, with the returned URL distinct from the destination and both URLs sharing a valid submission-route key. Destination-only results cannot establish the original problem and remain rejected, as do multiple early transitions, unrelated problems and actual document navigation. This deliberately cancels ambiguous lookups instead of guessing their original problem.

Regression tests cover the original URL, destination URL, unrelated problem and actual navigation before and after sync association, plus multiple unresolved transitions. Formatting, ESLint and all **173 tests passed**. These final timing changes have automated verification; the earlier Chrome commit is still the live evidence for the preceding flow.

The final review and commit group these related capture fixes with their regression tests and verification evidence.
