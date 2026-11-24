/*
 * Project tree (root -> file -> responsibilities):
 * NeetcodeTrackingExtension/
 * `-- background.js (Manifest V3 service worker; registered by manifest.json)
 *     |-- settings/vault: trusted storage, PIN proof validation and session lifecycle
 *     |-- GitHub: bounded, serialized Contents API requests and safe results
 *     |-- onBeforeRequest: capture submitted code and problem ID per tab
 *     |-- onCompleted: send CODE_DATA after NeetCode's GitHub request completes
 *     `-- action.onClicked: send MANUAL_TRIGGER to content-script.js
 *
 * Purpose: own encrypted settings, PIN-unlock proofs, trusted session storage,
 * GitHub requests and save triggers. Content scripts only extract page data.
 *
 * Agent skills: no additional Codex skill required. Relevant knowledge: Chrome
 * extension service-worker lifecycle, webRequest events, and tab messaging.
 */

importScripts('vault-crypto.js');

const SETTINGS_KEY = 'githubSettingsV2';
const SESSION_KEY = 'githubVaultSessionV1';
const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
const pendingCodeByTab = {};
const navigationByTab = new Map();
const pendingCeremonies = new Map();
const uploadTickets = new Map();
const activeRequests = new Set();
let settingsRevision = 0;
let operationQueue = Promise.resolve();
let storageBlocked = false;
let lastActionNotice = '';
const storageReady = Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]).then(
    () => true,
    () => false,
);

const ERROR_MESSAGES = {
    UNAUTHORIZED: 'This action is not allowed from this page.',
    INVALID_SETTINGS: 'Check the repository owner, name, token and committer fields.',
    EDITOR_UNAVAILABLE: 'Could not read the complete editor code. No files were saved.',
    INVALID_UPLOAD: 'The problem data or file size is not supported.',
    NOT_CONFIGURED: 'Open extension settings to configure GitHub.',
    VAULT_LOCKED: 'Open settings and unlock with your passkey PIN, then save again.',
    INVALID_UNLOCK_PROOF: 'The unlock request expired or changed. Try unlocking again.',
    VAULT_DECRYPT_FAILED:
        'Could not unlock this vault. Use its original passkey or clear settings to start again.',
    STORAGE_UNAVAILABLE: 'Settings storage is unavailable. Reload the extension and try again.',
    AUTH_FAILED: 'GitHub rejected the token. Check whether it expired or was revoked.',
    ACCESS_DENIED: 'GitHub denied access. Check repository permissions.',
    REPO_NOT_FOUND: 'The repository is missing or inaccessible to this token.',
    CONFLICT: 'The repository changed during this save. Try saving again.',
    GITHUB_VALIDATION: 'GitHub could not accept this file or committer information.',
    RATE_LIMITED: 'GitHub rate limit reached. Wait before trying again.',
    NETWORK_ERROR: 'Could not connect to GitHub. Check your connection.',
    TIMEOUT: 'GitHub did not respond in time. Try again.',
    SETTINGS_CHANGED: 'Settings or lock state changed. Try the action again.',
    PAGE_UNAVAILABLE:
        'Could not connect to the NeetCode page. Check that the extension has access to neetcode.io, then try again. Your code has not been changed.',
    PAGE_CHANGED:
        'The NeetCode page changed before saving. Click the extension again on the problem you want to save.',
    GITHUB_ERROR: 'GitHub could not complete this operation.',
};

function fail(code) {
    throw Object.assign(new Error(ERROR_MESSAGES[code]), { publicCode: code });
}

function publicError(error) {
    const code = Object.hasOwn(ERROR_MESSAGES, error?.publicCode)
        ? error.publicCode
        : 'GITHUB_ERROR';
    return {
        ok: false,
        error: { code, message: ERROR_MESSAGES[code] },
        ...(error?.savedFiles ? { files: error.savedFiles } : {}),
    };
}

function exactKeys(value, allowed) {
    return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).every(key => allowed.includes(key))
    );
}

function isOptionsSender(sender) {
    return (
        sender?.id === chrome.runtime.id &&
        sender.url === chrome.runtime.getURL('options.html') &&
        typeof sender.documentId === 'string' &&
        sender.documentId.length > 0
    );
}

