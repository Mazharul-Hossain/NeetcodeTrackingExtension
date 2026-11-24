/*
 * NeetcodeTrackingExtension/ -> tests/ -> background.test.cjs
 * Purpose: characterize per-tab submission capture and manual trigger routing.
 * Agent skills: Node test runner and Chrome webRequest messaging.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { backgroundFixture } = require('./helpers/extension-harness.cjs');
const { configure } = require('./helpers/worker-harness.cjs');

function capture(fixture, tabId, title, code) {
    fixture.chrome.webRequest.onBeforeRequest.fire({
        tabId,
        url: 'https://neetcode.io/api/executeCodeFunctionHttp',
        requestBody: {
            raw: [
                {
                    bytes: new TextEncoder().encode(
                        JSON.stringify({ data: { problemId: title, rawCode: code } }),
                    ).buffer,
                },
            ],
        },
    });
}

function release(fixture, tabId) {
    return fixture.chrome.webRequest.onCompleted.fire({
        tabId,
        url: 'https://neetcode.io/api/githubFunctionHttp',
    });
}

async function assertTabRouting(transform) {
    const f = backgroundFixture(transform);
    await configure(f);
    capture(f, 1, 'one', 'code one');
    capture(f, 2, 'two', 'code two');
    await release(f, 2);
    await release(f, 1);
    assert.deepEqual(
        f.sent.map(args => [args[0], args[1].code]),
        [
            [2, 'code two'],
            [1, 'code one'],
        ],
    );
    await release(f, 1);
    assert.equal(f.sent.length, 2, 'pending capture cleaned after release');
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
