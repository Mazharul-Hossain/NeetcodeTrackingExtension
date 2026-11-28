/*
 * NeetcodeTrackingExtension/ -> tests/ -> background.test.cjs
 * Purpose: characterize per-tab submission capture and manual trigger routing.
 * Agent skills: Node test runner and Chrome webRequest messaging.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { backgroundFixture } = require('./helpers/extension-harness.cjs');
const { configure } = require('./helpers/worker-harness.cjs');

function capture(fixture, tabId, title, code, language = 'Python') {
    fixture.chrome.webRequest.onBeforeRequest.fire({
        tabId,
        frameId: 0,
        documentId: 'synthetic-problem-document',
        url: 'https://neetcode.io/api/executeCodeFunctionHttp',
        requestBody: {
            raw: [
                {
                    bytes: new TextEncoder().encode(
                        JSON.stringify({ data: { problemId: title, rawCode: code, language } }),
                    ).buffer,
                },
            ],
        },
    });
}

function beginSync(fixture, tabId, requestId = `sync-${tabId}`, functionId = 'commitToGitHub') {
    const pending = fixture.evaluate(`pendingCodeByTab[${tabId}]`);
    fixture.chrome.webRequest.onBeforeRequest.fire({
        tabId,
        requestId,
        frameId: 0,
        documentId: 'synthetic-problem-document',
        url: 'https://neetcode.io/api/githubFunctionHttp',
        method: 'POST',
        requestBody: {
            raw: [
                {
                    bytes: new TextEncoder().encode(
                        JSON.stringify({
                            data: { functionId, problemId: pending?.title, code: pending?.code },
                        }),
                    ).buffer,
                },
            ],
        },
    });
    return requestId;
}

function completeSync(fixture, tabId, requestId, statusCode = 200) {
    return fixture.chrome.webRequest.onCompleted.fire({
        tabId,
        requestId,
        frameId: 0,
        documentId: 'synthetic-problem-document',
        url: 'https://neetcode.io/api/githubFunctionHttp',
        statusCode,
    });
}

function release(fixture, tabId, statusCode = 200) {
    return completeSync(fixture, tabId, beginSync(fixture, tabId), statusCode);
}

test('a same-document loading signal cannot invalidate a pending tab URL lookup', async () => {
    const f = backgroundFixture();
    await configure(f);
    let resolveTab;
    const pageUrl = 'https://neetcode.io/problems/two-sum/question';
    f.chrome.tabs.get = () =>
        new Promise(resolve => {
            resolveTab = resolve;
        });
    capture(f, 7, 'two-sum', 'synthetic submission');
    const captureUrl = f.evaluate('pendingCodeByTab[7].pageUrl');
    f.chrome.tabs.onUpdated.fire(7, { status: 'loading' });
    resolveTab({ id: 7, url: pageUrl });
    await captureUrl;
    await release(f, 7);
    assert.equal(f.sent.find(args => args[1].type === 'CODE_DATA')?.[1].pageUrl, pageUrl);
});

test('a delayed initial lookup preserves one provable same-problem transition', async () => {
    for (const associateFirst of [false, true]) {
        for (const lookupUrl of [
            'https://neetcode.io/problems/plus-one/history?submissionIndex=2',
            'https://neetcode.io/problems/plus-one/history?submissionIndex=3',
            'https://neetcode.io/problems/other-problem/history?submissionIndex=2',
        ]) {
            const f = backgroundFixture();
            await configure(f);
            let resolveTab;
            f.chrome.tabs.get = () =>
                new Promise(resolve => {
                    resolveTab = resolve;
                });
            capture(f, 7, 'backend-plus-one', 'synthetic submission');
            const pending = f.evaluate('pendingCodeByTab[7]');
            if (associateFirst) beginSync(f, 7);
            const destination = 'https://neetcode.io/problems/plus-one/history?submissionIndex=3';
            f.chrome.tabs.onUpdated.fire(7, { url: destination });
            resolveTab({ id: 7, url: lookupUrl });
            await pending.pageUrl;
            if (!associateFirst) beginSync(f, 7);
            await completeSync(f, 7, 'sync-7');
            const saved = f.sent.find(args => args[1].type === 'CODE_DATA')?.[1];
            assert.equal(!!saved, lookupUrl.endsWith('plus-one/history?submissionIndex=2'));
            if (saved) assert.equal(saved.pageUrl, destination);
        }
    }
});

test('a real document navigation rejects an unresolved initial lookup', async () => {
    for (const associateFirst of [false, true]) {
        const f = backgroundFixture();
        await configure(f);
        let resolveTab;
        const url = 'https://neetcode.io/problems/two-sum/question';
        f.chrome.tabs.get = () =>
            new Promise(resolve => {
                resolveTab = resolve;
            });
        capture(f, 7, 'two-sum', 'synthetic submission');
        const pending = f.evaluate('pendingCodeByTab[7]');
        if (associateFirst) beginSync(f, 7);
        f.chrome.webRequest.onBeforeRequest.fire({ tabId: 7, frameId: 0, type: 'main_frame', url });
        resolveTab({ id: 7, url });
        await pending.pageUrl;
        if (!associateFirst) beginSync(f, 7);
        await completeSync(f, 7, 'sync-7');
        assert.equal(
            f.sent.some(args => args[1].type === 'CODE_DATA'),
            false,
        );
    }
});

test('multiple unresolved URL transitions remain ambiguous and cannot save', async () => {
    const f = backgroundFixture();
    await configure(f);
    let resolveTab;
    f.chrome.tabs.get = () =>
        new Promise(resolve => {
            resolveTab = resolve;
        });
    capture(f, 7, 'backend-plus-one', 'synthetic submission');
    const pending = f.evaluate('pendingCodeByTab[7]');
    for (const index of [3, 4]) {
        f.chrome.tabs.onUpdated.fire(7, {
            url: `https://neetcode.io/problems/plus-one/history?submissionIndex=${index}`,
        });
    }
    resolveTab({ id: 7, url: 'https://neetcode.io/problems/plus-one/history?submissionIndex=2' });
    await pending.pageUrl;
    await release(f, 7);
    assert.equal(
        f.sent.some(args => args[1].type === 'CODE_DATA'),
        false,
    );
});

test('automatic capture survives the observed submission results URL transition', async () => {
    for (const beforeSync of [true, false]) {
        const f = backgroundFixture();
        await configure(f);
        let pageUrl = 'https://neetcode.io/problems/plus-one/history?submissionIndex=2';
        f.chrome.tabs.get = async id => ({ id, url: pageUrl });
        capture(f, 7, 'backend-plus-one', 'synthetic submitted code');
        await f.evaluate('pendingCodeByTab[7].pageUrl');
        f.chrome.tabs.onUpdated.fire(7, { status: 'loading' });
        if (!beforeSync) beginSync(f, 7);
        pageUrl = 'https://neetcode.io/problems/plus-one/history?submissionIndex=3';
        f.chrome.tabs.onUpdated.fire(7, { url: pageUrl });
        if (beforeSync) beginSync(f, 7);
        await completeSync(f, 7, 'sync-7');
        const saved = f.sent.find(args => args[1].type === 'CODE_DATA')?.[1];
        assert.equal(saved?.code, 'synthetic submitted code');
        assert.equal(saved.pageUrl, pageUrl);
    }
});

test('question-to-history navigation preserves only the matching submitted-code commit', async () => {
    const f = backgroundFixture();
    await configure(f);
    let pageUrl = 'https://neetcode.io/problems/plus-one/question?list=practice';
    f.chrome.tabs.get = async id => ({ id, url: pageUrl });
    capture(f, 7, 'backend-plus-one', 'synthetic submission');
    await f.evaluate('pendingCodeByTab[7].pageUrl');
    pageUrl = 'https://neetcode.io/problems/plus-one/history?list=practice&submissionIndex=3';
    f.chrome.tabs.onUpdated.fire(7, { url: pageUrl });
    for (const data of [
        { problemId: 'other-problem', code: 'synthetic submission' },
        { problemId: 'backend-plus-one', code: 'other submission' },
    ]) {
        f.chrome.webRequest.onBeforeRequest.fire({
            tabId: 7,
            frameId: 0,
            documentId: 'synthetic-problem-document',
            requestId: 'unrelated',
            method: 'POST',
            url: 'https://neetcode.io/api/githubFunctionHttp',
            requestBody: {
                raw: [
                    {
                        bytes: new TextEncoder().encode(
                            JSON.stringify({ data: { functionId: 'commitToGitHub', ...data } }),
                        ).buffer,
                    },
                ],
            },
        });
        await completeSync(f, 7, 'unrelated');
        assert.equal(f.sent.length, 0);
    }
    await release(f, 7);
    assert.equal(f.sent.at(-1)[1].pageUrl, pageUrl);
});

test('leaving a problem and returning cannot revive its capture', async () => {
    const f = backgroundFixture();
    await configure(f);
    const pageUrl = 'https://neetcode.io/problems/plus-one/question';
    f.chrome.tabs.get = async id => ({ id, url: pageUrl });
    capture(f, 7, 'backend-plus-one', 'synthetic code');
    await f.evaluate('pendingCodeByTab[7].pageUrl');
    f.chrome.tabs.onUpdated.fire(7, { url: 'https://neetcode.io/problems/two-sum/question' });
    f.chrome.tabs.onUpdated.fire(7, { url: pageUrl });
    await release(f, 7);
    assert.equal(
        f.sent.some(args => args[1].type === 'CODE_DATA'),
        false,
    );
});

test('rejected route bindings release the stored solution from pending memory', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'synthetic submission');
    const pending = f.evaluate('pendingCodeByTab[7]');
    await pending.pageUrl;
    f.chrome.tabs.onUpdated.fire(7, { url: 'https://neetcode.io/problems/other-problem/question' });
    await pending.pageUrl;
    assert.equal(f.evaluate('pendingCodeByTab[7]'), undefined);
});

test('cancelled route cleanup cannot discard a newer problem submission', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'older synthetic submission');
    const oldCapture = f.evaluate('pendingCodeByTab[7]');
    await oldCapture.pageUrl;
    const nextUrl = 'https://neetcode.io/problems/other-problem/question';
    f.chrome.tabs.onUpdated.fire(7, { url: nextUrl });
    f.chrome.tabs.get = async id => ({ id, url: nextUrl });
    capture(f, 7, 'other-problem', 'newer synthetic submission');
    await oldCapture.pageUrl;
    await release(f, 7);
    const saved = f.sent.find(args => args[1].type === 'CODE_DATA')?.[1];
    assert.equal(saved?.code, 'newer synthetic submission');
    assert.equal(saved.pageUrl, nextUrl);
});

test('automatic submission rebinding rejects other problems, query changes and document loads', async () => {
    const oldUrl = 'https://neetcode.io/problems/plus-one/question?list=practice';
    for (const change of [
        { url: 'https://neetcode.io/problems/two-sum/history?list=practice&submissionIndex=3' },
        { url: 'https://neetcode.io/problems/plus-one/history?list=other&submissionIndex=3' },
        { url: 'https://neetcode.io/problems/plus-one/history?list=practice&submissionIndex=bad' },
        { url: 'https://neetcode.io/problems/plus-one/discuss?list=practice' },
    ]) {
        const f = backgroundFixture();
        await configure(f);
        f.chrome.tabs.get = async id => ({ id, url: oldUrl });
        capture(f, 7, 'backend-plus-one', 'synthetic code');
        await f.evaluate('pendingCodeByTab[7].pageUrl');
        f.chrome.tabs.onUpdated.fire(7, change);
        await release(f, 7);
        assert.equal(
            f.sent.some(args => args[1].type === 'CODE_DATA'),
            false,
        );
    }
});

test('a real document navigation discards captures despite the same problem URL', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'synthetic submission');
    f.chrome.webRequest.onBeforeRequest.fire({
        tabId: 7,
        frameId: 0,
        type: 'main_frame',
        url: 'https://neetcode.io/problems/two-sum',
    });
    await release(f, 7);
    assert.equal(
        f.sent.some(args => args[1].type === 'CODE_DATA'),
        false,
    );
});

test('automatic commit and upload ticket cannot cross document boundaries', async () => {
    const { problemSender, payload } = require('./helpers/worker-harness.cjs');
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'synthetic submission');
    f.chrome.webRequest.onBeforeRequest.fire({
        tabId: 7,
        frameId: 0,
        documentId: 'replacement-document',
        requestId: 'wrong-document',
        method: 'POST',
        url: 'https://neetcode.io/api/githubFunctionHttp',
        requestBody: {
            raw: [
                {
                    bytes: new TextEncoder().encode(
                        JSON.stringify({
                            data: {
                                functionId: 'commitToGitHub',
                                problemId: 'two-sum',
                                code: 'synthetic submission',
                            },
                        }),
                    ).buffer,
                },
            ],
        },
    });
    await completeSync(f, 7, 'wrong-document');
    assert.equal(f.sent.length, 0);
    await release(f, 7);
    const saved = f.sent.at(-1)[1];
    const result = await f.request(
        { type: 'UPLOAD_PROBLEM', uploadTicket: saved.uploadTicket, payload },
        { ...problemSender, documentId: 'replacement-document' },
    );
    assert.equal(result.error.code, 'PAGE_CHANGED');
    assert.equal(f.calls.length, 0);
});

test('GitHub status and settings requests cannot consume a submission or trigger a save', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'synthetic submission');
    for (const operation of [
        'getGitHubStatus',
        'getSyncStatus',
        'updateGitHubPreferences',
        'syncSubmission',
    ]) {
        const requestId = beginSync(f, 7, operation, operation);
        await completeSync(f, 7, requestId);
        assert.equal(f.sent.length, 0, operation);
    }
    await release(f, 7);
    assert.equal(f.sent.filter(args => args[1].type === 'CODE_DATA').length, 1);
});

test('unreadable and non-POST GitHub requests leave the submission for its actual commit', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'synthetic submission');
    for (const extra of [
        { method: 'OPTIONS' },
        { method: 'GET' },
        { method: 'POST' },
        { method: 'POST', requestBody: { raw: [{ bytes: new TextEncoder().encode('{').buffer }] } },
        { method: 'POST', requestBody: { raw: [{ file: 'unreadable' }] } },
        { method: 'POST', requestBody: { raw: [{ bytes: new Uint8Array(2097153).buffer }] } },
    ]) {
        f.chrome.webRequest.onBeforeRequest.fire({
            tabId: 7,
            requestId: 'ignored',
            url: 'https://neetcode.io/api/githubFunctionHttp',
            ...extra,
        });
        await completeSync(f, 7, 'ignored');
        assert.equal(f.sent.length, 0);
    }
    await release(f, 7);
    assert.equal(f.sent.at(-1)[1].code, 'synthetic submission');
});

test('sync completion delivers its own captured submission rather than a later run', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'submitted A', 'Python');
    const first = beginSync(f, 7, 'sync-A');
    capture(f, 7, 'two-sum', 'unsubmitted B', 'JavaScript');
    await completeSync(f, 7, first);
    const saved = f.sent.find(args => args[1].type === 'CODE_DATA')[1];
    assert.equal(saved.code, 'submitted A');
    assert.equal(saved.language, 'Python');
});

test('out-of-order sync responses cannot replace a newer successful submission', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'submitted A', 'Python');
    beginSync(f, 7, 'sync-A');
    capture(f, 7, 'two-sum', 'submitted B', 'JavaScript');
    beginSync(f, 7, 'sync-B');
    await completeSync(f, 7, 'sync-B');
    await completeSync(f, 7, 'sync-A');
    assert.deepEqual(
        f.sent
            .filter(args => args[1].type === 'CODE_DATA')
            .map(args => [args[1].code, args[1].language]),
        [['submitted B', 'JavaScript']],
    );
});

test('a failed older sync does not discard the next captured execution', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'A');
    beginSync(f, 7, 'sync-A');
    capture(f, 7, 'two-sum', 'B');
    await completeSync(f, 7, 'sync-A', 500);
    await release(f, 7);
    assert.deepEqual(
        f.sent.filter(args => args[1].type === 'CODE_DATA').map(args => args[1].code),
        ['B'],
    );
});

test('failed or cancelled sync requests are discarded without replay', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'A');
    beginSync(f, 7, 'sync-A');
    f.chrome.webRequest.onErrorOccurred.fire({ requestId: 'sync-A' });
    await completeSync(f, 7, 'sync-A');
    assert.equal(f.sent.length, 0);
    capture(f, 7, 'two-sum', 'B');
    beginSync(f, 7, 'sync-B');
    await f.request({ type: 'LOCK_VAULT' });
    await completeSync(f, 7, 'sync-B');
    assert.equal(f.sent.length, 0);
});

async function assertTabRouting(transform) {
    const f = backgroundFixture(transform);
    await configure(f);
    capture(f, 1, 'one', 'code one');
    capture(f, 2, 'two', 'code two');
    await release(f, 2);
    await release(f, 1);
    assert.deepEqual(
        f.sent.filter(args => args[1].type === 'CODE_DATA').map(args => [args[0], args[1].code]),
        [
            [2, 'code two'],
            [1, 'code one'],
        ],
    );
    await release(f, 1);
    assert.equal(f.sent.length, 4, 'Readiness probes and code are sent once per tab');
}

test('captured code stays with its tab and is released only once', () => assertTabRouting());
test('capture routing characterization detects a wrong-tab mutation', async () => {
    await assert.rejects(
        assertTabRouting(source =>
            source.replace('chrome.tabs.sendMessage(tabId,', 'chrome.tabs.sendMessage(999,'),
        ),
        assert.AssertionError,
    );
    await assertTabRouting();
});
test('no pending capture, negative tabs and malformed requests cause no message', async () => {
    const f = backgroundFixture();
    await release(f, 9);
    capture(f, -1, 'ignored', 'code');
    await release(f, -1);
    f.chrome.webRequest.onBeforeRequest.fire({
        tabId: 1,
        url: 'executeCodeFunctionHttp',
        requestBody: { raw: [] },
    });
    assert.equal(f.sent.length, 0);
});
test('locked automatic trigger shows feedback without starting extraction', async () => {
    const f = backgroundFixture();
    await configure(f);
    await f.request({ type: 'LOCK_VAULT' });
    capture(f, 1, 'one', 'code');
    await release(f, 1);
    assert.equal(f.sent[0][1].type, 'SAVE_BLOCKED');
    assert.equal(f.sent[0][1].error.code, 'VAULT_LOCKED');
});
test('unconfigured toolbar opens settings instead of attempting an upload', async () => {
    const f = backgroundFixture();
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://neetcode.io/problems/two-sum' });
    assert.equal(f.sent.length, 0);
    assert.equal(
        f.operations.some(op => op[0] === 'openOptions'),
        true,
    );
});
test('configured toolbar opens settings when current tab is not a NeetCode problem', async () => {
    const f = backgroundFixture();
    await configure(f);
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://example.invalid/' });
    assert.equal(f.sent.length, 0);
    assert.equal(
        f.operations.some(op => op[0] === 'openOptions'),
        true,
    );
});
test('failed receiver recovery opens settings with a safe actionable explanation', async () => {
    const f = backgroundFixture();
    await configure(f);
    f.chrome.tabs.sendMessage = async () => {
        throw new Error('Synthetic receiver unavailable');
    };
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://neetcode.io/problems/two-sum' });
    assert.equal(
        f.operations.some(op => op[0] === 'openOptions'),
        true,
    );
    assert.match(
        (await f.request({ type: 'GET_SETTINGS' })).notice,
        /Could not connect to the NeetCode page/,
    );
});

test('toolbar reconnects a missing receiver without refreshing the page or replaying saves', async () => {
    const f = backgroundFixture();
    await configure(f);
    let ready = false;
    const events = [];
    f.chrome.tabs.sendMessage = async (tabId, message, target) => {
        events.push(message.type);
        assert.equal(tabId, 5);
        assert.equal(target.frameId, 0);
        if (!ready) throw new Error('Receiving end does not exist');
        if (message.type === 'PAGE_READY') return { ready: true };
        assert.equal(message.type, 'MANUAL_TRIGGER');
        return { accepted: true };
    };
    f.chrome.scripting = {
        async executeScript(spec) {
            assert.equal(spec.target.tabId, 5);
            assert.deepEqual(Array.from(spec.target.frameIds), [0]);
            assert.deepEqual(Array.from(spec.files), ['content-script.js']);
            assert.equal(spec.world, 'ISOLATED');
            events.push('inject');
            ready = true;
        },
    };
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://neetcode.io/problems/two-sum' });
    assert.deepEqual(events, ['PAGE_READY', 'inject', 'PAGE_READY', 'MANUAL_TRIGGER']);
    assert.equal(
        f.operations.some(op => op[0] === 'openOptions'),
        false,
    );
});

test('ready receiver needs no injection; a failed save delivery is never replayed', async () => {
    const f = backgroundFixture();
    await configure(f);
    const types = [];
    f.chrome.scripting = {
        async executeScript() {
            assert.fail('Already connected');
        },
    };
    f.chrome.tabs.sendMessage = async (_tab, message) => {
        types.push(message.type);
        if (message.type === 'PAGE_READY') return { ready: true };
        throw new Error('Port closed after delivery');
    };
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://neetcode.io/problems/two-sum' });
    assert.deepEqual(types, ['PAGE_READY', 'MANUAL_TRIGGER']);
});

test('locked vault and unrelated pages never inject page scripts', async () => {
    const f = backgroundFixture();
    await configure(f, false);
    f.chrome.scripting = {
        async executeScript() {
            assert.fail('Must not inject');
        },
    };
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://neetcode.io/problems/two-sum' });
    assert.equal(f.sent.length, 0);
    assert.match((await f.request({ type: 'GET_SETTINGS' })).notice, /unlock/);
    await f.chrome.action.onClicked.fire({ id: 5, url: 'https://example.invalid/' });
    assert.equal(f.sent.length, 0);
});

test('navigation during recovery invalidates the clicked problem upload ticket', async () => {
    const { problemSender, payload } = require('./helpers/worker-harness.cjs');
    const f = backgroundFixture();
    await configure(f);
    const pageUrl = 'https://neetcode.io/problems/two-sum';
    f.chrome.tabs.sendMessage = async (_tab, message) => {
        if (message.type === 'PAGE_READY') {
            f.chrome.tabs.onUpdated.fire(7, { url: 'https://neetcode.io/problems/spiral-matrix' });
            return { ready: true };
        }
        assert.equal(message.pageUrl, pageUrl);
        const result = await f.request(
            { type: 'UPLOAD_PROBLEM', payload, uploadTicket: message.uploadTicket },
            problemSender,
        );
        assert.equal(result.error.code, 'SETTINGS_CHANGED');
        return { accepted: false, reason: 'PAGE_CHANGED' };
    };
    await f.chrome.action.onClicked.fire({ id: 7, url: pageUrl });
    assert.equal(f.calls.length, 0);
    assert.match((await f.request({ type: 'GET_SETTINGS' })).notice, /page changed/);
});

test('automatic trigger cannot issue a fresh ticket after navigation during storage access', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'code from first problem');
    let resume;
    const started = new Promise(resolve => {
        const original = f.chrome.storage.local.get;
        f.chrome.storage.local.get = async key => {
            f.chrome.storage.local.get = original;
            resolve();
            await new Promise(done => {
                resume = done;
            });
            return original(key);
        };
    });
    const releasing = release(f, 7);
    await started;
    f.chrome.tabs.onUpdated.fire(7, { url: 'https://neetcode.io/problems/spiral-matrix' });
    resume();
    await releasing;
    assert.equal(
        f.sent.some(args => args[1].type === 'CODE_DATA'),
        false,
    );
    assert.equal(f.calls.length, 0);
});

test('automatic ticket cannot upload captured code under a different current problem', async () => {
    const { problemSender, payload } = require('./helpers/worker-harness.cjs');
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'code from two-sum');
    await release(f, 7);
    const uploadTicket = f.sent.at(-1)[1].uploadTicket;
    const result = await f.request(
        { type: 'UPLOAD_PROBLEM', uploadTicket, payload },
        {
            ...problemSender,
            tab: { id: 7, url: 'https://neetcode.io/problems/spiral-matrix/question' },
        },
    );
    assert.equal(result.error.code, 'PAGE_CHANGED');
    assert.equal(f.calls.length, 0);
});

test('automatic capture uses the actual tab URL even when backend problem ID differs', async () => {
    const f = backgroundFixture();
    await configure(f);
    const pageUrl = 'https://neetcode.io/problems/two-integer-sum/question?list=neetcode150';
    f.chrome.tabs.get = async id => ({ id, url: pageUrl });
    capture(f, 7, 'backend-id-123', 'solution');
    await release(f, 7);
    assert.equal(f.sent.at(-1)[1].type, 'CODE_DATA');
    assert.equal(f.sent.at(-1)[1].pageUrl, pageUrl);
});

test('navigation while resolving the capture URL cannot trigger extraction on the next page', async () => {
    const f = backgroundFixture();
    await configure(f);
    let resume;
    f.chrome.tabs.get = () =>
        new Promise(resolve => {
            resume = resolve;
        });
    capture(f, 7, 'backend-id', 'old problem solution');
    const releasing = release(f, 7);
    f.chrome.tabs.onUpdated.fire(7, { url: 'https://neetcode.io/problems/spiral-matrix' });
    resume({ id: 7, url: 'https://neetcode.io/problems/spiral-matrix' });
    await releasing;
    assert.equal(
        f.sent.some(args => args[1].type === 'CODE_DATA'),
        false,
    );
});

test('failed sync responses discard captures without starting automatic saves', async () => {
    for (const status of [undefined, 0, 199, 301, 400, 403, 500]) {
        const f = backgroundFixture();
        await configure(f);
        capture(f, 7, 'two-sum', 'synthetic code');
        const requestId = beginSync(f, 7);
        await f.chrome.webRequest.onCompleted.fire({
            tabId: 7,
            url: 'https://neetcode.io/api/githubFunctionHttp',
            statusCode: status,
            requestId,
        });
        assert.equal(f.sent.length, 0);
        await release(f, 7);
        assert.equal(f.sent.length, 0, 'Failed captures must not replay on a later success');
    }
});

test('chunked request bodies preserve code even when UTF-8 characters span chunks', async () => {
    const f = backgroundFixture();
    await configure(f);
    const code = 'return "café 問題"';
    const bytes = new TextEncoder().encode(
        JSON.stringify({ data: { problemId: 'two-sum', rawCode: code } }),
    );
    f.chrome.webRequest.onBeforeRequest.fire({
        tabId: 7,
        frameId: 0,
        documentId: 'synthetic-problem-document',
        url: 'https://neetcode.io/api/executeCodeFunctionHttp',
        requestBody: { raw: Array.from(bytes, byte => ({ bytes: new Uint8Array([byte]).buffer })) },
    });
    await release(f, 7, 204);
    assert.equal(f.sent.at(-1)[1].code, code);
});

test('malformed newer submissions cannot release an older capture', async () => {
    const f = backgroundFixture();
    await configure(f);
    capture(f, 7, 'two-sum', 'old code');
    f.chrome.webRequest.onBeforeRequest.fire({
        tabId: 7,
        frameId: 0,
        documentId: 'synthetic-problem-document',
        url: 'https://neetcode.io/api/executeCodeFunctionHttp',
        requestBody: { raw: [{ file: 'not-readable' }] },
    });
    await release(f, 7);
    assert.equal(f.sent.length, 0);
});

test('automatic saves reconnect missing receivers once without replaying captured code', async () => {
    const f = backgroundFixture();
    await configure(f);
    let connected = false;
    const events = [];
    f.chrome.tabs.sendMessage = async (tabId, message, target) => {
        assert.equal(tabId, 7);
        assert.equal(target.frameId, 0);
        events.push(message.type);
        if (!connected) throw new Error('Receiver disconnected');
        if (message.type === 'PAGE_READY') return { ready: true };
        assert.equal(message.code, 'synthetic code');
        return { accepted: true };
    };
    f.chrome.scripting = {
        executeScript: async spec => {
            assert.equal(spec.target.tabId, 7);
            assert.equal(spec.world, 'ISOLATED');
            assert.deepEqual(Array.from(spec.files), ['content-script.js']);
            events.push('inject');
            connected = true;
        },
    };
    capture(f, 7, 'two-sum', 'synthetic code');
    await release(f, 7);
    await release(f, 7);
    assert.deepEqual(events, ['PAGE_READY', 'inject', 'PAGE_READY', 'CODE_DATA']);
});

test('navigation during automatic reconnection prevents captured code delivery', async () => {
    const f = backgroundFixture();
    await configure(f);
    const messages = [];
    f.chrome.tabs.sendMessage = async (_tab, message) => {
        messages.push(message);
        if (message.type === 'PAGE_READY') {
            f.chrome.tabs.onUpdated.fire(7, {
                url: 'https://neetcode.io/problems/two-sum?tab=results',
            });
            return { ready: true };
        }
        return { accepted: true };
    };
    capture(f, 7, 'two-sum', 'synthetic code');
    await release(f, 7);
    assert.deepEqual(
        messages.map(message => message.type),
        ['PAGE_READY', 'SAVE_BLOCKED'],
    );
    assert.equal(messages[1].error.code, 'PAGE_CHANGED');
    assert.equal(f.calls.length, 0);
});

test('ambiguous automatic delivery is not retried and stale-page rejection is not reported twice', async () => {
    for (const mode of ['closed', 'unacknowledged', 'stale']) {
        const f = backgroundFixture();
        await configure(f);
        const types = [];
        f.chrome.tabs.sendMessage = async (_tab, message) => {
            types.push(message.type);
            if (message.type === 'PAGE_READY') return { ready: true };
            if (message.type === 'CODE_DATA') {
                if (mode === 'closed') throw new Error('Port closed');
                return mode === 'stale' ? { accepted: false, reason: 'PAGE_CHANGED' } : undefined;
            }
            return { accepted: true };
        };
        capture(f, 7, 'two-sum', 'synthetic code');
        await release(f, 7);
        await release(f, 7);
        assert.deepEqual(
            types,
            mode === 'stale'
                ? ['PAGE_READY', 'CODE_DATA']
                : ['PAGE_READY', 'CODE_DATA', 'SAVE_BLOCKED'],
        );
    }
});
