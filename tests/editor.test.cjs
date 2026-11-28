const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { workerFixture, problemSender, optionsSender } = require('./helpers/worker-harness.cjs');

const pageUrl = problemSender.url;
const fullCode = 'def solve():\n    # café\n    return 42\n' + '# more code\n'.repeat(1000);
const model = (code = fullCode, language = 'python') => ({
    isDisposed: () => false,
    getValue: () => code,
    getLanguageId: () => language,
});
const editor = (value, visible = true, focused = false, readOnly = false) => ({
    getDomNode: () => ({ isConnected: true, getClientRects: () => (visible ? [{}] : []) }),
    hasTextFocus: () => focused,
    getModel: () => value,
    getOption: () => readOnly,
});
const editorApi = getEditors => ({
    EditorOption: { readOnly: 91 },
    getEditors,
    getModels: () => [],
});
const modelApi = getModels => editorApi(() => getModels().map(value => editor(value)));

function read(api, url = pageUrl, snapshot = false) {
    const f = workerFixture();
    // Execute the serialized function in a separate page world, as Chrome does.
    const fn = vm.runInNewContext(`(${f.context.readEditorModel.toString()})`, {
        location: { href: url },
        monaco: { editor: api },
    });
    const result = fn(pageUrl);
    return snapshot ? result : (result?.code ?? null);
}

test('model snapshot pairs the complete code with its own language', () => {
    const snapshot = read(
        modelApi(() => [model(fullCode, 'python')]),
        pageUrl,
        true,
    );
    assert.equal(snapshot.code, fullCode);
    assert.equal(snapshot.language, 'python');
});

test('model capture preserves full multiline Unicode code and indentation regardless of DOM lines', () => {
    assert.equal(read(editorApi(() => [editor(model())])), fullCode);
    assert.equal(read(modelApi(() => [model()])), fullCode);
});

test('model capture selects the visible editable editor rather than hidden or read-only editors', () => {
    assert.equal(read(editorApi(() => [editor(model('wrong'), false), editor(model())])), fullCode);
    assert.equal(
        read(
            editorApi(() => [
                editor(model('wrong'), true, false, true),
                editor(model(), true, true),
            ]),
        ),
        fullCode,
    );
});

test('page-world failures return fixed diagnostic codes without raw errors', () => {
    const cases = [
        [undefined, 'EDITOR_API_UNAVAILABLE'],
        [{}, 'EDITOR_API_UNAVAILABLE'],
        [modelApi(() => []), 'EDITOR_NOT_FOUND'],
        [modelApi(() => [model(), model()]), 'EDITOR_AMBIGUOUS'],
        [editorApi(() => [editor(null)]), 'EDITOR_MODEL_UNAVAILABLE'],
        [modelApi(() => [model('code', '')]), 'EDITOR_SNAPSHOT_INVALID'],
        [modelApi(() => [model('x'.repeat(1048577))]), 'EDITOR_TOO_LARGE'],
        [
            modelApi(() => {
                throw new Error('private page details');
            }),
            'EDITOR_READ_FAILED',
        ],
    ];
    for (const [api, code] of cases) {
        const result = read(api, pageUrl, true);
        assert.equal(result?.errorCode, code);
        assert.doesNotMatch(JSON.stringify(result), /private page details/);
    }
    assert.equal(
        read(
            modelApi(() => [model()]),
            pageUrl + '-other',
            true,
        )?.errorCode,
        'PAGE_CHANGED',
    );
});

