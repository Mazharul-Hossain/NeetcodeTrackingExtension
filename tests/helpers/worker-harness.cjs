/*
 * NeetcodeTrackingExtension/ -> tests/helpers/ -> worker-harness.cjs
 * Purpose: exercise worker messages with isolated storage and network boundaries.
 * Agent skills: Chrome MessageSender fixtures and Web Crypto proof construction.
 */
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { event, loadScript } = require('./extension-harness.cjs');
const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const origin = `chrome-extension://${id}`;
const fields = { username: 'test-owner', repoName: 'test-repo', token: 'synthetic-token', committerName: 'Test', committerEmail: 'test@example.invalid' };
const optionsSender = { id, url: `${origin}/options.html`, documentId: 'options-document-1' };
const problemSender = { id, url: 'https://neetcode.io/problems/two-sum', frameId: 0, tab: { id: 7 } };

function workerFixture(overrides = {}) {
    const operations = [];
    const persisted = overrides.persisted || { local: {}, session: {} };
    function area(name) {
        return {
            async setAccessLevel(value) { operations.push(['access', name, value]); if (overrides.access) await overrides.access(name); },
            async get(key) { operations.push(['get', name]); return { [key]: structuredClone(persisted[name][key]) }; },
            async set(value) { operations.push(['set', name, structuredClone(value)]); if (overrides.set) await overrides.set(name, value); Object.assign(persisted[name], structuredClone(value)); },
            async remove(key) { operations.push(['remove', name]); if (overrides.remove) await overrides.remove(name); delete persisted[name][key]; }
        };
    }
    const sent = [];
    const chrome = {
        runtime: { id, getURL: file => `${origin}/${file}`, onMessage: event(), onInstalled: event(), async openOptionsPage() { operations.push(['openOptions']); } },
        storage: { local: area('local'), session: area('session') },
        webRequest: { onBeforeRequest: event(), onCompleted: event() },
        action: { onClicked: event() },
        tabs: { onRemoved: event(), onUpdated: event(), async get(tabId) { return { id: tabId, url: 'https://neetcode.io/problems/two-sum' }; }, sendMessage(...args) { sent.push(args); const cb = args.at(-1); if (typeof cb === 'function') cb(); return Promise.resolve(args[1]?.type === 'PAGE_READY' ? { ready: true } : { accepted: true }); } }
    };
    const calls = [];
    const fetch = async (...args) => { calls.push(args); return overrides.fetch ? overrides.fetch(...args) : response(200, { login: 'test-owner' }); };
    const script = loadScript('background.js', { chrome, fetch, ...(overrides.globals || {}) }, overrides.transform);
    async function request(message, sender = optionsSender) {
        if (message.type === 'UPLOAD_PROBLEM' && !('uploadTicket' in message)) {
            await chrome.action.onClicked.fire({ id: sender.tab?.id, url: sender.url });
            const trigger = sent.at(-1)?.[1];
            message = { ...message, uploadTicket: trigger?.uploadTicket };
        }
        const listener = chrome.runtime.onMessage.listeners[0];
        assert.equal(typeof listener, 'function', 'Worker must register its message handler');
        return new Promise((resolve, reject) => {
            try { const handled = listener(message, sender, resolve); if (handled !== true) resolve(undefined); } catch (error) { reject(error); }
        });
    }
    return { ...script, chrome, request, calls, operations, persisted, sent };
}

function response(status, body = {}) {
    return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body };
}

async function proof(f, ceremony, extra = {}) {
    const v = f.evaluate('VaultCrypto');
    const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(origin)));
    const data = new Uint8Array(37); data.set(hash); data[32] = 5;
    const output = v.pack(new Uint8Array(32).fill(7));
    return {
        ceremonyId: ceremony.ceremonyId, credentialId: ceremony.credentialId || v.pack(new Uint8Array(32).fill(9)),
        clientDataJSON: v.pack(new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', origin, challenge: ceremony.challenge, crossOrigin: false }))),
        authenticatorData: v.pack(data), prfOutput: output, enrollmentPrfOutput: output, ...extra
    };
}
// Most worker tests need an unlocked starting state; perform that separate user action explicitly.
async function configure(f, unlock = true) {
    const begin = await f.request({ type: 'BEGIN_VAULT_SETUP' });
    assert.equal(begin.ok, true, JSON.stringify(begin));
    const saved = await f.request({ type: 'SAVE_SETTINGS', settings: fields, unlockProof: await proof(f, begin.ceremony) });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    if (unlock) {
        const beginUnlock = await f.request({ type: 'BEGIN_VAULT_UNLOCK' });
        const unlocked = await f.request({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: await proof(f, beginUnlock.ceremony) });
        assert.equal(unlocked.ok, true, JSON.stringify(unlocked));
    }
    return saved;
}
const payload = { category: 'Data Structures & Algorithms', title: 'two-sum', date: '2026-11-23', files: [{ kind: 'solution', extension: 'py', content: 'café' }, { kind: 'problem', extension: 'md', content: '# Problem' }] };
module.exports = { workerFixture, response, proof, configure, fields, optionsSender, problemSender, origin, payload };
