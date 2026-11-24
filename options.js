/*
 * NeetcodeTrackingExtension/ -> options.js (options.html)
 * |-- form: Save/Test/Clear and safe public settings summaries
 * `-- passkey ceremonies: user-initiated enrollment/PIN unlock and transient PRF handoff
 * Purpose: configure the extension without source edits; worker owns storage/crypto/API.
 * Agent skills: WebAuthn PRF, browser forms and Chrome messaging; never collect OS PINs.
 */
'use strict';
const fieldIds = {
    username: 'github-username',
    repoName: 'github-repository',
    token: 'github-token',
    committerName: 'committer-name',
    committerEmail: 'committer-email',
};
const element = id => document.getElementById(id);
let currentSummary = null;
let fieldSnapshot = null;
let formStale = false;
let uiRevision = 0;
let busy = false;
let promptController = null;

function pack(value) {
    return btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join(''))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
}

function unpack(value) {
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c =>
        c.charCodeAt(0),
    );
}

async function send(message) {
    let result;
    try {
        result = await chrome.runtime.sendMessage(message);
    } catch {
        throw {
            code: 'UNAVAILABLE',
            message: 'Could not reach the extension. Reload it and reopen settings.',
        };
    }
    if (!result?.ok) {
        throw (
            result?.error || {
                code: 'UNAVAILABLE',
                message: 'The extension could not complete this action.',
            }
        );
    }
    return result;
}

function showStatus(message, isError = false) {
    const target = element('settings-status');
    target.textContent = message;
    target.setAttribute?.('data-error', String(isError));
}

function renderSettingsSummary(settings, restoreFields = true) {
    const changed = settings?.recordGeneration !== currentSummary?.recordGeneration;
    if (!restoreFields && changed && hasDirtyFields()) {
        // Vault state may refresh, but edited fields must keep their original save version.
        currentSummary = {
            ...currentSummary,
            hasToken: settings?.hasToken,
            isUnlocked: settings?.isUnlocked,
        };
        markFormStale();
    } else {
        restoreFields ||= changed;
        currentSummary = settings;
    }
    if (restoreFields) {
        for (const [key, id] of Object.entries(fieldIds)) {
            element(id).value = key === 'token' ? '' : settings?.[key] || '';
        }
        fieldSnapshot = readFormSettings();
        formStale = false;
        element('refresh-settings').hidden = true;
    }
    element('vault-status').textContent = !settings?.hasToken
        ? 'Not configured. Save a token to set up PIN-assisted protection.'
        : settings.isUnlocked
          ? 'Unlocked for this browser session.'
          : 'Locked. Unlock with your passkey PIN to save problems.';
    element('github-token').required = !settings?.hasToken;
    setBusy(busy);
    return !formStale;
}

function setBusy(value) {
    busy = value;
    for (const id of ['save-settings', 'test-connection']) {
        element(id).disabled = value || formStale;
    }
    element('unlock-vault').disabled =
        value || !currentSummary?.hasToken || currentSummary.isUnlocked;
    element('lock-vault').disabled = !currentSummary?.hasToken && !value;
}

function readFormSettings() {
    return Object.fromEntries(
        Object.entries(fieldIds).map(([key, id]) => [key, element(id).value]),
    );
}

function hasDirtyFields() {
    const fields = readFormSettings();
    return Boolean(
        fieldSnapshot && Object.keys(fields).some(key => fields[key] !== fieldSnapshot[key]),
    );
}

function markFormStale() {
    formStale = true;
    element('github-token').value = '';
    element('refresh-settings').hidden = false;
    setBusy(busy);
    showStatus(
        'Settings changed in another tab. Reload settings before saving; unsaved token input was discarded.',
        true,
    );
}

function assertCurrent(revision) {
    if (revision !== uiRevision) throw { code: 'STALE' };
}

function cancelUiOperation() {
    uiRevision++;
    promptController?.abort();
    promptController = null;
    setBusy(false);
}