function isProblemSender(sender) {
    try {
        // A content-script context may retain its initial document URL across SPA navigation.
        // Chrome's tab URL identifies the current route; origin still authenticates the sender.
        const sourceOrigin = sender.origin ?? new URL(sender.url).origin;
        const url = new URL(sender.tab?.url || sender.url);
        return (
            sender.id === chrome.runtime.id &&
            sender.frameId === 0 &&
            Number.isInteger(sender.tab?.id) &&
            sender.tab.id >= 0 &&
            sourceOrigin === 'https://neetcode.io' &&
            url.origin === 'https://neetcode.io' &&
            url.pathname.startsWith('/problems/')
        );
    } catch {
        return false;
    }
}

async function ensureStorage() {
    if (!(await storageReady) || storageBlocked) fail('STORAGE_UNAVAILABLE');
}

async function storageAction(action) {
    try {
        return await action();
    } catch {
        fail('STORAGE_UNAVAILABLE');
    }
}

function serialize(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result;
}

function invalidatePendingWork() {
    settingsRevision++;
    pendingCeremonies.clear();
    uploadTickets.clear();
    for (const controller of activeRequests) controller.abort();
}

function validateSettings(input) {
    if (!exactKeys(input, ['username', 'repoName', 'token', 'committerName', 'committerEmail'])) {
        fail('INVALID_SETTINGS');
    }
    const result = {};
    for (const key of ['username', 'repoName', 'committerName', 'committerEmail']) {
        if (typeof input[key] !== 'string') fail('INVALID_SETTINGS');
        result[key] = input[key].trim();
    }
    if (
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(result.username) ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(result.repoName) ||
        ['.', '..'].includes(result.repoName) ||
        result.repoName.endsWith('.git') ||
        !/^[^\x00-\x1f\x7f]{1,200}$/.test(result.committerName) ||
        result.committerEmail.length > 254 ||
        !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+$/.test(result.committerEmail)
    ) {
        fail('INVALID_SETTINGS');
    }
    if (
        input.token !== undefined &&
        (typeof input.token !== 'string' ||
            (input.token !== '' && !/^[\x21-\x7e]{1,1024}$/.test(input.token)))
    ) {
        fail('INVALID_SETTINGS');
    }
    return { ...result, token: input.token || '' };
}

async function readRecord() {
    const record = (await storageAction(() => chrome.storage.local.get(SETTINGS_KEY)))[
        SETTINGS_KEY
    ];
    if (!record) return null;
    try {
        if (record.schemaVersion !== 2) throw new Error();
        validateSettings({
            username: record.username,
            repoName: record.repoName,
            committerName: record.committerName,
            committerEmail: record.committerEmail,
        });
        VaultCrypto.validateVault(record.vault);
        VaultCrypto.unpack(record.sessionGeneration, 16, 16);
        VaultCrypto.unpack(record.recordGeneration || record.sessionGeneration, 16, 16);
        if (record.vault.rpId !== EXTENSION_ORIGIN) throw new Error();
    } catch {
        fail('STORAGE_UNAVAILABLE');
    }
    // Preserve already-saved v2 vaults when adding optimistic form concurrency.
    return { ...record, recordGeneration: record.recordGeneration || record.sessionGeneration };
}

async function sessionFor(record) {
    const session = (await storageAction(() => chrome.storage.session.get(SESSION_KEY)))[
        SESSION_KEY
    ];
    return session &&
        record &&
        session.vaultId === record.vault.vaultId &&
        session.sessionGeneration === record.sessionGeneration &&
        typeof session.token === 'string' &&
        /^[\x21-\x7e]{1,1024}$/.test(session.token)
        ? session
        : null;
}

async function getSettingsSummary() {
    const record = await readRecord();
    if (!record) return null;
    return {
        username: record.username,
        repoName: record.repoName,
        committerName: record.committerName,
        committerEmail: record.committerEmail,
        hasToken: true,
        isUnlocked: Boolean(await sessionFor(record)),
        recordGeneration: record.recordGeneration,
    };
}

