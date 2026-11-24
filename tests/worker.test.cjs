/*
 * NeetcodeTrackingExtension/ -> tests/ -> worker.test.cjs
 * Purpose: test worker credential isolation, PIN lifecycle and GitHub operations.
 * Agent skills: Chrome messaging and synthetic WebAuthn/HTTP boundary fixtures.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    workerFixture,
    response,
    proof,
    configure,
    fields,
    optionsSender,
    problemSender,
    payload,
} = require('./helpers/worker-harness.cjs');

test('settings messages reject content scripts, forged IDs and documents', async () => {
    const f = workerFixture();
    for (const sender of [
        problemSender,
        { ...optionsSender, id: 'other' },
        { ...optionsSender, url: optionsSender.url + '?forged' },
        { ...optionsSender, documentId: undefined },
    ]) {
        const r = await f.request({ type: 'GET_SETTINGS' }, sender);
        assert.equal(r.error.code, 'UNAUTHORIZED');
    }
    assert.equal(f.calls.length, 0);
});
test('storage access failures prevent credential writes and network', async () => {
    const f = workerFixture({
        access: async () => {
            throw new Error('synthetic storage failure');
        },
    });
    assert.equal(
        (await f.request({ type: 'SAVE_SETTINGS', settings: fields })).error.code,
        'STORAGE_UNAVAILABLE',
    );
    assert.equal(f.calls.length, 0);
    assert.equal(
        f.operations.some(op => op[0] === 'set'),
        false,
    );
});
test('Save persists encrypted settings locked until a separate explicit unlock', async () => {
    const f = workerFixture();
    const saved = await configure(f, false);
    assert.equal(saved.settings.hasToken, true);
    assert.equal(saved.settings.isUnlocked, false);
    assert.equal(JSON.stringify(saved).includes(fields.token), false);
    assert.equal(JSON.stringify(f.persisted.local).includes(fields.token), false);
    assert.equal(Object.keys(f.persisted.session).length, 0);
    const begin = await f.request({ type: 'BEGIN_VAULT_UNLOCK' });
    await f.request({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: await proof(f, begin.ceremony) });
    assert.equal(f.persisted.session.githubVaultSessionV1.token, fields.token);
    assert.equal(
        f.operations.slice(0, 2).every(op => op[0] === 'access'),
        true,
    );
});
test('lock, restart, PIN unlock and clear have distinct persistence effects', async () => {
    const f = workerFixture();
    await configure(f);
    const restarted = workerFixture({ persisted: f.persisted });
    assert.equal((await restarted.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, true);
    await restarted.request({ type: 'LOCK_VAULT' });
    assert.equal(Object.keys(f.persisted.session).length, 0);
    const begin = await restarted.request({ type: 'BEGIN_VAULT_UNLOCK' });
    const unlocked = await restarted.request({
        type: 'COMPLETE_VAULT_UNLOCK',
        unlockProof: await proof(restarted, begin.ceremony),
    });
    assert.equal(unlocked.settings.isUnlocked, true);
    await restarted.request({ type: 'CLEAR_SETTINGS' });
    assert.equal(Object.keys(f.persisted.local).length, 0);
    assert.equal(Object.keys(f.persisted.session).length, 0);
});
test('unlock proof is bound to challenge, origin, UV and document and consumed once', async () => {
    const f = workerFixture();
    await configure(f);
    await f.request({ type: 'LOCK_VAULT' });
    for (const mode of ['origin', 'challenge', 'uv', 'document']) {
        const begin = await f.request({ type: 'BEGIN_VAULT_UNLOCK' });
        const p = await proof(f, begin.ceremony);
        const v = f.evaluate('VaultCrypto');
        if (mode === 'uv') {
            const raw = v.unpack(p.authenticatorData);
            raw[32] = 1;
            p.authenticatorData = v.pack(raw);
        }
        if (mode === 'origin' || mode === 'challenge') {
            const client = JSON.parse(new TextDecoder().decode(v.unpack(p.clientDataJSON)));
            client[mode] = 'wrong';
            p.clientDataJSON = v.pack(new TextEncoder().encode(JSON.stringify(client)));
        }
        const result = await f.request(
            { type: 'COMPLETE_VAULT_UNLOCK', unlockProof: p },
            mode === 'document'
                ? { ...optionsSender, documentId: 'another-document' }
                : optionsSender,
        );
        assert.equal(result.ok, false);
        assert.equal((await f.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
    }
    const begin = await f.request({ type: 'BEGIN_VAULT_UNLOCK' });
    const p = await proof(f, begin.ceremony);
    assert.equal((await f.request({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: p })).ok, true);
    assert.equal((await f.request({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: p })).ok, false);
});
test('missing settings and locked vault block uploads before any network request', async () => {
    const f = workerFixture();
    assert.equal(
        (await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender)).error.code,
        'NOT_CONFIGURED',
    );
    await configure(f);
    await f.request({ type: 'LOCK_VAULT' });
    assert.equal(
        (await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender)).error.code,
        'VAULT_LOCKED',
    );
    assert.equal(f.calls.length, 0);
});
test('uploads create missing files sequentially and preserve UTF-8 and paths', async () => {
    const f = workerFixture({
        fetch: async (_url, init) => (init.method === 'GET' ? response(404) : response(201)),
    });
    await configure(f);
    const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    assert.equal(result.ok, true);
    assert.deepEqual(
        f.calls.map(c => c[1].method),
        ['GET', 'PUT', 'GET', 'PUT'],
    );
    const body = JSON.parse(f.calls[1][1].body);
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), 'café');
    assert.equal(body.message, 'Added two-sum on 2026-11-23');
    assert.equal('sha' in body, false);
    assert.ok(f.calls[1][0].endsWith('/Data%20Structures%20%26%20Algorithms/two-sum/solution.py'));
    assert.equal(JSON.stringify(result).includes(fields.token), false);
    assert.equal(f.calls[1][1].redirect, 'error');
});
test('updates supply existing SHA and return only safe metadata', async () => {
    const f = workerFixture({
        fetch: async (_url, init) =>
            response(
                200,
                init.method === 'GET' ? { sha: 'existing-sha' } : { secret: fields.token },
            ),
    });
    await configure(f);
    const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    assert.equal(result.updated, true);
    assert.equal(JSON.parse(f.calls[1][1].body).sha, 'existing-sha');
    assert.equal(JSON.stringify(result).includes(fields.token), false);
});
test('connection testing makes authenticated GET calls only and never saves candidates', async () => {
    const f = workerFixture();
    const result = await f.request({ type: 'TEST_CONNECTION', settings: fields });
    assert.equal(result.ok, true);
    assert.deepEqual(
        f.calls.map(c => c[1].method),
        ['GET', 'GET'],
    );
    assert.equal(f.calls[0][1].headers.Authorization, 'Bearer synthetic-token');
    assert.equal(Object.keys(f.persisted.local).length, 0);
    assert.match(result.message, /Write permission is not verified/);
});
test('arbitrary destinations, nested frames and traversal payloads are rejected', async () => {
    const f = workerFixture();
    await configure(f);
    for (const bad of [
        { ...payload, title: '../secret' },
        { ...payload, url: 'https://evil.invalid' },
        { ...payload, files: [{ kind: 'problem', extension: 'html', content: 'x' }] },
    ]) {
        assert.equal(
            (await f.request({ type: 'UPLOAD_PROBLEM', payload: bad }, problemSender)).error.code,
            'INVALID_UPLOAD',
        );
    }
    assert.equal(
        (await f.request({ type: 'UPLOAD_PROBLEM', payload }, { ...problemSender, frameId: 1 }))
            .error.code,
        'UNAUTHORIZED',
    );
    assert.equal(f.calls.length, 0);
});
for (const [status, code] of [
    [401, 'AUTH_FAILED'],
    [403, 'ACCESS_DENIED'],
    [409, 'CONFLICT'],
    [422, 'GITHUB_VALIDATION'],
]) {
    test(`GitHub ${status} is sanitized and stops the upload`, async () => {
        const f = workerFixture({ fetch: async () => response(status, { message: fields.token }) });
        await configure(f);
        const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
        assert.equal(result.error.code, code);
        assert.equal(f.calls.length, 1);
        assert.equal(JSON.stringify(result).includes(fields.token), false);
    });
}

for (const type of ['LOCK_VAULT', 'CLEAR_SETTINGS']) {
    test(`${type} cannot be superseded by a metadata save waiting on storage`, async () => {
        const f = workerFixture();
        await configure(f);
        const original = f.chrome.storage.local.get;
        let unblock;
        let entered;
        const waiting = new Promise(resolve => {
            entered = resolve;
        });
        let first = true;
        f.chrome.storage.local.get = async key => {
            if (first) {
                first = false;
                entered();
                await new Promise(resolve => {
                    unblock = resolve;
                });
            }
            return original(key);
        };
        const saving = f.request({
            type: 'SAVE_SETTINGS',
            settings: { ...fields, token: '' },
            expectedVersion: f.persisted.local.githubSettingsV2.recordGeneration,
        });
        await waiting;
        const locking = f.request({ type });
        unblock();
        assert.equal((await saving).ok, false);
        assert.equal((await locking).ok, true);
        const summary = (await f.request({ type: 'GET_SETTINGS' })).settings;
        assert.equal(Boolean(summary?.isUnlocked), false);
        if (type === 'CLEAR_SETTINGS') assert.equal(summary, null);
    });
}
test('lock aborts a stalled GitHub response body and completes session removal', async () => {
    let startBody;
    const bodyStarted = new Promise(resolve => {
        startBody = resolve;
    });
    const f = workerFixture({
        fetch: async (_url, init) => ({
            ...response(200),
            json: () => {
                startBody();
                return new Promise((_resolve, reject) =>
                    init.signal.addEventListener(
                        'abort',
                        () => reject(new Error('synthetic abort')),
                        { once: true },
                    ),
                );
            },
        }),
    });
    await configure(f);
    const uploading = f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    await bodyStarted;
    const lock = f.request({ type: 'LOCK_VAULT' });
    const outcome = await Promise.race([
        Promise.all([uploading, lock]),
        new Promise(resolve => setTimeout(() => resolve('stalled'), 100)),
    ]);
    assert.notEqual(outcome, 'stalled');
    assert.equal(outcome[0].error.code, 'SETTINGS_CHANGED');
    assert.equal(outcome[1].ok, true);
});
test('failed session removal cannot revive an old unlocked token after worker restart', async () => {
    const f = workerFixture();
    await configure(f);
    f.chrome.storage.session.remove = async () => {
        throw new Error('synthetic removal failure');
    };
    assert.equal((await f.request({ type: 'LOCK_VAULT' })).ok, false);
    const restarted = workerFixture({ persisted: f.persisted });
    assert.equal((await restarted.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
});
test('storage restrictions must finish before settings can be read or written', async () => {
    const release = [];
    const f = workerFixture({ access: () => new Promise(resolve => release.push(resolve)) });
    const pending = f.request({ type: 'GET_SETTINGS' });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
        f.operations.some(op => op[0] === 'get'),
        false,
    );
    release.forEach(resolve => resolve());
    assert.equal((await pending).ok, true);
});
test('expired unlock requests are rejected without changing locked state', async () => {
    const f = workerFixture();
    await configure(f);
    await f.request({ type: 'LOCK_VAULT' });
    const begin = await f.request({ type: 'BEGIN_VAULT_UNLOCK' });
    const p = await proof(f, begin.ceremony);
    f.evaluate('Date.now = () => 9999999999999');
    assert.equal(
        (await f.request({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: p })).error.code,
        'INVALID_UNLOCK_PROOF',
    );
    assert.equal((await f.request({ type: 'GET_SETTINGS' })).settings.isUnlocked, false);
});
test('partial upload reports saved solution and stops after problem failure', async () => {
    let count = 0;
    const f = workerFixture({
        fetch: async () => {
            count++;
            return count === 1 ? response(404) : count === 2 ? response(201) : response(403);
        },
    });
    await configure(f);
    const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ACCESS_DENIED');
    assert.deepEqual(
        Array.from(result.files, file => file.kind),
        ['solution'],
    );
    assert.equal(f.calls.length, 3);
});
test('timeout terminates a stalled network operation with a safe error', async () => {
    let expire;
    let start;
    const started = new Promise(resolve => {
        start = resolve;
    });
    const f = workerFixture({
        globals: {
            setTimeout(fn) {
                expire = fn;
                return 1;
            },
            clearTimeout() {},
        },
        fetch: () => {
            start();
            return new Promise(() => {});
        },
    });
    await configure(f);
    const pending = f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    await started;
    expire();
    assert.equal((await pending).error.code, 'TIMEOUT');
});
test('network failures and rate limits never disclose request or response secrets', async () => {
    for (const mode of ['network', 'rate']) {
        const f = workerFixture({
            fetch: async () => {
                if (mode === 'network') throw new Error(fields.token);
                return {
                    ...response(403, { token: fields.token }),
                    headers: { get: name => (name === 'x-ratelimit-remaining' ? '0' : null) },
                };
            },
        });
        await configure(f);
        const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
        assert.equal(result.error.code, mode === 'network' ? 'NETWORK_ERROR' : 'RATE_LIMITED');
        assert.equal(
            JSON.stringify([result, f.logs, f.sent, f.persisted.local]).includes(fields.token),
            false,
        );
    }
});
test('new installation opens settings; updates retain settings without opening a tab', async () => {
    const f = workerFixture();
    f.chrome.runtime.onInstalled.fire({ reason: 'update' });
    assert.equal(
        f.operations.some(op => op[0] === 'openOptions'),
        false,
    );
    f.chrome.runtime.onInstalled.fire({ reason: 'install' });
    assert.equal(
        f.operations.some(op => op[0] === 'openOptions'),
        true,
    );
});
test('a delayed unlock ceremony request cannot survive a later Lock', async () => {
    const f = workerFixture();
    await configure(f);
    const original = f.chrome.storage.local.get;
    let release;
    let start;
    const started = new Promise(resolve => {
        start = resolve;
    });
    let first = true;
    f.chrome.storage.local.get = async key => {
        if (first) {
            first = false;
            start();
            await new Promise(resolve => {
                release = resolve;
            });
        }
        return original(key);
    };
    const beginning = f.request({ type: 'BEGIN_VAULT_UNLOCK' });
    await started;
    const locking = f.request({ type: 'LOCK_VAULT' });
    release();
    assert.equal((await beginning).ok, false);
    assert.equal((await locking).ok, true);
});
for (const type of ['LOCK_VAULT', 'CLEAR_SETTINGS']) {
    test(`${type} removes session even if durable storage update fails`, async () => {
        const f = workerFixture();
        await configure(f);
        f.chrome.storage.local.set = async () => {
            throw new Error('synthetic durable failure');
        };
        f.chrome.storage.local.remove = async () => {
            throw new Error('synthetic durable failure');
        };
        assert.equal((await f.request({ type })).ok, false);
        assert.equal(Object.keys(f.persisted.session).length, 0);
        const restarted = workerFixture({ persisted: f.persisted });
        assert.equal(
            (await restarted.request({ type: 'GET_SETTINGS' })).settings.isUnlocked,
            false,
        );
    });
}
test('Save refuses public fields from an outdated settings generation', async () => {
    const f = workerFixture();
    await configure(f);
    const result = await f.request({
        type: 'SAVE_SETTINGS',
        settings: { ...fields, token: '', repoName: 'stale-repo' },
        expectedVersion: 'stale-version',
    });
    assert.equal(result.error.code, 'SETTINGS_CHANGED');
    assert.equal(f.persisted.local.githubSettingsV2.repoName, fields.repoName);
});
test('extraction begun before Lock cannot upload after a later unlock', async () => {
    const f = workerFixture();
    await configure(f);
    await f.chrome.action.onClicked.fire({ id: 7, url: problemSender.url });
    const uploadTicket = f.sent.at(-1)[1].uploadTicket;
    await f.request({ type: 'LOCK_VAULT' });
    const begin = await f.request({ type: 'BEGIN_VAULT_UNLOCK' });
    await f.request({ type: 'COMPLETE_VAULT_UNLOCK', unlockProof: await proof(f, begin.ceremony) });
    const result = await f.request(
        { type: 'UPLOAD_PROBLEM', payload, uploadTicket },
        problemSender,
    );
    assert.equal(result.error.code, 'SETTINGS_CHANGED');
    assert.equal(f.calls.length, 0);
});
test('already saved v2 vaults remain usable when record generation is introduced', async () => {
    const f = workerFixture();
    await configure(f);
    delete f.persisted.local.githubSettingsV2.recordGeneration;
    const restarted = workerFixture({ persisted: f.persisted });
    const summary = (await restarted.request({ type: 'GET_SETTINGS' })).settings;
    assert.equal(summary.isUnlocked, true);
    assert.equal(summary.recordGeneration, f.persisted.local.githubSettingsV2.sessionGeneration);
    await restarted.request({ type: 'LOCK_VAULT' });
    const begin = await restarted.request({ type: 'BEGIN_VAULT_UNLOCK' });
    assert.equal(
        (
            await restarted.request({
                type: 'COMPLETE_VAULT_UNLOCK',
                unlockProof: await proof(restarted, begin.ceremony),
            })
        ).ok,
        true,
    );
});
test('Save never writes a session token and reports that it is locked', async () => {
    const f = workerFixture({
        set: async name => {
            if (name === 'session') throw new Error('synthetic session failure');
        },
    });
    const begin = await f.request({ type: 'BEGIN_VAULT_SETUP' });
    const result = await f.request({
        type: 'SAVE_SETTINGS',
        settings: fields,
        unlockProof: await proof(f, begin.ceremony),
    });
    assert.equal(result.ok, true);
    assert.equal(result.settings.isUnlocked, false);
    assert.match(result.message, /locked/);
    assert.equal(
        f.operations.some(op => op[0] === 'set' && op[1] === 'session'),
        false,
    );
    assert.equal(JSON.stringify(f.persisted.local).includes(fields.token), false);
});
test('upload tickets cannot be replayed or moved to another tab', async () => {
    const f = workerFixture({
        fetch: async (_url, init) => (init.method === 'GET' ? response(404) : response(201)),
    });
    await configure(f);
    await f.chrome.action.onClicked.fire({ id: 7, url: problemSender.url });
    const uploadTicket = f.sent.at(-1)[1].uploadTicket;
    assert.equal(
        (
            await f.request(
                { type: 'UPLOAD_PROBLEM', payload, uploadTicket },
                { ...problemSender, tab: { id: 8 } },
            )
        ).error.code,
        'SETTINGS_CHANGED',
    );
    assert.equal(
        (await f.request({ type: 'UPLOAD_PROBLEM', payload, uploadTicket }, problemSender)).ok,
        true,
    );
    const count = f.calls.length;
    assert.equal(
        (await f.request({ type: 'UPLOAD_PROBLEM', payload, uploadTicket }, problemSender)).error
            .code,
        'SETTINGS_CHANGED',
    );
    assert.equal(f.calls.length, count);
});
test('SPA navigation from roadmap to problem accepts a trusted top-frame sender', async () => {
    const f = workerFixture({
        fetch: async (_url, init) => (init.method === 'GET' ? response(404) : response(201)),
    });
    await configure(f);
    const url = 'https://neetcode.io/problems/rotate-matrix/question';
    await f.chrome.action.onClicked.fire({ id: 7, url });
    const uploadTicket = f.sent.at(-1)[1].uploadTicket;
    const sender = {
        ...problemSender,
        url: 'https://neetcode.io/roadmap',
        origin: 'https://neetcode.io',
        tab: { id: 7, url },
    };
    assert.equal(
        (await f.request({ type: 'UPLOAD_PROBLEM', payload, uploadTicket }, sender)).ok,
        true,
    );
    assert.equal((await f.request({ type: 'OPEN_SETTINGS' }, sender)).ok, true);
});
test('SPA route validation still rejects foreign document origins and nonproblem tabs', async () => {
    const f = workerFixture();
    const url = 'https://neetcode.io/problems/rotate-matrix/question';
    for (const sender of [
        { ...problemSender, url: 'https://evil.invalid/', tab: { id: 7, url } },
        { ...problemSender, origin: 'https://evil.invalid', tab: { id: 7, url } },
        { ...problemSender, tab: { id: 7, url: 'https://neetcode.io/roadmap' } },
    ]) {
        assert.equal(
            (await f.request({ type: 'OPEN_SETTINGS' }, sender)).error.code,
            'UNAUTHORIZED',
        );
    }
});

test('repeat saves preserve existing Markdown notes, front matter and creation date without a PUT', async () => {
    const existing =
        '---\ncreated: 2020-01-01\ntags: [custom]\n---\n## Notes\nMy synthetic notes\n---\nOriginal description';
    const f = workerFixture({
        fetch: async (url, init) => {
            if (init.method === 'GET') {
                return response(200, {
                    sha: 'existing-sha',
                    encoding: 'base64',
                    content: Buffer.from(existing).toString('base64'),
                });
            }
            assert.ok(url.endsWith('/solution.py'), 'Existing problem.md must never be written');
            return response(200);
        },
    });
    await configure(f);
    const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    assert.equal(result.ok, true);
    assert.deepEqual(
        f.calls.map(call => call[1].method),
        ['GET', 'PUT', 'GET'],
    );
    assert.equal(result.files.find(file => file.kind === 'problem').skipped, true);
    const onlyProblem = {
        ...payload,
        files: payload.files.filter(file => file.kind === 'problem'),
    };
    const again = await f.request({ type: 'UPLOAD_PROBLEM', payload: onlyProblem }, problemSender);
    assert.equal(again.ok, true);
    assert.equal(again.files[0].skipped, true);
    assert.equal(f.calls.at(-1)[1].method, 'GET');
});

test('worker accepts every mapped extension and rejects unknown or unsafe file types', () => {
    const { contentFixture } = require('./helpers/extension-harness.cjs');
    const content = contentFixture();
    const f = workerFixture();
    const labels = [
        'Python',
        'JavaScript',
        'TypeScript',
        'Java',
        'C++',
        'C',
        'C#',
        'Go',
        'Rust',
        'Kotlin',
        'Swift',
        'Ruby',
        'PHP',
        'Scala',
        'Dart',
        'Racket',
        'Elixir',
        'Erlang',
        'F#',
        'R',
        'Perl',
        'Haskell',
        'Lua',
        'Bash',
        'SQL',
    ];
    for (const label of labels) {
        const extension = content.context.getLanguage(label);
        assert.doesNotThrow(() =>
            f.context.validateUploadPayload({
                ...payload,
                files: [
                    { kind: 'solution', extension, content: 'synthetic code' },
                    { kind: 'problem', extension: 'md', content: 'synthetic problem' },
                ],
            }),
        );
    }
    for (const extension of ['unknown', 'exe', '../py', null]) {
        assert.throws(
            () =>
                f.context.validateUploadPayload({
                    ...payload,
                    files: [
                        { kind: 'solution', extension, content: 'synthetic code' },
                        { kind: 'problem', extension: 'md', content: 'synthetic problem' },
                    ],
                }),
            error => error.publicCode === 'INVALID_UPLOAD',
        );
    }
});
