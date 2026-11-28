# NeetCode Tracking 2.0

Save your NeetCode solutions and problem descriptions to your own GitHub repository, directly from Chrome.

Version **2.0.0** adds an extension settings page, encrypted GitHub token storage, and PIN-assisted unlock. Set up your connection in the browser—no configuration files or source edits required.

## Features

- **One-click saves:** save the current solution and formatted problem description from a NeetCode problem page.
- **GitHub updates:** save all changed files together in one commit on your repository's default branch.
- **Problem notes:** include topic tags, a UTC creation date, and a Notes section in each problem's Markdown file.
- **Protected credentials:** encrypt your token on this device and unlock it with a compatible passkey provider, including supported Windows Hello PIN setups.
- **Automatic reconnection:** reconnect already-open NeetCode tabs after extension updates without refreshing the page or losing editor contents.

## Requirements

- **Google Chrome 157 or newer.**
- **A compatible passkey provider** supporting WebAuthn PRF and user verification. Windows Hello PIN has been verified on Chrome 157 for Windows ARM64. Compatibility with other providers and platforms has not been verified.
- **A GitHub repository with at least one commit** (for example, an initial README) and a fine-grained personal access token restricted to that repository, with **Contents: Read and write** permission.

## Installation

### From source

1. Download this repository and extract it, or clone it.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Select **Load unpacked** and choose the project folder containing `manifest.json`.
4. The settings page opens automatically on first installation.

You can reopen settings at any time: right-click the extension icon and select **Options**, or use **Extension options** on its Details page in `chrome://extensions`.

When updating an unpacked installation, keep the project in the same folder and select **Reload** in `chrome://extensions`. Unlock again afterward; already-open NeetCode problem tabs reconnect on a toolbar click or the next successful automatic-save trigger.

## Connect your GitHub repository

