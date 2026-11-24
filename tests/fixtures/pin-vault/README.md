# PIN/PRF compatibility fixture

Batch 0 only. No GitHub requests, real tokens, broad host permissions, backend or desktop helper.
This test creates a disposable passkey and stores an encrypted, fixed synthetic message.

1. In Chrome, open `chrome://extensions`, enable Developer mode if necessary, and choose Load unpacked.
2. Select the `tests/fixtures/pin-vault` folder inside this project.
3. Confirm the installed extension is named **NeetCode PIN feasibility test**. If it is named
   **NeetCode Tracking 2.0**, the main project was loaded instead; load the fixture folder from step 2.
   Click Chrome's Extensions puzzle-piece button and click **NeetCode PIN feasibility test** to open
   its test page in a normal tab. After changing fixture files, first click its Reload button on
   `chrome://extensions`. Its Details page also provides **Extension options**.
4. Choose **Enroll and encrypt test data**. Complete the passkey creation and verification prompts yourself,
   choosing a provider with a usable PIN path. Never share your PIN or enter a GitHub token in this fixture.
5. If enrollment passes, fully exit Chrome, restart it, click the fixture through the Extensions button again,
   and choose **Unlock and verify**.
6. Report the status text, Chrome/Windows versions, provider, and whether an actual PIN was used.

The API requests user verification; it cannot force a provider to display PIN rather than biometrics.
A normal passkey assertion is insufficient: the provider must return PRF output.
If unsupported, stop; this fixture never falls back to plaintext storage or a custom PIN.

The RP fields are omitted to use Chrome's extension-specific default. Chromium documents this at
[Origins that support WebAuthn](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/webauth/origins.md).
No separate domain or host permission is used. Keep the fixture directory in place between enrollment and unlock,
because unpacked extension identity can depend on its path. Production will need a stable extension identity.

Remove the fixture from Chrome when testing is finished. Remove its test passkey separately in your provider
if desired; uninstalling the extension does not remove the provider's passkey. This fixture is not shipped
with the production extension and does not satisfy the production sender/proof/session-isolation tests.
