/*
 * NeetcodeTrackingExtension/ -> tests/ -> content-integration.test.cjs
 * Purpose: verify extraction sends credential-free data and renders safe results.
 * Agent skills: DOM fixtures and Chrome runtime messaging.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture } = require('./helpers/extension-harness.cjs');
const { event } = require('./helpers/extension-harness.cjs');

function fixture(response) {
    class FixedDate extends Date {
        constructor() {
            super('2026-11-23T02:00:00Z');
        }
    }
    const messages = [];
    const f = contentFixture({
        config: undefined,
        Date: FixedDate,
        fetch: () => {
            assert.fail('Content script must not call GitHub');
        },
        chrome: {
            runtime: {
                id: 'extension',
                onMessage: event(),
                async sendMessage(message) {
                    messages.push(message);
                    return response;
                },
            },
        },
        document: {
            body: { innerText: 'Arrays' },
            querySelectorAll: selector =>
                selector === 'h1'
                    ? [{ textContent: 'Two Sum', closest: () => null, getClientRects: () => [{}] }]
                    : [],
            querySelector: selector =>
                ({
                    h1: { textContent: 'Two Sum' },
                    'main.my-article-component-container': {
                        childNodes: [],
                        querySelector: () => null,
                    },
                    '.selected-language': { textContent: 'Python' },
                    '.company-tags-container': {
                        querySelectorAll: () => [
                            { textContent: ' Arrays ' },
                            { textContent: 'Two Pointers' },
                        ],
                    },
                })[selector],
        },
    });
    f.evaluate(
        'globalThis.toasts = []; showToast = (message, color, duration, action) => toasts.push({ message, action });',
    );
    return { ...f, messages };
}
test('uploads optional solution and exact enriched problem data in one credential-free message', async () => {
    const f = fixture({ ok: true, updated: false });
    await f.context.processAndUpload('café', 'manual', 'synthetic-upload-ticket');
    assert.equal(f.messages.length, 1);
    const message = f.messages[0];
    assert.equal(message.type, 'UPLOAD_PROBLEM');
    assert.equal(message.uploadTicket, 'synthetic-upload-ticket');
    assert.equal(message.payload.title, 'two-sum');
    assert.equal(message.payload.date, '2026-11-23');
    assert.deepEqual(
        Array.from(message.payload.files, x => [x.kind, x.extension]),
        [
            ['solution', 'py'],
            ['problem', 'md'],
        ],
    );
    assert.equal(
        message.payload.files[1].content,
        '---\ntags:\n - Arrays\n - Two-Pointers\n\ncreated: 2026-11-23\n\n---\n\n## Notes\n\n<!-- Add your thoughts, edge cases, mistakes -->\n\n---\n\n# **Two Sum**\n',
    );
    assert.equal('token' in message.payload, false);
    assert.equal(f.context.toasts[0].message, 'Saved via click');
});
test('blocked trigger shows settings action without starting DOM extraction', () => {
    const f = fixture({ ok: true });
    f.context.chrome.runtime.onMessage.fire(
        { type: 'SAVE_BLOCKED', error: { code: 'VAULT_LOCKED', message: 'Unlock before saving.' } },
        { id: 'extension' },
    );
    assert.equal(f.context.toasts[0].message, 'Unlock before saving.');
    assert.equal(f.messages.length, 0);
});
test('blank code saves only problem and retains its warning', async () => {
    const f = fixture({ ok: true });
    await f.context.processAndUpload('', 'manual');
    assert.deepEqual(
        Array.from(f.messages[0].payload.files, x => x.kind),
        ['problem'],
    );
    assert.match(f.context.toasts[0].message, /No code found/);
});
test('locked upload offers settings action and does not report success or replay', async () => {
    const f = fixture({
        ok: false,
        error: { code: 'VAULT_LOCKED', message: 'Unlock in settings.' },
    });
    await f.context.processAndUpload('code', 'auto');
    assert.equal(f.context.toasts[0].message, 'Unlock in settings.');
    assert.equal(typeof f.context.toasts[0].action, 'function');
    await f.context.toasts[0].action();
    assert.deepEqual(
        f.messages.map(x => x.type),
        ['UPLOAD_PROBLEM', 'OPEN_SETTINGS'],
    );
});
test('manual trigger acknowledges acceptance immediately instead of leaving sender unanswered', async () => {
    const f = fixture({ ok: true });
    f.evaluate(
        'globalThis.jobs = []; getCode = () => "synthetic code"; processAndUpload = async (...args) => { jobs.push(args); };',
    );
    let acknowledgement;
    f.context.location = { href: 'https://neetcode.io/problems/two-sum' };
    f.context.chrome.runtime.onMessage.fire(
        {
            type: 'MANUAL_TRIGGER',
            pageUrl: f.context.location.href,
            uploadTicket: 'synthetic-ticket',
        },
        { id: 'extension' },
        value => {
            acknowledgement = value;
        },
    );
    assert.equal(acknowledgement?.accepted, true);
    await Promise.resolve();
    assert.deepEqual(Array.from(f.context.jobs[0]), [
        'synthetic code',
        'manual',
        'synthetic-ticket',
        f.context.location.href,
    ]);
});

test('manual trigger refuses a different problem before reading editor contents', () => {
    const f = fixture({ ok: true });
    f.context.location = { href: 'https://neetcode.io/problems/spiral-matrix' };
    f.evaluate('getCode = () => { throw new Error("Must not read editor"); };');
    let result;
    f.context.chrome.runtime.onMessage.fire(
        { type: 'MANUAL_TRIGGER', pageUrl: 'https://neetcode.io/problems/two-sum' },
        { id: 'extension' },
        value => {
            result = value;
        },
    );
    assert.equal(result?.accepted, false);
    assert.equal(result?.reason, 'PAGE_CHANGED');
    assert.equal(f.messages.length, 0);
});

test('navigation during extraction stops the upload before contacting the worker', async () => {
    const f = fixture({ ok: true });
    const pageUrl = 'https://neetcode.io/problems/two-sum';
    f.context.location = { href: pageUrl };
    f.evaluate(
        'buildUploadPayload = async () => { location.href = "https://neetcode.io/problems/spiral-matrix"; return {}; };',
    );
    const result = await f.context.addContentToGitHub(
        'code',
        'two-sum',
        'text',
        'Python',
        'ticket',
        pageUrl,
    );
    assert.equal(result.error.code, 'PAGE_CHANGED');
    assert.equal(f.messages.length, 0);
});

test('automatic trigger refuses captured code belonging to a different problem', () => {
    const f = fixture({ ok: true });
    f.context.location = { href: 'https://neetcode.io/problems/spiral-matrix/question' };
    f.evaluate('globalThis.jobs = []; processAndUpload = async (...args) => { jobs.push(args); };');
    let result;
    f.context.chrome.runtime.onMessage.fire(
        {
            type: 'CODE_DATA',
            pageUrl: 'https://neetcode.io/problems/two-sum',
            code: 'first problem code',
            title: 'two-sum',
            uploadTicket: 'ticket',
        },
        { id: 'extension' },
        value => {
            result = value;
        },
    );
    assert.equal(result?.accepted, false);
    assert.equal(f.context.jobs.length, 0);
});

test('automatic trigger accepts the captured route independently of backend problem ID', () => {
    const f = fixture({ ok: true });
    const pageUrl = 'https://neetcode.io/problems/two-integer-sum/question';
    f.context.location = { href: pageUrl };
    f.evaluate('globalThis.jobs = []; processAndUpload = async (...args) => { jobs.push(args); };');
    let result;
    f.context.chrome.runtime.onMessage.fire(
        {
            type: 'CODE_DATA',
            pageUrl,
            title: 'backend-id-123',
            code: 'solution',
            uploadTicket: 'ticket',
        },
        { id: 'extension' },
        value => {
            result = value;
        },
    );
    assert.equal(result?.accepted, true);
    assert.deepEqual(Array.from(f.context.jobs[0]), ['solution', 'auto', 'ticket', pageUrl]);
});

test('problem without optional topic markup still uploads successfully', async () => {
    const f = fixture({ ok: true });
    const original = f.context.document.querySelector;
    f.context.document.querySelector = selector =>
        selector === '.company-tags-container' ? null : original(selector);
    await f.context.processAndUpload('code', 'manual');
    assert.equal(f.messages[0].type, 'UPLOAD_PROBLEM');
    assert.match(f.context.toasts.at(-1).message, /Saved via click/);
});

test('missing required problem markup finishes with feedback and no upload', async () => {
    const f = fixture({ ok: true });
    let cancel;
    let disconnected = false;
    f.context.setTimeout = fn => {
        cancel ||= fn;
        return 1;
    };
    f.context.clearTimeout = () => {};
    f.context.MutationObserver = class {
        observe() {}
        disconnect() {
            disconnected = true;
        }
    };
    f.context.document.querySelector = () => null;
    const job = f.context.processAndUpload('code', 'manual');
    cancel();
    await job;
    assert.equal(f.messages.length, 0);
    assert.equal(disconnected, true);
    assert.match(f.context.toasts.at(-1).message, /Problem details did not load/);
});
test('foreign senders cannot start or acknowledge a save trigger', () => {
    const f = fixture({ ok: true });
    f.evaluate('globalThis.jobs = []; processAndUpload = async (...args) => { jobs.push(args); };');
    let acknowledgement;
    f.context.chrome.runtime.onMessage.fire(
        { type: 'CODE_DATA', code: 'code', title: 'x' },
        { id: 'foreign' },
        value => {
            acknowledgement = value;
        },
    );
    assert.equal(acknowledgement, undefined);
    assert.equal(f.context.jobs.length, 0);
});

test('readiness probe is side-effect free and reinjection registers only one receiver', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { root } = require('./helpers/extension-harness.cjs');
    const f = fixture({ ok: true });
    f.evaluate(fs.readFileSync(path.join(root, 'content-script.js'), 'utf8'));
    assert.equal(f.context.chrome.runtime.onMessage.listeners.length, 1);
    let result;
    f.context.chrome.runtime.onMessage.fire({ type: 'PAGE_READY' }, { id: 'extension' }, value => {
        result = value;
    });
    assert.equal(result?.ready, true);
    assert.equal(f.messages.length, 0);
    assert.equal(f.context.toasts.length, 0);
});

test('unsupported language stops saves instead of mislabeling the solution as Python', async () => {
    const f = fixture({ ok: true });
    const original = f.context.document.querySelector;
    f.context.document.querySelector = selector =>
        selector === '.selected-language'
            ? { textContent: 'Unknown language' }
            : original(selector);
    await f.context.processAndUpload('synthetic code', 'manual');
    assert.equal(f.messages.length, 0);
    assert.equal(
        f.context.toasts.at(-1).message,
        'This language is not supported. No files were saved.',
    );
});

test('failed complete-model capture stops manual saves without uploading partial DOM code', async () => {
    const f = fixture({ ok: false, error: { code: 'EDITOR_UNAVAILABLE' } });
    await f.context.saveManual({
        pageUrl: f.context.location.href,
        uploadTicket: 'synthetic-ticket',
    });
    assert.deepEqual(
        f.messages.map(message => message.type),
        ['GET_EDITOR_CODE'],
    );
    assert.match(f.context.toasts.at(-1).message, /Could not read the complete editor code/);
});

test('navigation while awaiting the editor prevents a manual upload', async () => {
    const f = fixture({ ok: true });
    f.context.chrome.runtime.sendMessage = async () => {
        f.context.location.href += '-other';
        return { ok: true, code: 'synthetic code' };
    };
    await f.context.saveManual({ pageUrl: f.context.location.href });
    assert.equal(f.messages.length, 0);
    assert.match(f.context.toasts.at(-1).message, /No files were saved/);
});

test('manual save sends complete model code unchanged through to the upload', async () => {
    const f = fixture({ ok: true });
    const code = 'def solve():\n    return "café"\n' + '# more code\n'.repeat(1000);
    f.context.chrome.runtime.sendMessage = async message => {
        f.messages.push(message);
        return message.type === 'GET_EDITOR_CODE' ? { ok: true, code } : { ok: true };
    };
    await f.context.saveManual({
        pageUrl: f.context.location.href,
        uploadTicket: 'synthetic-ticket',
    });
    assert.deepEqual(
        f.messages.map(message => message.type),
        ['GET_EDITOR_CODE', 'UPLOAD_PROBLEM'],
    );
    assert.equal(f.messages[1].payload.files[0].content, code);
    assert.equal(f.messages[1].uploadTicket, 'synthetic-ticket');
});

test('manual and automatic no-op saves report that the problem is already saved', async () => {
    for (const source of ['manual', 'auto']) {
        for (const code of ['', 'unchanged synthetic code']) {
            const f = fixture({ ok: true, updated: false, unchanged: true });
            await f.context.processAndUpload(code, source);
            assert.equal(f.context.toasts.at(-1).message, 'Already saved, nothing to update.');
        }
    }
});
