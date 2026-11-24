const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { workerFixture, problemSender, optionsSender } = require('./helpers/worker-harness.cjs');

const pageUrl = problemSender.url;
const fullCode = 'def solve():\n    # café\n    return 42\n' + '# more code\n'.repeat(1000);
const model = (code = fullCode) => ({ isDisposed: () => false, getValue: () => code });
const editor = (value, visible = true, focused = false) => ({
    getDomNode: () => ({ isConnected: true, getClientRects: () => (visible ? [{}] : []) }),
    hasTextFocus: () => focused,
    getModel: () => value,
});

function read(api, url = pageUrl) {
    const f = workerFixture();
    // Execute the serialized function in a separate page world, as Chrome does.
    const fn = vm.runInNewContext(`(${f.context.readEditorModel.toString()})`, {
        location: { href: url },
        monaco: { editor: api },
    });
    return fn(pageUrl);
}

test('model capture preserves full multiline Unicode code and indentation regardless of DOM lines', () => {
    assert.equal(read({ getEditors: () => [editor(model())] }), fullCode);
    assert.equal(read({ getModels: () => [model()] }), fullCode);
});

test('model capture selects the visible focused editor rather than the first registered model', () => {
    assert.equal(
        read({ getEditors: () => [editor(model('wrong'), false), editor(model())] }),
        fullCode,
    );
    assert.equal(
        read({ getEditors: () => [editor(model('wrong')), editor(model(), true, true)] }),
        fullCode,
    );
});

test('ambiguous, missing, disposed or changed-page models fail without scraping', () => {
    for (const api of [
        {},
        { getModels: () => [] },
        { getModels: () => [model(), model('other')] },
        { getModels: () => [{ isDisposed: () => true }] },
        { getEditors: () => [editor(model()), editor(model('other'))] },
        { getEditors: () => [editor(model(), false)], getModels: () => [model()] },
        { getEditors: () => [editor(null)] },
        { getModels: () => [model('x'.repeat(1048577))] },
        {
            getModels: () => {
                throw new Error('private page error');
            },
        },
    ]) {
        assert.equal(read(api), null);
    }
    assert.equal(read({ getModels: () => [model()] }, pageUrl + '-other'), null);
    assert.equal(read({ getModels: () => [model('')] }), '');
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
            return [{ result: fullCode }];
        },
    };
    const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
    assert.equal(result.ok, true);
    assert.equal(result.code, fullCode);
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
        assert.equal(result.error.code, 'EDITOR_UNAVAILABLE');
        assert.equal('code' in result, false);
    }
    const f = workerFixture();
    f.chrome.scripting = {
        executeScript: async () => {
            throw new Error('private browser error');
        },
    };
    const result = await f.request({ type: 'GET_EDITOR_CODE', pageUrl }, problemSender);
    assert.equal(result.error.code, 'EDITOR_UNAVAILABLE');
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
    await assert.rejects(pending, error => error.publicCode === 'EDITOR_UNAVAILABLE');
    assert.equal(cleared, true);
});