async function getUnlockedSettings() {
    await ensureStorage();
    const record = await readRecord();
    if (!record) fail('NOT_CONFIGURED');
    const session = await sessionFor(record);
    if (!session) fail('VAULT_LOCKED');
    return {
        username: record.username,
        repoName: record.repoName,
        committerName: record.committerName,
        committerEmail: record.committerEmail,
        token: session.token,
        vaultId: record.vault.vaultId,
        sessionGeneration: record.sessionGeneration,
    };
}

async function issueUploadTicket(tabId, pageUrl = null) {
    const revision = settingsRevision;
    const navigation = navigationByTab.get(tabId) || 0;
    const settings = await getUnlockedSettings();
    checkRevision(revision);
    if (navigation !== (navigationByTab.get(tabId) || 0)) fail('PAGE_CHANGED');
    for (const [key, entry] of uploadTickets) {
        if (entry.expires < Date.now()) uploadTickets.delete(key);
    }
    if (uploadTickets.size >= 128) uploadTickets.delete(uploadTickets.keys().next().value);
    const ticket = VaultCrypto.pack(VaultCrypto.random(16));
    uploadTickets.set(ticket, {
        tabId,
        pageUrl,
        revision,
        vaultId: settings.vaultId,
        sessionGeneration: settings.sessionGeneration,
        expires: Date.now() + 120000,
    });
    return ticket;
}

function consumeUploadTicket(ticket, sender, settings) {
    const entry = uploadTickets.get(ticket);
    if (!entry || entry.tabId !== sender.tab.id) fail('SETTINGS_CHANGED');
    uploadTickets.delete(ticket);
    if (
        entry.revision !== settingsRevision ||
        entry.expires < Date.now() ||
        entry.vaultId !== settings.vaultId ||
        entry.sessionGeneration !== settings.sessionGeneration
    ) {
        fail('SETTINGS_CHANGED');
    }
    if (entry.pageUrl && entry.pageUrl !== (sender.tab.url || sender.url)) fail('PAGE_CHANGED');
}

async function beginVaultCeremony(mode, sender, revision) {
    const record = await readRecord();
    checkRevision(revision);
    if (mode === 'setup' && record) fail('INVALID_UNLOCK_PROOF');
    if (mode === 'unlock' && !record) fail('NOT_CONFIGURED');
    const now = Date.now();
    for (const [key, entry] of pendingCeremonies) {
        if (entry.expires < now || entry.documentId === sender.documentId) {
            pendingCeremonies.delete(key);
        }
    }
    if (pendingCeremonies.size >= 16) fail('INVALID_UNLOCK_PROOF');
    const ceremony = {
        ceremonyId: VaultCrypto.pack(VaultCrypto.random(16)),
        challenge: VaultCrypto.pack(VaultCrypto.random(32)),
        rpId: EXTENSION_ORIGIN,
        prfSalt: record?.vault.prfSalt || VaultCrypto.pack(VaultCrypto.random(32)),
        ...(record
            ? { credentialId: record.vault.credentialId }
            : { userId: VaultCrypto.pack(VaultCrypto.random(32)) }),
    };
    pendingCeremonies.set(ceremony.ceremonyId, {
        ...ceremony,
        mode,
        documentId: sender.documentId,
        revision: settingsRevision,
        expires: now + 120000,
    });
    return { ok: true, ceremony };
}

async function consumeProof(proof, sender, mode) {
    const entry = pendingCeremonies.get(proof?.ceremonyId);
    if (!entry || entry.documentId !== sender.documentId) fail('INVALID_UNLOCK_PROOF');
    pendingCeremonies.delete(proof.ceremonyId);
    try {
        if (
            entry.mode !== mode ||
            entry.revision !== settingsRevision ||
            entry.expires < Date.now()
        ) {
            throw new Error();
        }
        VaultCrypto.unpack(proof.credentialId, 1, 1024);
        if (entry.credentialId && entry.credentialId !== proof.credentialId) throw new Error();
        const client = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
                VaultCrypto.unpack(proof.clientDataJSON, 1, 4096),
            ),
        );
        if (
            client.type !== 'webauthn.get' ||
            client.origin !== EXTENSION_ORIGIN ||
            client.challenge !== entry.challenge ||
            client.crossOrigin === true
        ) {
            throw new Error();
        }
        const auth = VaultCrypto.unpack(proof.authenticatorData, 37, 4096);
        const hash = new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(EXTENSION_ORIGIN)),
        );
        if ((auth[32] & 5) !== 5 || !hash.every((byte, index) => auth[index] === byte)) {
            throw new Error();
        }
        const output = VaultCrypto.unpack(proof.prfOutput, 32, 32);
        if (mode === 'setup' && proof.enrollmentPrfOutput !== proof.prfOutput) throw new Error();
        if (entry.revision !== settingsRevision) throw new Error();
        return { entry, output, credentialId: proof.credentialId };
    } catch {
        fail('INVALID_UNLOCK_PROOF');
    }
}

