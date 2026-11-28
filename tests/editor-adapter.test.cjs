/*
 * NeetcodeTrackingExtension/ -> tests/ -> editor-adapter.test.cjs
 * Purpose: test the packaged page-world Monaco adapter without site code or credentials.
 * Agent skills: Chrome MAIN-world isolation, Monaco models and bounded Webpack discovery.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { workerFixture } = require('./helpers/worker-harness.cjs');

const pageUrl = 'https://neetcode.io/problems/two-sum';
function makeEditor(code, { readOnly = false, visible = true, focused = false } = {}) {
    let reads = 0;
    const model = {
        isDisposed: () => false,
        getValue() {
            reads++;
            return code;
        },
        getLanguageId: () => 'python',
    };
    return {
        model,
        reads: () => reads,
        getDomNode: () => ({ isConnected: true, getClientRects: () => (visible ? [{}] : []) }),
        getOption: () => readOnly,
        hasTextFocus: () => focused,
        getModel: () => model,
    };
}
const makeApi = editors => ({
    EditorOption: { readOnly: 91 },
    getEditors: () => editors,
    getModels: () => editors.map(editor => editor.model),
});
// Registered factories advertise exports; the adapter must not execute factory source.
function monacoFactory(module) {
    module.exports = { editor: null, languages: null, Uri: null, Range: null, KeyCode: null };
}
function unrelatedFactory() {
    throw new Error('Unrelated module must not execute');
}
function makeRuntime(apis) {
    const calls = [];
    const runtime = id => {
        calls.push(id);
        assert.ok(Object.hasOwn(apis, id), 'Only Monaco candidates may be requested');
        return { editor: apis[id] };
    };
    runtime.m = {
        unrelated: unrelatedFactory,
        ...Object.fromEntries(Object.keys(apis).map(id => [id, monacoFactory])),
    };
    const queue = [];
    queue.push = entry => {
        assert.deepEqual(Object.keys(entry[1]), [], 'No module factories may be installed');
        Array.prototype.push.call(queue, entry);
        entry[2](runtime);
    };
    return { queue, runtime, calls };
}
function read(globals) {
    const f = workerFixture();
    const fn = vm.runInNewContext(`(${f.context.readEditorModel.toString()})`, {
        location: { href: pageUrl },
        ...globals,
    });
    return fn(pageUrl);
}

test('module discovery survives renumbering and selects the visible editable editor', () => {
    const code = 'def solve():\n    return "café"\n' + '# off-screen\n'.repeat(1000);
    for (const id of ['1729', '900123']) {
        const solution = makeEditor(code);
        const output = makeEditor('wrong', { readOnly: true, focused: true });
        const api = makeApi([output, makeEditor('', { readOnly: true }), solution]);
        const runtime = makeRuntime({ [id]: api });
        const snapshot = read({ webpackChunkangular_client: runtime.queue });
        assert.equal(snapshot.code, code);
        assert.equal(snapshot.language, 'python');
        assert.deepEqual(runtime.calls, [id]);
        assert.equal(output.reads(), 0);
        assert.equal(
            runtime.queue.length,
            0,
            'Remove only the adapter registration after discovery',
        );
    }
});

test('aliases for the same API are deduplicated without probing unrelated modules', () => {
    const api = makeApi([makeEditor('complete solution')]);
    const runtime = makeRuntime({ 101: api, 202: { ...api }, 303: api });
    assert.equal(read({ webpackChunkrenamed_app: runtime.queue }).code, 'complete solution');
    assert.deepEqual(runtime.calls, ['101', '202', '303']);
});

test('export-shaped helper modules without an editor API do not mask valid Monaco aliases', () => {
    const api = makeApi([makeEditor('complete solution')]);
    const runtime = makeRuntime({ 101: api, 202: null, 303: { ...api } });
    assert.equal(read({ webpackChunkapp: runtime.queue }).code, 'complete solution');
    assert.deepEqual(runtime.calls, ['101', '202', '303']);
});

test('multiple Monaco APIs or multiple editable editors fail before reading code', () => {
    const first = makeEditor('first');
    const second = makeEditor('second', { focused: true });
    const runtime = makeRuntime({ 101: makeApi([first]), 202: makeApi([second]) });
    assert.equal(read({ webpackChunkapp: runtime.queue }).errorCode, 'EDITOR_AMBIGUOUS');
    assert.equal(
        read({ monaco: { editor: makeApi([first, second]) } }).errorCode,
        'EDITOR_AMBIGUOUS',
    );
    assert.equal(first.reads(), 0);
    assert.equal(second.reads(), 0);
});

test('read-only and hidden editors are excluded, while an empty solution is valid', () => {
    assert.equal(
        read({ monaco: { editor: makeApi([makeEditor('output', { readOnly: true })]) } }).errorCode,
        'EDITOR_NOT_FOUND',
    );
    assert.equal(
        read({ monaco: { editor: makeApi([makeEditor('hidden', { visible: false })]) } }).errorCode,
        'EDITOR_NOT_FOUND',
    );
    const snapshot = read({ monaco: { editor: makeApi([makeEditor('')]) } });
    assert.equal(snapshot.code, '');
    assert.equal(snapshot.language, 'python');
});

test('missing and unsupported runtimes fail without executing registered modules', () => {
    assert.equal(read({}).errorCode, 'EDITOR_API_UNAVAILABLE');
    assert.equal(read({ webpackChunkplain: [] }).errorCode, 'EDITOR_API_UNAVAILABLE');
    const runtime = makeRuntime({});
    assert.equal(read({ webpackChunkapp: runtime.queue }).errorCode, 'EDITOR_API_UNAVAILABLE');
    assert.equal(runtime.calls.length, 0);
    assert.equal(runtime.queue.length, 0);
});

test('discovery bounds module and candidate counts before requesting exports', () => {
    const api = makeApi([makeEditor('code')]);
    for (const excessive of ['modules', 'candidates']) {
        const runtime = makeRuntime(
            excessive === 'candidates'
                ? Object.fromEntries(Array.from({ length: 9 }, (_, id) => [id, api]))
                : {},
        );
        if (excessive === 'modules') {
            runtime.runtime.m = Object.fromEntries(
                Array.from({ length: 10001 }, (_, id) => [id, unrelatedFactory]),
            );
        }
        assert.equal(read({ webpackChunkapp: runtime.queue }).errorCode, 'EDITOR_DISCOVERY_FAILED');
        assert.equal(runtime.calls.length, 0);
        assert.equal(runtime.queue.length, 0);
    }
});