1. Create or choose a repository for your solutions. Initialize a new repository with a README or another commit before saving problems.
2. Open [GitHub's fine-grained token settings](https://github.com/settings/personal-access-tokens) and create a token. Select only your intended repository, grant **Contents: Read and write**, and choose an expiration. Organization repositories may require approval.
3. Enter the following in the extension's settings:

   | Field | What to enter |
   | --- | --- |
   | GitHub username or organization | The repository owner |
   | Repository name | The name only, without a URL or `.git` suffix |
   | GitHub personal access token | Your fine-grained token |
   | Committer name and email | The identity recorded in Git commits; a GitHub noreply email is supported |

4. Select **Save settings** and complete the browser's passkey setup prompts. Enter your PIN only in the browser or passkey provider's prompt, never in the extension's form.
5. Select **Unlock with PIN**, then **Test connection** to verify authentication and repository access.

**Test connection** does not create a commit or verify write permission. Saving files also depends on your token's Contents permission and the repository's branch rules.

### Editing settings

Leave the token field blank to keep your saved token when changing other fields. Unlocking never displays the saved token in the form. Enter a new token only when replacing it.

Every successful **Save settings** locks the vault, including changes to your name, email, or repository. Select **Unlock with PIN** before saving problems again.

## Save a problem

1. Open a problem on [NeetCode](https://neetcode.io/) and write your solution.
2. Click the extension's toolbar icon.
3. Wait for **Saved via click**, **Updated via click**, or **Already saved, nothing to update.** on the page.

Toolbar saves read the complete Monaco editor model and its language together, preserving lines and indentation regardless of scrolling. The reader selects the single visible, editable editor and excludes read-only output panels. Later changes to the language selector do not relabel captured code. If the editor cannot be read unambiguously, the save stops with an error instead of uploading partial code. An empty editor saves the problem description only. Files are organized like this:

```text
Data Structures & Algorithms/    # or System Design/
└── two-sum/
    ├── solution.py
    └── problem.md
```

Supported language mappings are Python (`.py`), JavaScript (`.js`), TypeScript (`.ts`), Java (`.java`), C++ (`.cpp`), C (`.c`), C# (`.cs`), Go (`.go`), Rust (`.rs`), Kotlin (`.kt`), Swift (`.swift`), Ruby (`.rb`), PHP (`.php`), Scala (`.scala`), Dart (`.dart`), Racket (`.rkt`), Elixir (`.ex`), Erlang (`.erl`), F# (`.fs`), R (`.r`), Perl (`.pl`), Haskell (`.hs`), Lua (`.lua`), Bash/Shell (`.sh`), and SQL (`.sql`). Labels are case-insensitive and trimmed. An unrecognized language with nonempty code stops the save without writing files.

Saves with changes create blobs, a tree based on the current branch snapshot, and one commit through GitHub's Git Data API. A single non-forced ref update publishes all changed files together. If the branch changes concurrently, the save fails safely; retry to use the latest snapshot. Commit messages distinguish additions from updates. If the resulting tree is unchanged, no commit or branch update is created. Description-only saves also report **Already saved, nothing to update.** when `problem.md` already exists.

The first save creates `problem.md`, including HTTP(S) image references for problem diagrams and their alternative text. Later saves update the solution and leave the existing Markdown file untouched, preserving your Notes, tags, creation date, and description. Delete `problem.md` in your repository if you want the next save to regenerate it, including diagrams omitted by earlier versions.

Folder names are Windows-safe slugs: repeated dashes collapse and characters such as `:` and `?` are removed, so `Two Sum II - Input Array Is Sorted` saves to `two-sum-ii-input-array-is-sorted`. Earlier versions named that folder `two-sum-ii---input-array-is-sorted`. If a folder with the earlier name already contains `problem.md` and no new-style folder exists, saves keep using the earlier folder so its notes stay together. Rename the folder yourself if you prefer the new name.

Category detection uses an explicit `system-design` URL path segment or a same-origin System Design route linked from a breadcrumb. Other problems use `Data Structures & Algorithms`; navigation, footer, and description text do not determine the category. Existing files saved under an incorrect category or extension are not moved automatically.

### Automatic saves

Automatic capture runs only after NeetCode's submitted-code GitHub commit operation (`commitToGitHub`) completes with a successful HTTP status (2xx). Status polling, settings requests and historical-submission syncs do not trigger it. Failed commit responses discard the captured submission. This requires NeetCode's built-in GitHub integration to be configured; running or submitting code alone does not guarantee this trigger. The toolbar save works independently of that integration. Both paths reconnect missing page receivers without refreshing the editor; only readiness probes are retried, never a delivered save.

Each sync request keeps the code and language captured when that request starts. A later run does not replace an in-flight submission, and an older sync completion does not replace a newer successful sync. Automatic saves use the recorded request language rather than the current selector. If that language is missing, no files are saved; use the toolbar to capture the current editor instead. In-flight sync associations expire after two minutes and are discarded on request errors, navigation, or settings/lock changes.

Automatic captures can follow NeetCode's submission-results transition between Question and Submissions for the same problem, including a numeric `submissionIndex` change. Other query parameters and the fragment must remain unchanged, and the commit request must match the captured problem ID and code. Switching problems or loading a new document cancels the capture. Upload tickets are invalidated on every URL change and newly issued tickets and delivery remain bound to the exact current URL. A stale automatic message rejected by the page shows a retry toast. The [automatic-save investigation](docs/verification/2026-11-27-automatic-trigger.md) records live evidence and remaining checks.

## Unlocking and security

Read the [privacy policy](PRIVACY.md) for the data the extension handles, where it is sent, and how to remove it. Files and commit details are public when saved to a public repository.

Your token stays encrypted on this device between browser sessions. After restarting Chrome, reloading the extension, or installing an update, choose **Unlock with PIN** in Options. You do not need to enter the token again. The browser or passkey provider controls verification and may offer biometrics as well as a PIN.

- **Lock** removes the unlocked session while keeping the encrypted token.
- **Clear settings** removes the saved connection and encrypted token. It does not revoke the token on GitHub or delete the passkey from its provider.
- If you lose your passkey, clear settings and configure a replacement token and passkey. The extension cannot recover the old encrypted token.
- If you suspect a token was exposed, revoke it in GitHub's settings.

The token is encrypted with AES-256-GCM using a key derived from the passkey's PRF output. GitHub requests run in the background worker; NeetCode content scripts receive neither the token nor its encryption key. Local storage holds the encrypted vault and public connection settings. While unlocked, the plaintext token is held in trusted extension session memory. This does not protect against malware or compromised extension code accessing an unlocked browser.

Connection settings are stored locally, not synced across devices. The extension sends your solution, problem description, and commit identity to your configured GitHub repository when saving. It has no application backend.

### Extension permissions

| Permission or access | Purpose |
| --- | --- |
| `scripting` | Reconnect the page script on already-open NeetCode tabs and read the complete Monaco editor model for toolbar saves |
| `storage` | Store connection settings, the encrypted token, and the unlocked session |
| `webRequest` | Observe NeetCode submission and GitHub-sync events for automatic capture, and document navigations to cancel stale captures |
| `neetcode.io` | Extract the problem description and solution |
| `api.github.com` | Authenticate and save files to your repository |

Toolbar saves and page-script recovery use the declared `neetcode.io` host access together with `scripting`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| The vault is locked | Open Options, choose **Unlock with PIN**, return to the problem, and click the extension again. Interrupted saves are not replayed. |
| Passkey PRF is unsupported | Use a compatible provider. The extension does not fall back to plaintext token storage. |
| A PIN prompt was cancelled or timed out | Retry from Options and keep the settings tab visible while completing the prompt. |
| The extension cannot connect to the page | Check Chrome's site-access setting for the extension on `neetcode.io`, then retry. Recovery errors appear at the top of Options. |
| GitHub rejects a save | Check token expiration, repository selection, Contents write permission, organization approval, committer details, and branch rules. |
| A save cannot be confirmed | Check your repository before retrying. If the final confirmation was lost, the complete save may already be committed. |
| The repository changed during this save | Retry to save against the latest branch snapshot. The extension never forces a branch update. |
| GitHub rejected the branch update | Retry once. If it repeats, check the default branch's protection rules and rulesets; they must allow direct pushes from your token. |
| Initialize the GitHub repository | Add a README or another initial commit, then retry. Atomic saves require an existing branch. |
| Automatic capture does not run | Check NeetCode's built-in GitHub integration, or use the toolbar save. |
| Could not read the complete editor code | Wait for the editor to finish loading, then retry. No files are saved if the editor is unavailable or ambiguous. |
| Problem details did not load | Wait for the problem page to finish loading, then retry. Missing optional topic tags do not prevent saving. |

### Editor error codes

Manual-save failures start with a bracketed code, for example `[EDITOR_API_UNAVAILABLE]`. Include that code, the problem URL, selected language, and Chrome version when reporting a bug. Never include your token, PIN, or private solution.

| Code | Meaning |
| --- | --- |
| `EDITOR_API_UNAVAILABLE` | A supported Monaco editor API could not be found. |
| `EDITOR_DISCOVERY_FAILED` | The page's editor integration could not be identified safely. |
| `EDITOR_NOT_FOUND` | No visible, editable editor was found. |
| `EDITOR_AMBIGUOUS` | Multiple editor APIs or visible, editable editors could be selected. |
| `EDITOR_MODEL_UNAVAILABLE` | The selected model is missing or disposed. |
| `EDITOR_SNAPSHOT_INVALID` | The page reader returned invalid code or language data. |
| `EDITOR_TOO_LARGE` | The code exceeds the one-MiB limit. |
| `EDITOR_READ_FAILED` | An editor API call failed; its raw error is not displayed. |
| `EDITOR_INJECTION_FAILED` | Chrome could not execute the reader in the page. |
| `EDITOR_READ_TIMEOUT` | The page read exceeded five seconds. |
| `EDITOR_MESSAGE_FAILED` | The page script could not communicate with the worker. |
| `EDITOR_RESPONSE_INVALID` | The worker response was missing, malformed, or carried an unrecognized code. |

Other fixed codes, such as `PAGE_CHANGED`, `SETTINGS_CHANGED`, `STORAGE_UNAVAILABLE`, or `UNAUTHORIZED`, identify route, settings, storage, or sender checks instead. A code narrows the failing stage; it does not establish the underlying browser cause on its own.

When NeetCode does not expose Monaco globally, the reader inspects its already-loaded Webpack modules for a supported editor API. It uses export capabilities rather than build-specific module numbers, with bounded discovery and ambiguity checks. Future NeetCode changes may require an extension update; unsupported integrations stop the save safely. This discovery does not download scripts or receive credentials.

### Upgrading from a configuration-file version

Configure your connection in Options. Version 2.0 does not read `config.js` or `.env` files. Consider replacing a token used with an older version that exposed `config.js` to web pages. Keep old credential files out of source control and release packages.

An unpacked installation and a future Chrome Web Store installation may have different extension identities. Settings and passkeys do not automatically transfer between them.

## Development

The extension has no build step or runtime dependencies. Prettier and ESLint are development-only dependencies used for formatting and linting. With Node.js 22.13 or newer, run:

```powershell
npm install          # once, to install Prettier and ESLint
npm run check        # format check, lint, and the test suite
```

Individual scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Runs the Node test suite (`node --test "tests/*.test.cjs"`) |
| `npm run lint` / `npm run lint:fix` | Lints with ESLint (`eslint.config.mjs`); `lint:fix` applies safe fixes |
| `npm run format` / `npm run format:check` | Formats with Prettier (`.prettierrc.json`) or checks formatting without writing |
| `npm run release` | Creates the versioned release ZIP in `dist/` using Windows PowerShell |

Prettier uses a 100-character line width, 4-space indentation, and single quotes. Markdown files are excluded so documentation tables keep their hand-written layout. Run `npm run format` before committing.

Syntax-only checks still work without installing anything:

```powershell
node --check background.js
node --check vault-crypto.js
node --check content-script.js
node --check options.js
git diff --check
```

See the [documentation index](docs/README.md) for implementation and verification details. Compatibility fixtures under `tests/fixtures/` are separate test extensions and do not configure the main extension.

For distribution, include only `manifest.json`, `background.js`, `vault-crypto.js`, `content-script.js`, `options.html`, `options.js`, `options.css`, `icon.png`, and `LICENSE`. Do not package the entire working directory or include credential files.

To create the release ZIP on Windows, run:

```powershell
npm run check
npm run release
```

The script reads the version from `manifest.json` and creates `dist/neetcode-tracking-2.0.0.zip` for version 2.0.0. `manifest.json` and the other allowlisted files sit directly at the archive root, ready for Chrome Web Store upload. No tests, documentation, dependencies or local configuration are included. A successful rebuild replaces the ZIP for the same version; a packaging failure preserves the previous ZIP. Packaging does not publish or upload anything.

You can also run the script directly from the project root with `powershell.exe -NoProfile -File .\scripts\package-release.ps1`. Windows PowerShell 5.1 is sufficient; no additional packaging dependencies are required. Release-packaging tests run on Windows and are skipped on other operating systems.

## License

[MIT](LICENSE).