async function removeSession() {
    try {
        await chrome.storage.session.remove(SESSION_KEY);
    } catch {
        storageBlocked = true;
        fail('STORAGE_UNAVAILABLE');
    }
}

async function saveSettings(input, proof, sender, revision, expectedVersion) {
    const fields = validateSettings(input);
    const record = await readRecord();
    checkRevision(revision);
    if ((record?.recordGeneration || null) !== expectedVersion) fail('SETTINGS_CHANGED');
    let vault = record?.vault;
    const token = fields.token;
    if (token) {
        const verified = await consumeProof(proof, sender, record ? 'unlock' : 'setup');
        if (record) {
            try {
                await VaultCrypto.decryptToken(vault, verified.output);
            } catch {
                fail('VAULT_DECRYPT_FAILED');
            }
        }
        vault = await VaultCrypto.encryptToken(token, verified.output, {
            vaultId: VaultCrypto.pack(VaultCrypto.random(16)),
            rpId: EXTENSION_ORIGIN,
            credentialId: verified.credentialId,
            prfSalt: verified.entry.prfSalt,
        });
        if (verified.entry.revision !== settingsRevision) fail('SETTINGS_CHANGED');
    } else if (!record) fail('INVALID_SETTINGS');
    checkRevision(revision);
    await removeSession();
    checkRevision(revision);
    const { token: _unused, ...publicFields } = fields;
    const sessionGeneration = VaultCrypto.pack(VaultCrypto.random(16));
    await storageAction(() =>
        chrome.storage.local.set({
            [SETTINGS_KEY]: {
                schemaVersion: 2,
                ...publicFields,
                vault,
                sessionGeneration,
                recordGeneration: VaultCrypto.pack(VaultCrypto.random(16)),
            },
        }),
    );
    checkRevision(revision);
    return {
        ok: true,
        settings: await getSettingsSummary(),
        message: 'Settings saved and locked. Choose Unlock with PIN to continue.',
    };
}

async function completeVaultUnlock(proof, sender) {
    const verified = await consumeProof(proof, sender, 'unlock');
    const record = await readRecord();
    if (!record) fail('NOT_CONFIGURED');
    let token;
    try {
        token = await VaultCrypto.decryptToken(record.vault, verified.output);
    } catch {
        fail('VAULT_DECRYPT_FAILED');
    }
    if (verified.entry.revision !== settingsRevision) fail('SETTINGS_CHANGED');
    await storageAction(() =>
        chrome.storage.session.set({
            [SESSION_KEY]: {
                vaultId: record.vault.vaultId,
                sessionGeneration: record.sessionGeneration,
                token,
            },
        }),
    );
    return { ok: true, settings: await getSettingsSummary() };
}

async function lockVault() {
    let failed = false;
    try {
        const record = await readRecord();
        // Independently attempt both stores: either success invalidates old sessions.
        if (record) {
            await storageAction(() =>
                chrome.storage.local.set({
                    [SETTINGS_KEY]: {
                        ...record,
                        sessionGeneration: VaultCrypto.pack(VaultCrypto.random(16)),
                    },
                }),
            );
        }
    } catch {
        failed = true;
    }
    try {
        await removeSession();
    } catch {
        failed = true;
    }
    if (failed) {
        storageBlocked = true;
        fail('STORAGE_UNAVAILABLE');
    }
    return { ok: true, settings: await getSettingsSummary() };
}

async function clearSettings() {
    let failed = false;
    try {
        await chrome.storage.local.remove(SETTINGS_KEY);
    } catch {
        failed = true;
    }
    try {
        await removeSession();
    } catch {
        failed = true;
    }
    if (failed) {
        storageBlocked = true;
        fail('STORAGE_UNAVAILABLE');
    }
    return { ok: true };
}

