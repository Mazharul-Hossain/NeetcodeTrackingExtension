/*
 * NeetcodeTrackingExtension/ -> tests/ -> options.test.cjs
 * Purpose: exercise the real settings controller through a minimal DOM and worker.
 * Agent skills: browser form events and synthetic WebAuthn provider fixtures.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { loadScript, root } = require('./helpers/extension-harness.cjs');
const { workerFixture, configure, fields, origin } = require('./helpers/worker-harness.cjs');

async function optionsFixture({ worker = workerFixture(), credentials } = {}) {
    assert.ok(fs.existsSync(path.join(root, 'options.js')), 'Settings controller must exist');
    const nodes = new Map();
    function node(id) {
        if (!nodes.has(id)) {
            nodes.set(id, {
                value: '',
                textContent: '',
                hidden: false,
                disabled: false,
                required: false,
                listeners: {},
                addEventListener(name, fn) {
                    this.listeners[name] = fn;
                },
                reportValidity: () => true,
                focus() {},
            });
        }
        return nodes.get(id);
    }
    const events = {};
    const fakeCredential = async publicKey => {
        const bytes = new Uint8Array(32).fill(9);
        const client = new TextEncoder().encode(
            JSON.stringify({
                type: 'webauthn.get',
                origin,
                challenge: Buffer.from(publicKey.challenge).toString('base64url'),
                crossOrigin: false,
            }),
        );
        const auth = new Uint8Array(37);
        auth.set(
            new Uint8Array(
                await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(origin)),
            ),
        );
        auth[32] = 5;
        return {
            rawId: bytes.buffer,
            response: { clientDataJSON: client.buffer, authenticatorData: auth.buffer },
            getClientExtensionResults: () => ({
                prf: { results: { first: new Uint8Array(32).fill(7).buffer } },
            }),
        };
    };
    const providerCalls = [];
    const provider = credentials || {
        async create({ publicKey }) {
            providerCalls.push('create');
            return fakeCredential(publicKey);
        },
        async get({ publicKey }) {
            providerCalls.push('get');
            return fakeCredential(publicKey);
        },
    };
    const f = loadScript('options.js', {
        document: {
            getElementById: node,
            addEventListener(name, fn) {
                events[name] = fn;
            },
            visibilityState: 'visible',
        },
        window: {
            addEventListener(name, fn) {
                events[name] = fn;
            },
        },
        navigator: { credentials: provider },
        chrome: { runtime: { sendMessage: message => worker.request(message) } },
    });
    await f.evaluate('optionsReady');
    function fill() {
        for (const [id, value] of Object.entries({
            'github-username': fields.username,
            'github-repository': fields.repoName,
            'github-token': fields.token,
            'committer-name': fields.committerName,
            'committer-email': fields.committerEmail,
        })) {
            node(id).value = value;
        }
    }
    return { ...f, worker, node, fill, providerCalls };
}
test('first run shows empty fields and no persisted token', async () => {
    const f = await optionsFixture();
    assert.equal(f.node('github-token').value, '');
    assert.match(f.node('vault-status').textContent, /not configured/i);
});
test('Save enrolls, encrypts and locks with Unlock immediately enabled', async () => {
    const f = await optionsFixture();
    f.fill();
    await f.context.handleSave({ preventDefault() {} });
    assert.deepEqual(f.providerCalls, ['create', 'get']);
    assert.equal((await f.worker.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
    assert.equal(Object.keys(f.worker.persisted.session).length, 0);
    assert.equal(f.node('unlock-vault').disabled, false);
    assert.match(f.node('vault-status').textContent, /^Locked/);
    assert.equal(f.node('github-token').value, '');
    assert.equal(JSON.stringify(f.worker.persisted.local).includes(fields.token), false);
});
test('existing settings restore public fields and blank-token Save retains vault', async () => {
    const worker = workerFixture();
    await configure(worker);
    const original = worker.persisted.local.githubSettingsV2.vault.ciphertext;
    const f = await optionsFixture({ worker });
    assert.equal(f.node('github-username').value, fields.username);
    assert.equal(f.node('github-token').value, '');
    f.node('committer-name').value = 'Another name';
    await f.context.handleSave({ preventDefault() {} });
    assert.equal(worker.persisted.local.githubSettingsV2.vault.ciphertext, original);
    assert.equal(worker.persisted.local.githubSettingsV2.committerName, 'Another name');
    assert.equal(f.providerCalls.length, 0);
    assert.equal((await worker.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
    assert.equal(f.node('unlock-vault').disabled, false);
});
test('cancelled PIN prompt preserves encrypted data and shows safe feedback', async () => {
    const worker = workerFixture();
    await configure(worker);
    await worker.request({ type: 'LOCK_VAULT' });
    const f = await optionsFixture({
        worker,
        credentials: {
            async get() {
                throw Object.assign(new Error(fields.token), { name: 'NotAllowedError' });
            },
        },
    });
    await f.context.handleUnlock();
    assert.equal((await worker.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
    assert.match(f.node('settings-status').textContent, /cancel|timed out/i);
    assert.equal(f.node('settings-status').textContent.includes(fields.token), false);
});
test('missing PRF fails enrollment without plaintext fallback', async () => {
    const f = await optionsFixture({
        credentials: {
            async create() {
                return { rawId: new Uint8Array(32).buffer, getClientExtensionResults: () => ({}) };
            },
            async get() {
                return { rawId: new Uint8Array(32).buffer, getClientExtensionResults: () => ({}) };
            },
        },
    });
    f.fill();
    await f.context.handleSave({ preventDefault() {} });
    assert.equal(Object.keys(f.worker.persisted.local).length, 0);
    assert.match(f.node('settings-status').textContent, /PRF|supported/i);
});
test('Lock and confirmed Clear update state and remove appropriate secrets', async () => {
    const worker = workerFixture();
    await configure(worker);
    const f = await optionsFixture({ worker });
    await f.context.handleLock();
    assert.match(f.node('vault-status').textContent, /locked/i);
    assert.equal(Object.keys(worker.persisted.session).length, 0);
    await f.context.handleClear();
    assert.equal(Object.keys(worker.persisted.local).length, 0);
    assert.equal(f.node('github-username').value, '');
    assert.equal(f.node('github-token').value, '');
});
test('Test connection does not save an unsaved token', async () => {
    const f = await optionsFixture();
    f.fill();
    await f.context.handleTest();
    assert.equal(Object.keys(f.worker.persisted.local).length, 0);
    assert.equal(f.worker.calls.length, 2);
    assert.match(f.node('settings-status').textContent, /Write permission is not verified/);
});
for (const action of ['handleClear', 'handleLock']) {
    test(`late passkey creation after ${action} cannot start another prompt or save`, async () => {
        let finishCreate;
        let notify;
        let gets = 0;
        const started = new Promise(resolve => {
            notify = resolve;
        });
        const f = await optionsFixture({
            credentials: {
                async create() {
                    notify();
                    return new Promise(resolve => {
                        finishCreate = resolve;
                    });
                },
                async get() {
                    gets++;
                    throw new Error('Unexpected follow-up prompt');
                },
            },
        });
        f.fill();
        const saving = f.context.handleSave({ preventDefault() {} });
        await started;
        await f.context[action]();
        const status = f.node('settings-status').textContent;
        finishCreate({
            rawId: new Uint8Array(32).buffer,
            getClientExtensionResults: () => ({
                prf: { results: { first: new Uint8Array(32).fill(7).buffer } },
            }),
        });
        await saving;
        assert.equal(gets, 0);
        assert.equal(Object.keys(f.worker.persisted.local).length, 0);
        assert.equal(Object.keys(f.worker.persisted.session).length, 0);
        assert.equal(f.node('settings-status').textContent, status);
    });
}
test('existing vault unlock and token replacement use the selected verified credential', async () => {
    const worker = workerFixture();
    await configure(worker);
    await worker.request({ type: 'LOCK_VAULT' });
    const f = await optionsFixture({ worker });
    await f.context.handleUnlock();
    assert.equal((await worker.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, true);
    assert.deepEqual(f.providerCalls, ['get']);
    f.node('github-token').value = 'replacement-synthetic-token';
    await f.context.handleSave({ preventDefault() {} });
    assert.equal(Object.keys(worker.persisted.session).length, 0);
    assert.equal(f.node('unlock-vault').disabled, false);
    await f.context.handleUnlock();
    assert.equal(
        worker.persisted.session.githubVaultSessionV1.token,
        'replacement-synthetic-token',
    );
    assert.equal(
        JSON.stringify(worker.persisted.local).includes('replacement-synthetic-token'),
        false,
    );
    assert.deepEqual(f.providerCalls, ['get', 'get', 'get']);
});
test('corrupt encrypted token stays locked and shows safe recovery guidance', async () => {
    const worker = workerFixture();
    await configure(worker);
    await worker.request({ type: 'LOCK_VAULT' });
    const vault = worker.persisted.local.githubSettingsV2.vault;
    const raw = Buffer.from(vault.ciphertext, 'base64url');
    raw[0] ^= 1;
    vault.ciphertext = raw.toString('base64url');
    const original = vault.ciphertext;
    const f = await optionsFixture({ worker });
    await f.context.handleUnlock();
    assert.equal((await worker.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
    assert.equal(worker.persisted.local.githubSettingsV2.vault.ciphertext, original);
    assert.match(f.node('settings-status').textContent, /original passkey|clear settings/i);
});
test('focus refresh updates pristine repository fields changed by another tab', async () => {
    const worker = workerFixture();
    await configure(worker);
    const f = await optionsFixture({ worker });
    const expectedVersion = worker.persisted.local.githubSettingsV2.recordGeneration;
    await worker.request({
        type: 'SAVE_SETTINGS',
        settings: { ...fields, token: '', repoName: 'another-repo' },
        expectedVersion,
    });
    await f.context.loadSettings(false);
    assert.equal(f.node('github-repository').value, 'another-repo');
});
test('changed vault invalidates dirty fields and discards any unsaved token until refresh', async () => {
    const worker = workerFixture();
    await configure(worker);
    const f = await optionsFixture({ worker });
    f.node('github-repository').value = 'unsaved-repo';
    f.node('github-token').value = 'unsaved-synthetic-token';
    const expectedVersion = worker.persisted.local.githubSettingsV2.recordGeneration;
    await worker.request({
        type: 'SAVE_SETTINGS',
        settings: { ...fields, token: '', repoName: 'another-repo' },
        expectedVersion,
    });
    await f.context.loadSettings(false);
    assert.equal(f.node('github-token').value, '');
    assert.equal(f.node('save-settings').disabled, true);
    assert.match(f.node('settings-status').textContent, /another tab|reload settings/i);
    await f.context.handleSave({ preventDefault() {} });
    assert.equal(worker.persisted.local.githubSettingsV2.repoName, 'another-repo');
    await f.context.loadSettings(true);
    assert.equal(f.node('github-repository').value, 'another-repo');
    assert.equal(f.node('save-settings').disabled, false);
});
