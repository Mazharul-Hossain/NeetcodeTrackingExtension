# Monaco editor adapter verification

Date: November 27, 2026.

## Change

NeetCode's editor API is not available through `window.monaco` on the observed page. The toolbar reader now discovers supported Monaco exports in the page's existing Webpack runtime without hardcoding a module number. Discovery limits queues, inspected factories, and candidate modules. It excludes unrelated factories, deduplicates API aliases, skips export-shaped helpers without an editor API, and removes its temporary queue entry.

The reader requires one visible, connected, editable editor. Read-only output panels are excluded. Ambiguous or unsupported integrations return fixed error codes without saving. Credentials remain in the background worker; no permissions or runtime dependencies were added.

## Automated verification

The adapter tests serialize the actual reader into an isolated page context. Synthetic fixtures cover changed module numbers, unrelated factories, API aliases, helper exports, multiple APIs/editors, read-only and hidden panels, empty solutions, unsupported runtimes, bounded discovery, and complete multiline Unicode code capture.

`npm run format` and `npm run check` passed: formatting, ESLint and all 158 tests. Independent review found no blocking correctness or security issues; the targeted editor tests also passed (16 tests).

## Real Chrome verification

The installed extension was reloaded and its actual background `getEditorCode` path invoked against the open page:

`https://neetcode.io/problems/non-cyclical-number/question`

This exercised Chrome's `scripting.executeScript` MAIN-world injection and the packaged reader, rather than a substitute console implementation. The result was successful: Python, 21 lines, 463 characters. Only this metadata was printed; solution text and credentials were not logged. The editor was not changed or refreshed.

The live check also exposed a helper module with a matching export signature but no editor API. A regression test and fix were added before the successful repeat.

## Remaining live checks

- Repeat a complete toolbar save to GitHub after unlocking the reloaded extension. This verification did not upload files or exercise PIN prompts.
- Verify long, scrolled editor contents and resulting Markdown in a real GitHub save. Complete long-code capture is covered synthetically, but the live sample was 21 lines.
- The broader pending browser checks in [Save-correctness follow-up](2026-11-24-save-correctness.md) remain pending unless separately recorded there.

Subsequent user-confirmed manual checks and the verified automatic GitHub save are recorded in the [automatic-trigger follow-up](2026-11-27-automatic-trigger.md). The checks above describe the original reader-only verification.

## Problem title follow-up

The subsequent “Problem details did not load” failure was reproduced on the same page. The description container had no heading, while the page contained many modal headings. The old unique-page-heading fallback therefore returned no title even though the problem was loaded.

The title lookup now uses the description's owning `.question-tab` and requires exactly one `h1.problem-title`. Missing or duplicate panel titles still stop the save. A regression test covers unrelated modal headings and missing/duplicate panel titles. Formatting, lint and all 159 tests passed.

A read-only probe in real Chrome confirmed the corrected lookup finds exactly one title, `Non-Cyclical Number`, alongside a nonempty description (1,683 trimmed text characters). This was a DOM lookup check; a complete GitHub upload was not performed. Reload the extension to load the changed content script before retrying a save.