function validateUploadPayload(payload) {
    if (
        !exactKeys(payload, ['category', 'title', 'date', 'files']) ||
        !['System Design', 'Data Structures & Algorithms'].includes(payload.category) ||
        typeof payload.title !== 'string' ||
        !/^[^<>:"/\\|?*\x00-\x1f\x7f]{1,200}$/.test(payload.title) ||
        ['.', '..'].includes(payload.title) ||
        /[. ]$/.test(payload.title) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(payload.title) ||
        typeof payload.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
        Number.isNaN(Date.parse(payload.date)) ||
        new Date(payload.date).toISOString().slice(0, 10) !== payload.date ||
        !Array.isArray(payload.files) ||
        payload.files.length < 1 ||
        payload.files.length > 2
    ) {
        fail('INVALID_UPLOAD');
    }
    const kinds = new Set();
    let bytes = 0;
    for (const file of payload.files) {
        if (
            !exactKeys(file, ['kind', 'extension', 'content']) ||
            kinds.has(file.kind) ||
            typeof file.content !== 'string' ||
            (file.kind === 'problem'
                ? file.extension !== 'md'
                : file.kind !== 'solution' ||
                  ![
                      'py',
                      'java',
                      'cpp',
                      'c',
                      'cs',
                      'js',
                      'ts',
                      'go',
                      'rs',
                      'kt',
                      'swift',
                      'rb',
                      'php',
                      'scala',
                      'dart',
                      'rkt',
                      'ex',
                      'erl',
                      'fs',
                      'r',
                      'pl',
                      'hs',
                      'lua',
                      'sh',
                      'sql',
                  ].includes(file.extension))
        ) {
            fail('INVALID_UPLOAD');
        }
        kinds.add(file.kind);
        bytes += new TextEncoder().encode(file.content).byteLength;
    }
    if (!kinds.has('problem') || bytes > 1048576) fail('INVALID_UPLOAD');
    return payload;
}

function checkRevision(revision) {
    if (revision !== settingsRevision) fail('SETTINGS_CHANGED');
}

async function githubRequest(settings, endpointPath, init, revision) {
    checkRevision(revision);
    const controller = new AbortController();
    activeRequests.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 15000);
    let onAbort;
    const aborted = new Promise((_resolve, reject) => {
        onAbort = () => reject(new Error('Request cancelled'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        const response = await Promise.race([
            fetch(`${GITHUB_API_ORIGIN}${endpointPath}`, {
                ...init,
                signal: controller.signal,
                redirect: 'error',
                credentials: 'omit',
                headers: {
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': GITHUB_API_VERSION,
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${settings.token}`,
                },
            }),
            aborted,
        ]);
        checkRevision(revision);
        if (response.ok || response.status === 404) {
            const data =
                response.ok && init.method === 'GET'
                    ? await Promise.race([response.json(), aborted])
                    : undefined;
            checkRevision(revision);
            return { status: response.status, data };
        }
        if (
            response.status === 429 ||
            (response.status === 403 &&
                (response.headers.get('x-ratelimit-remaining') === '0' ||
                    response.headers.get('retry-after')))
        ) {
            fail('RATE_LIMITED');
        }
        fail(
            {
                401: 'AUTH_FAILED',
                403: 'ACCESS_DENIED',
                409: 'CONFLICT',
                422: 'GITHUB_VALIDATION',
            }[response.status] || 'GITHUB_ERROR',
        );
    } catch (error) {
        checkRevision(revision);
        if (error.publicCode) throw error;
        fail(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        activeRequests.delete(controller);
    }
}

function repositoryPath(settings) {
    return `/repos/${encodeURIComponent(settings.username)}/${encodeURIComponent(settings.repoName)}`;
}

async function testGitHubConnection(input, revision) {
    const fields = validateSettings(input);
    if (!fields.token) fields.token = (await getUnlockedSettings()).token;
    const user = await githubRequest(fields, '/user', { method: 'GET' }, revision);
    if (user.status !== 200) fail('AUTH_FAILED');
    const repo = await githubRequest(fields, repositoryPath(fields), { method: 'GET' }, revision);
    if (repo.status === 404) fail('REPO_NOT_FOUND');
    return {
        ok: true,
        message: 'Authentication and repository access verified. Write permission is not verified.',
    };
}

function encodeUtf8Base64(content) {
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
}

async function upsertGitHubFile(settings, payload, file, revision) {
    const path = [payload.category, payload.title, `${file.kind}.${file.extension}`]
        .map(encodeURIComponent)
        .join('/');
    const endpoint = `${repositoryPath(settings)}/contents/${path}`;
    const existing = await githubRequest(settings, endpoint, { method: 'GET' }, revision);
    if (existing.status === 200 && file.kind === 'problem') {
        return { kind: file.kind, status: 200, updated: false, skipped: true };
    }
    const body = {
        message: `Added ${payload.title} on ${payload.date}`,
        committer: { name: settings.committerName, email: settings.committerEmail },
        content: encodeUtf8Base64(file.content),
    };
    if (existing.status !== 404) {
        const data = existing.data;
        if (typeof data.sha !== 'string' || !data.sha) fail('GITHUB_ERROR');
        body.sha = data.sha;
    }
    const saved = await githubRequest(
        settings,
        endpoint,
        { method: 'PUT', body: JSON.stringify(body) },
        revision,
    );
    if (![200, 201].includes(saved.status)) {
        fail(saved.status === 404 ? 'REPO_NOT_FOUND' : 'GITHUB_ERROR');
    }
    return { kind: file.kind, status: saved.status, updated: Boolean(body.sha) };
}

async function uploadProblem(payload, revision, uploadTicket, sender) {
    validateUploadPayload(payload);
    const settings = await getUnlockedSettings();
    checkRevision(revision);
    consumeUploadTicket(uploadTicket, sender, settings);
    const files = [];
    try {
        for (const kind of ['solution', 'problem']) {
            const file = payload.files.find(entry => entry.kind === kind);
            if (file) files.push(await upsertGitHubFile(settings, payload, file, revision));
        }
    } catch (error) {
        error.savedFiles = files;
        throw error;
    }
    return { ok: true, updated: files.some(file => file.updated), files };
}

// Runs in the page world without credentials or extension state. Never scrape rendered lines.
function readEditorModel(pageUrl) {
    if (globalThis.location.href !== pageUrl) return null;
    try {
        const api = globalThis.monaco?.editor;
        if (!api) return null;
        let model;
        if (typeof api.getEditors === 'function') {
            const editors = api.getEditors().filter(editor => {
                const node = editor.getDomNode();
                return node?.isConnected && node.getClientRects().length > 0;
            });
            const focused = editors.filter(editor => editor.hasTextFocus());
            const candidates = focused.length === 1 ? focused : editors;
            if (candidates.length !== 1) return null;
            model = candidates[0].getModel();
        } else {
            const models = api.getModels().filter(model => !model.isDisposed());
            if (models.length !== 1) return null;
            model = models[0];
        }
        if (!model || model.isDisposed()) return null;
        const code = model.getValue();
        return typeof code === 'string' && code.length <= 1048576 ? code : null;
    } catch {
        return null;
    }
}

async function getEditorCode(sender, pageUrl, revision) {
    if (typeof pageUrl !== 'string' || pageUrl !== (sender.tab.url || sender.url)) {
        fail('PAGE_CHANGED');
    }
    let timer;
    try {
        const results = await Promise.race([
            chrome.scripting.executeScript({
                target: { tabId: sender.tab.id, frameIds: [0] },
                world: 'MAIN',
                func: readEditorModel,
                args: [pageUrl],
            }),
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Editor timeout')), 5000);
            }),
        ]);
        checkRevision(revision);
        const code = results?.[0]?.result;
        if (typeof code !== 'string' || new TextEncoder().encode(code).byteLength > 1048576) {
            fail('EDITOR_UNAVAILABLE');
        }
        return { ok: true, code };
    } catch (error) {
        if (error.publicCode) throw error;
        fail('EDITOR_UNAVAILABLE');
    } finally {
        clearTimeout(timer);
    }
}

const OPTIONS_OPERATIONS = new Set([
    'GET_SETTINGS',
    'BEGIN_VAULT_SETUP',
    'BEGIN_VAULT_UNLOCK',
    'COMPLETE_VAULT_UNLOCK',
    'LOCK_VAULT',
    'SAVE_SETTINGS',
    'TEST_CONNECTION',
    'CLEAR_SETTINGS',
]);

async function handleMessage(message, sender, revision) {
    await ensureStorage();
    if (!['LOCK_VAULT', 'CLEAR_SETTINGS'].includes(message.type)) checkRevision(revision);
    switch (message.type) {
        case 'GET_SETTINGS': {
            const notice = lastActionNotice;
            lastActionNotice = '';
            return {
                ok: true,
                settings: await getSettingsSummary(),
                ...(notice ? { notice } : {}),
            };
        }
        case 'BEGIN_VAULT_SETUP':
            return beginVaultCeremony('setup', sender, revision);
        case 'BEGIN_VAULT_UNLOCK':
            return beginVaultCeremony('unlock', sender, revision);
        case 'COMPLETE_VAULT_UNLOCK':
            return completeVaultUnlock(message.unlockProof, sender);
        case 'SAVE_SETTINGS':
            return saveSettings(
                message.settings,
                message.unlockProof,
                sender,
                revision,
                message.expectedVersion ?? null,
            );
        case 'LOCK_VAULT':
            return lockVault();
        case 'CLEAR_SETTINGS':
            return clearSettings();
        case 'TEST_CONNECTION':
            return testGitHubConnection(message.settings, revision);
        case 'GET_EDITOR_CODE':
            return getEditorCode(sender, message.pageUrl, revision);
        case 'UPLOAD_PROBLEM':
            return uploadProblem(message.payload, revision, message.uploadTicket, sender);
        case 'OPEN_SETTINGS':
            await chrome.runtime.openOptionsPage();
            return { ok: true };
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message?.type;
    if (
        !OPTIONS_OPERATIONS.has(type) &&
        !['UPLOAD_PROBLEM', 'OPEN_SETTINGS', 'GET_EDITOR_CODE'].includes(type)
    ) {
        return false;
    }
    if (!(OPTIONS_OPERATIONS.has(type) ? isOptionsSender(sender) : isProblemSender(sender))) {
        sendResponse(publicError({ publicCode: 'UNAUTHORIZED' }));
        return false;
    }
    if (type === 'SAVE_SETTINGS') {
        try {
            validateSettings(message.settings);
        } catch (error) {
            sendResponse(publicError(error));
            return false;
        }
        const entry = pendingCeremonies.get(message.unlockProof?.ceremonyId);
        const ownProof =
            entry?.documentId === sender.documentId && entry.revision === settingsRevision
                ? entry
                : null;
        invalidatePendingWork();
        if (ownProof) {
            pendingCeremonies.set(ownProof.ceremonyId, { ...ownProof, revision: settingsRevision });
        }
    }
    // Lock/clear invalidate active and queued operations immediately, before waiting.
    if (type === 'LOCK_VAULT' || type === 'CLEAR_SETTINGS') invalidatePendingWork();
    const revision = settingsRevision;
    serialize(() => handleMessage(message, sender, revision)).then(sendResponse, error =>
        sendResponse(publicError(error)),
    );
    return true;
});

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason === 'install') chrome.runtime.openOptionsPage().catch(() => {});
});

chrome.webRequest.onBeforeRequest.addListener(
    details => {
        if (details.url.includes('executeCodeFunctionHttp')) {
            if (details.requestBody && details.requestBody.raw) {
                try {
                    const buffer = details.requestBody.raw[0].bytes;

                    // Decode request body
                    const uint8Array = new Uint8Array(buffer);
                    const decoder = new TextDecoder('utf-8');
                    const decodedString = decoder.decode(uint8Array);

                    const parsed = JSON.parse(decodedString);

                    // Updated structure (no more data.data)
                    const data = parsed.data || parsed;

                    const title = data.problemId;
                    const code = data.rawCode;

                    if (details.tabId >= 0) {
                        // Store safely per tab
                        const navigation = navigationByTab.get(details.tabId) || 0;
                        // Bind to Chrome's actual page URL, not NeetCode's backend problem ID.
                        const pageUrl = chrome.tabs
                            .get(details.tabId)
                            .then(tab =>
                                navigation === (navigationByTab.get(details.tabId) || 0) &&
                                isProblemSender({
                                    id: chrome.runtime.id,
                                    tab,
                                    url: tab.url,
                                    frameId: 0,
                                })
                                    ? tab.url
                                    : null,
                            )
                            .catch(() => null);
                        pendingCodeByTab[details.tabId] = { title, code, navigation, pageUrl };
                    }
                } catch {
                    /* Ignore incomplete or malformed request bodies. */
                }
            }
        }
    },
    {
        urls: ['https://neetcode.io/api/*'], // updated filter
    },
    ['requestBody'],
);

function sendToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

async function ensurePageReceiver(tabId) {
    // Probe before sending work: retrying an actual save could duplicate commits.
    const ready = async () => {
        let timer;
        try {
            const result = await Promise.race([
                sendToTab(tabId, { type: 'PAGE_READY' }),
                new Promise(resolve => {
                    timer = setTimeout(() => resolve(null), 2000);
                }),
            ]);
            return result?.ready === true;
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        if (await ready()) return;
    } catch {
        /* An update can disconnect an already-open tab. */
    }
    try {
        await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            world: 'ISOLATED',
            files: ['content-script.js'],
        });
        if (await ready()) return;
    } catch {
        /* Never expose raw browser errors or reload the user's editor. */
    }
    fail('PAGE_UNAVAILABLE');
}

chrome.webRequest.onCompleted.addListener(
    async details => {
        if (!details.url.includes('githubFunctionHttp')) return;

        const tabId = details.tabId;
        if (tabId < 0) return;

        const stored = pendingCodeByTab[tabId];
        delete pendingCodeByTab[tabId];
        if (!stored) return;
        try {
            const pageUrl = await stored.pageUrl;
            if (!pageUrl || stored.navigation !== (navigationByTab.get(tabId) || 0)) {
                fail('PAGE_CHANGED');
            }
            const uploadTicket = await issueUploadTicket(tabId, pageUrl);
            await sendToTab(tabId, {
                type: 'CODE_DATA',
                title: stored.title,
                code: stored.code,
                uploadTicket,
                pageUrl,
            });
        } catch (error) {
            await sendToTab(tabId, {
                type: 'SAVE_BLOCKED',
                error: publicError(error).error,
            }).catch(() => {});
        }
    },
    { urls: ['https://neetcode.io/api/*'] },
);

chrome.action.onClicked.addListener(async tab => {
    lastActionNotice = '';
    try {
        if (!isProblemSender({ id: chrome.runtime.id, tab, url: tab.url, frameId: 0 })) {
            lastActionNotice = 'Open a NeetCode problem page, then click the extension to save it.';
            await chrome.runtime.openOptionsPage();
            return;
        }
        const uploadTicket = await issueUploadTicket(tab.id, tab.url);
        await ensurePageReceiver(tab.id);
        const response = await sendToTab(tab.id, {
            type: 'MANUAL_TRIGGER',
            uploadTicket,
            pageUrl: tab.url,
        });
        if (response?.reason === 'PAGE_CHANGED') fail('PAGE_CHANGED');
        if (response?.accepted !== true) throw new Error('Save delivery was not acknowledged');
    } catch (error) {
        lastActionNotice = error.publicCode
            ? ERROR_MESSAGES[error.publicCode]
            : 'The save could not be confirmed. Check your repository before trying again.';
        await chrome.runtime.openOptionsPage().catch(() => {});
    }
});

chrome.tabs.onRemoved.addListener(tabId => {
    delete pendingCodeByTab[tabId];
    navigationByTab.delete(tabId);
    for (const [ticket, entry] of uploadTickets) {
        if (entry.tabId === tabId) uploadTickets.delete(ticket);
    }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url || change.status === 'loading') {
        navigationByTab.set(tabId, (navigationByTab.get(tabId) || 0) + 1);
        delete pendingCodeByTab[tabId];
        for (const [ticket, entry] of uploadTickets) {
            if (entry.tabId === tabId) uploadTickets.delete(ticket);
        }
    }
});
