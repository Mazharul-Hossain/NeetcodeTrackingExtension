# Privacy policy

**NeetCode Tracking 2.0 · Updated November 24, 2026**

NeetCode Tracking saves your NeetCode solutions and problem descriptions to a GitHub repository you choose. It has no application backend, analytics, advertising, or data-sale functionality.

## Information the extension handles

- **Connection settings:** your GitHub repository owner and name, personal access token, and committer name and email.
- **Problem data:** the solution code, problem title and description, topic tags when available, category, and save date.
- **Page context:** the NeetCode problem URL and tab information needed to associate a save with the correct problem. For toolbar saves, a local script reads the full Monaco editor model in the NeetCode page context without receiving credentials. For automatic saves, the extension observes NeetCode submission and GitHub-sync requests and temporarily holds submitted code in memory.
- **Vault information:** an encrypted token, passkey credential identifier, encryption metadata, and temporary unlock material. Your browser or passkey provider handles verification; the extension does not receive or store your PIN or biometric data.

## How information is used and shared

The extension uses this information only to configure your connection, protect and unlock your token, test GitHub access, and save or update problem files in your chosen repository.

Website access is limited to the declared `https://neetcode.io/*` and `https://api.github.com/*` hosts. Toolbar saves use the existing NeetCode host access to read the editor.

Your token is sent to GitHub over HTTPS for authentication. Saving sends solution code, problem descriptions, and commit information to GitHub. **If your repository is public, its saved files and commit details—including the committer name and email—are public.** Use a private repository and a GitHub noreply email if appropriate for your needs.

Saved problem descriptions may reference diagram images hosted by NeetCode or other image hosts. GitHub or your browser may load those images when you view the rendered Markdown. The extension preserves the references; it does not download or execute image content.

The extension does not send this information to a developer-operated server. GitHub handles information it receives under its own policies. Your selected passkey provider handles passkey creation, verification, storage, and any provider-supported synchronization under its own policies. NeetCode's own website and GitHub integration operate separately from this extension.

## Local storage and protection

Connection settings and the encrypted token vault are stored locally using Chrome extension storage. The token is encrypted with AES-256-GCM using a key derived from your passkey's PRF output; the derived encryption key is not saved with the vault.

While unlocked, the plaintext token is kept in trusted extension session storage so saves can work without another verification prompt. Locking removes that unlocked session. Browser restarts and extension reloads or updates also clear the session. NeetCode content scripts do not receive the token or encryption key.

Connection settings and the encrypted vault are not synced by the extension across devices. Solution code is held temporarily for a save rather than persisted as a local job history. The extension does not intentionally log tokens, unlock material, solution code, or GitHub response bodies.

Encryption does not protect an unlocked browser from malware or compromised extension code. Use a repository-restricted token with an expiration, and revoke it on GitHub if you suspect exposure.

## Your choices and deletion

- **Lock** removes the unlocked token session and keeps your encrypted vault and connection settings.
- **Clear settings** removes the connection settings, encrypted token vault, and unlocked session from the extension.
- To invalidate a token, revoke it in GitHub's token settings. Clearing extension settings does not revoke it.
- To remove a passkey, use your browser, operating system, or passkey provider's controls.
- To remove saved files or commit history from GitHub, manage them on GitHub. Clearing extension settings does not delete remote files or existing commits.

## Limited use

The extension's use and transfer of user data is limited to its disclosed purpose of saving NeetCode work to the repository you select, consistent with the Chrome Web Store User Data Policy and Limited Use requirements. It does not use user data for advertising, sell user data, or transfer it for unrelated purposes.

## Questions

Use this project's GitHub Issues page for privacy questions. Do not include tokens, PINs, unlock material, or private repository contents in public reports.