function uiError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
        return 'PIN/passkey prompt cancelled or timed out. Your saved vault was preserved.';
    }
    if (error?.code === 'PRF_UNSUPPORTED') {
        return 'This passkey provider did not return the required PRF encryption result. Use a compatible provider; no token was saved.';
    }
    if (error?.name === 'SecurityError') {
        return 'Chrome rejected this passkey setup. Reopen settings and check that the extension identity has not changed.';
    }
    // Only worker-generated fixed messages may be displayed; never dump native errors.
    return error?.code && typeof error.message === 'string'
        ? error.message
        : 'Could not complete this action. Your existing encrypted vault was preserved.';
}

async function runUi(operation) {
    if (busy) return;
    const revision = ++uiRevision;
    promptController = new AbortController();
    const signal = promptController.signal;
    setBusy(true);
    showStatus('Working… Complete any browser passkey prompts yourself.');
    try {
        await operation(revision, signal);
    } catch (error) {
        if (revision === uiRevision && error?.code !== 'STALE') {
            if (error?.code === 'SETTINGS_CHANGED') markFormStale();
            else showStatus(uiError(error), true);
        }
    } finally {
        if (revision === uiRevision) {
            promptController = null;
            setBusy(false);
        }
    }
}

function prfOutput(credential) {
    const output = credential?.getClientExtensionResults().prf?.results?.first;
    if (!output || output.byteLength !== 32) throw { code: 'PRF_UNSUPPORTED' };
    return pack(output);
}

async function requestVaultProof(ceremony, signal, credentialId = ceremony.credentialId) {
    if (signal.aborted) throw { code: 'STALE' };
    const credential = await navigator.credentials.get({
        signal,
        publicKey: {
            challenge: unpack(ceremony.challenge),
            allowCredentials: [{ type: 'public-key', id: unpack(credentialId) }],
            userVerification: 'required',
            timeout: 120000,
            extensions: { prf: { eval: { first: unpack(ceremony.prfSalt) } } },
        },
    });
    if (signal.aborted) throw { code: 'STALE' };
    if (!credential || pack(credential.rawId) !== credentialId) throw { code: 'PRF_UNSUPPORTED' };
    const output = prfOutput(credential);
    return {
        ceremonyId: ceremony.ceremonyId,
        credentialId,
        clientDataJSON: pack(credential.response.clientDataJSON),
        authenticatorData: pack(credential.response.authenticatorData),
        prfOutput: output,
    };
}