test('worker preserves only allowlisted editor diagnostics from the page world', async () => {
    for (const code of [
        'EDITOR_API_UNAVAILABLE',
        'EDITOR_DISCOVERY_FAILED',
        'EDITOR_NOT_FOUND',
        'EDITOR_AMBIGUOUS',
        'EDITOR_MODEL_UNAVAILABLE',
        'EDITOR_SNAPSHOT_INVALID',
        'EDITOR_TOO_LARGE',
        'EDITOR_READ_FAILED',
        'PAGE_CHANGED',
    ]) {
        const f = workerFixture();
        f.chrome.scripting = { executeScript: async () => [{ result: { errorCode: code } }] };
        const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
        assert.equal(result.error.code, code);
    }
    const f = workerFixture();
    f.chrome.scripting = {
        executeScript: async () => [
            { result: { errorCode: 'AUTH_FAILED', message: 'private page details' } },
        ],
    };
    const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
    assert.equal(result.error.code, 'EDITOR_SNAPSHOT_INVALID');
    assert.doesNotMatch(JSON.stringify(result), /private page details/);
});

test('ambiguous, missing, disposed or changed-page models fail without scraping', () => {
    for (const api of [
        {},
        modelApi(() => []),
        modelApi(() => [model(), model('other')]),
        modelApi(() => [{ isDisposed: () => true }]),
        editorApi(() => [editor(model()), editor(model('other'))]),
        editorApi(() => [editor(model(), false)]),
        editorApi(() => [editor(null)]),
        modelApi(() => [model('x'.repeat(1048577))]),
        modelApi(() => {
            throw new Error('private page error');
        }),
    ]) {
        assert.equal(read(api), null);
    }
    assert.equal(
        read(
            modelApi(() => [model()]),
            pageUrl + '-other',
        ),
        null,
    );
    assert.equal(read(modelApi(() => [model('')])), '');
});

test('worker reads only the authorized top frame in MAIN without supplying credentials', async () => {
    const f = workerFixture();
    f.chrome.scripting = {
        executeScript: async spec => {
            assert.equal(spec.world, 'MAIN');
            assert.equal(spec.target.tabId, problemSender.tab.id);
            assert.deepEqual(Array.from(spec.target.frameIds), [0]);
            assert.deepEqual(Array.from(spec.args), [pageUrl]);
            assert.equal(spec.func, f.context.readEditorModel);
            return [{ result: { code: fullCode, language: 'python' } }];
        },
    };
    const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
    assert.equal(result.ok, true);
    assert.equal(result.code, fullCode);
    assert.equal(result.language, 'python');
    for (const sender of [
        optionsSender,
        { ...problemSender, frameId: 1 },
        { ...problemSender, id: 'foreign' },
    ]) {
        const denied = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, sender);
        assert.equal(denied.error.code, 'UNAUTHORIZED');
    }
    const changed = await f.request(
        { type: 'GET_EDITOR_CODE', pageUrl: pageUrl + '-other' },
        problemSender,
    );
    assert.equal(changed.error.code, 'PAGE_CHANGED');
    assert.equal(f.calls.length, 0);
});

test('worker sanitizes injection failures and invalid model results', async () => {
    for (const value of [null, undefined, {}, 42, 'é'.repeat(600000)]) {
        const f = workerFixture();
        f.chrome.scripting = { executeScript: async () => [{ result: value }] };
        const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
        assert.equal(result.error.code, 'EDITOR_SNAPSHOT_INVALID');
        assert.equal('code' in result, false);
    }
    const f = workerFixture();
    f.chrome.scripting = {
        executeScript: async () => {
            throw new Error('private browser error');
        },
    };
    const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
    assert.equal(result.error.code, 'EDITOR_INJECTION_FAILED');
    assert.doesNotMatch(JSON.stringify(result), /private browser error/);
});

test('a stalled page-world read times out with a fixed error and releases its timer', async () => {
    let timeout;
    let cleared = false;
    const f = workerFixture({
        globals: {
            setTimeout: (fn, ms) => {
                assert.equal(ms, 5000);
                timeout = fn;
                return 123;
            },
            clearTimeout: id => {
                assert.equal(id, 123);
                cleared = true;
            },
        },
    });
    f.chrome.scripting = { executeScript: () => new Promise(() => {}) };
    const pending = f.context.getEditorCode(problemSender, pageUrl, 0);
    timeout();
    await assert.rejects(pending, error => error.publicCode === 'EDITOR_READ_TIMEOUT');
    assert.equal(cleared, true);
});
