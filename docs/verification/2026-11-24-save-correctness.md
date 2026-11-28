# Save-correctness verification follow-up

Date: November 24, 2026.
Status: Automated checks passed. The live Chrome/NeetCode/GitHub checks below are **pending user testing**. No new production browser test or repository inspection was performed for this follow-up.

## Automated evidence

`npm run format`, followed by `npm run check`: **125 passed, 0 failed**. The check includes Prettier validation, ESLint and the Node test suite. `git diff --check` passed.

- Identical solution saves stop when the resulting tree equals the base tree, before commit creation or ref publication. The synthetic repository derives tree hashes from contents, so saving the same code twice exercises equality rather than relying on fixed hashes. Missing Markdown still creates a commit even when the solution is unchanged.
- Both identical-tree and skipped description-only saves return an explicit unchanged result. Toolbar and automatic saves show `Already saved, nothing to update.`.
- Automatic triggers now share toolbar readiness probing and packaged isolated-script recovery. Regressions cover reconnecting once, navigation during recovery, one-time delivery and ambiguous acknowledgements without replay.
- A stale automatic message rejected by the content script shows a fixed retry toast. A regression covers a query-only URL change. Captures discarded earlier by navigation invalidation may never reach that receiver, so the toast is not a guarantee for every cancellation.
- Generated Markdown excludes the selected problem heading, including a heading nested inside the article, and preserves other headings. An integration fixture with an actual article `h1` verifies the title appears once. No local `problem.md` was present to inspect; whether the live site currently places its title inside the article remains unverified. Existing repository Markdown is preserved on repeat saves.

These tests use synthetic code, repository contents, credentials and browser boundaries. They do not establish real Chrome permission enforcement, site DOM/model availability or live submission event ordering.

## Pending live checks

November 27 update: the user reports passing file accuracy, manual repeat/update saves, production restart/unlock and editor-panel checks. A real automatic-create save is verified in [ae08ce4](https://github.com/Mazharul-Hossain/neetcode-submissions-r8yxpmr9/commit/ae08ce4bd754aa49726414e01804813b89892dbf). The [automatic-trigger follow-up](2026-11-27-automatic-trigger.md) records the submission URL/loading failure, document-binding fix and evidence. Composite checklist entries below remain unchecked where additional scenarios are still unverified.

Record the extension commit, Chrome/OS versions, pass/fail and observations when testing. Keep all entries pending until actually exercised. Use a disposable initialized repository and synthetic solutions; do not put a token, PIN, private solution or storage contents in evidence.

- [ ] **Automatic create and update:** unlock the production extension and configure NeetCode's own GitHub integration. Trigger a successful sync on a new test problem. Verify one extension commit contains both solution and Markdown. Change the solution and sync again; verify one update commit and preserved Notes/creation date. Separate NeetCode's own integration commits from extension commits when counting. Repeat unchanged code and then toolbar-save it; verify no additional extension commit and the already-saved toast.
- [ ] **Chrome restart and unlock:** fully quit Chrome, restart it, and verify the production vault retains its encrypted settings but requires PIN-assisted unlock. Unlock without re-entering the token and verify a save. The earlier Windows Hello compatibility-fixture restart result is separate evidence.
- [ ] **Page and content-script storage isolation:** in both the page JavaScript context and the extension's isolated content-script context, confirm the page cannot read the extension's credential storage and isolated-context local/session storage requests are denied. Repeat after worker restart. Record only access-denied/pass/fail, never returned values or unlock material. Mocked `TRUSTED_CONTEXTS` calls do not prove Chrome enforcement.
- [ ] **Open-tab reconnection after extension reload:** leave an edited NeetCode problem open, reload the extension, unlock, and trigger an automatic sync without refreshing the problem page or clicking the toolbar first. Verify successful automatic capture and retained editor contents. Reload/unlock again and independently verify toolbar recovery. Confirm each action is delivered once.
- [ ] **Submission URL transitions:** inspect the tab URL before execution/submission, when results appear, at GitHub-sync completion and when the save arrives. Check pathname, query string and fragment changes, including switching to a results tab. Also note loading events. Any `tabs.onUpdated` URL change or loading event clears pending capture/tickets; content/ticket checks require exact URLs. Verify whether a real submission therefore loses its automatic save, and whether a cancellation toast appears. This remains a live compatibility question, not a passed check or a reason to relax cross-problem binding without evidence.
- [ ] **Real Markdown title and complete editor capture:** inspect newly generated Markdown for one title heading. Save a long synthetic Python solution after scrolling; verify the entire file and indentation, including off-screen lines. Existing Markdown is not regenerated automatically, so use a new test problem or remove only disposable test Markdown before this check.
- [ ] **Slash-containing default branch:** optionally test an initialized disposable repository whose default branch is `solutions/practice`. Verify both ref lookup and publication. The code uses the documented `heads/solutions/practice` form from GitHub's [reference documentation](https://docs.github.com/en/rest/git/refs#get-a-reference), encoding each branch segment separately; synthetic tests cover that form. No authenticated live ref update was attempted.
- [ ] **System Design category:** toolbar-save an actual System Design problem and verify it lands in `System Design/`. Detection only uses a `system-design` URL segment or breadcrumb link; record the problem URL if it falls back to `Data Structures & Algorithms`.
- [ ] **Editor selection after a toolbar click:** clicking the toolbar can move focus away from the editor. Save with the solution, output and console panes open and closed; verify the full solution is saved rather than `Could not read the complete editor code`.
- [ ] **Language labels:** record the exact labels NeetCode's language selector shows (for example `Python` versus `Python 3`) and verify each language you use saves with the expected extension.
- [ ] **Folders from earlier versions:** in a disposable repository, create `Data Structures & Algorithms/<old-style-folder>/problem.md` for a title containing ` - ` or `:`, then save that problem. Verify the commit updates the old folder and creates no new-style folder.

## Date policy

Creation dates and commit-message dates remain UTC. Near the end of the day in New York they can display the following calendar date; this is the existing documented policy. A switch to local dates is a separate preference change and was not included in these correctness fixes.

The date preference and slash-containing branch question are tracked in the [follow-up tracker](../follow-ups.md).