async function enrollVaultCredential(ceremony, signal) {
    // RP fields are deliberately omitted: Chrome isolates the default to this extension.
    const credential = await navigator.credentials.create({
        signal,
        publicKey: {
            challenge: unpack(ceremony.challenge),
            rp: { name: 'NeetCode Tracking 2.0 token vault' },
            user: {
                id: unpack(ceremony.userId),
                name: 'github-token',
                displayName: 'NeetCode Tracking 2.0 GitHub token',
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },
                { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            attestation: 'none',
            timeout: 120000,
            extensions: { prf: { eval: { first: unpack(ceremony.prfSalt) } } },
        },
    });
    if (signal.aborted) throw { code: 'STALE' };
    if (!credential) throw { code: 'PRF_UNSUPPORTED' };
    const credentialId = pack(credential.rawId);
    let first = credential.getClientExtensionResults().prf?.results?.first;
    if (first?.byteLength === 32) first = pack(first);
    else first = (await requestVaultProof(ceremony, signal, credentialId)).prfOutput;
    const proof = await requestVaultProof(ceremony, signal, credentialId);
    if (first !== proof.prfOutput) throw { code: 'PRF_UNSUPPORTED' };
    return { ...proof, enrollmentPrfOutput: first };
}

async function handleSave(event) {
    event?.preventDefault();
    if (formStale) {
        markFormStale();
        return;
    }
    if (!element('settings-form').reportValidity()) return;
    return runUi(async (revision, signal) => {
        const settings = readFormSettings();
        let proof;
        if (settings.token) {
            const { ceremony } = await send({
                type: currentSummary?.hasToken ? 'BEGIN_VAULT_UNLOCK' : 'BEGIN_VAULT_SETUP',
            });
            assertCurrent(revision);
            proof = currentSummary?.hasToken
                ? await requestVaultProof(ceremony, signal)
                : await enrollVaultCredential(ceremony, signal);
        }
        assertCurrent(revision);
        const result = await send({
            type: 'SAVE_SETTINGS',
            settings,
            unlockProof: proof,
            expectedVersion: currentSummary?.recordGeneration || null,
        });
        assertCurrent(revision);
        element('github-token').value = '';
        renderSettingsSummary(result.settings);
        showStatus(result.message || 'Settings saved. Your token is encrypted on this device.');
    });
}

async function handleTest() {
    if (formStale) {
        markFormStale();
        return;
    }
    if (!element('settings-form').reportValidity()) return;
    return runUi(async revision => {
        const result = await send({ type: 'TEST_CONNECTION', settings: readFormSettings() });
        assertCurrent(revision);
        element('github-token').value = '';
        showStatus(result.message);
    });
}

async function handleUnlock() {
    return runUi(async (revision, signal) => {
        const { ceremony } = await send({ type: 'BEGIN_VAULT_UNLOCK' });
        assertCurrent(revision);
        const proof = await requestVaultProof(ceremony, signal);
        assertCurrent(revision);
        const result = await send({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: proof });
        assertCurrent(revision);
        if (renderSettingsSummary(result.settings, false)) {
            showStatus('Unlocked for this browser session. Return to NeetCode and save again.');
        }
    });
}

async function handleLock() {
    cancelUiOperation();
    return runUi(async revision => {
        const result = await send({ type: 'LOCK_VAULT' });
        assertCurrent(revision);
        element('github-token').value = '';
        if (renderSettingsSummary(result.settings, false)) showStatus('Token locked.');
    });
}

async function handleClear() {
    cancelUiOperation();
    return runUi(async revision => {
        await send({ type: 'CLEAR_SETTINGS' });
        assertCurrent(revision);
        element('clear-confirmation').hidden = true;
        renderSettingsSummary(null);
        showStatus(
            'Local settings cleared. Revoke the token and remove the passkey separately if needed.',
        );
    });
}

async function loadSettings(restoreFields = true) {
    const revision = uiRevision;
    try {
        const result = await send({ type: 'GET_SETTINGS' });
        if (revision === uiRevision && !busy) {
            const changed = result.settings?.recordGeneration !== currentSummary?.recordGeneration;
            if (!restoreFields && changed && hasDirtyFields()) {
                markFormStale();
                return;
            }
            renderSettingsSummary(result.settings, restoreFields || changed);
            if (result.notice) showStatus(result.notice, true);
        }
    } catch (error) {
        if (revision === uiRevision) showStatus(uiError(error), true);
    }
}

element('settings-form').addEventListener('submit', handleSave);
element('test-connection').addEventListener('click', handleTest);
element('unlock-vault').addEventListener('click', handleUnlock);
element('lock-vault').addEventListener('click', handleLock);
element('clear-settings').addEventListener('click', () => {
    element('clear-confirmation').hidden = false;
    element('confirm-clear').focus();
});
element('cancel-clear').addEventListener('click', () => {
    element('clear-confirmation').hidden = true;
});
element('confirm-clear').addEventListener('click', handleClear);
element('refresh-settings').addEventListener('click', () => {
    cancelUiOperation();
    element('github-token').value = '';
    void loadSettings(true);
});
window.addEventListener('focus', () => {
    if (!busy) loadSettings(false);
});
window.addEventListener('pagehide', () => {
    cancelUiOperation();
    element('github-token').value = '';
});
const optionsReady = loadSettings();
