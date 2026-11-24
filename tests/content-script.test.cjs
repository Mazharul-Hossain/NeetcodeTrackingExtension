/*
 * NeetcodeTrackingExtension/ -> tests/ -> content-script.test.cjs
 * Purpose: pin extraction, Markdown, categories and credential-migration behavior.
 * Agent skills: browser DOM fixtures and Node tests; no live credentials.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture } = require('./helpers/extension-harness.cjs');

test('language mapping and fallback remain stable', () => {
    const f = contentFixture();
    assert.deepEqual(
        ['Python', 'Java', 'C++', 'C#', 'JavaScript', 'unknown'].map(x => f.context.getLanguage(x)),
        ['py', 'java', 'cpp', 'c', 'js', 'py'],
    );
});
test('category ignores body/navigation text and uses only explicit routes or breadcrumb links', () => {
    let links = [];
    const document = {
        body: { innerText: 'Navigation System Design footer System Design Two Sum' },
        querySelectorAll: selector => {
            assert.match(selector, /breadcrumb/);
            return links;
        },
    };
    const f = contentFixture({ document });
    assert.equal(f.context.getCategory(), 'Data Structures & Algorithms');
    f.context.location.href = 'https://neetcode.io/problems/two-sum?next=system-design';
    assert.equal(f.context.getCategory(), 'Data Structures & Algorithms');
    links = [{ href: 'https://foreign.invalid/courses/system-design' }];
    assert.equal(f.context.getCategory(), 'Data Structures & Algorithms');
    links = [{ href: 'https://neetcode.io/courses/system-design' }];
    assert.equal(f.context.getCategory(), 'System Design');
    f.context.location.href = 'https://neetcode.io/problems/system-design/example';
    links = [];
    assert.equal(f.context.getCategory(), 'System Design');
});

test('editor reads textarea first, then falls back to visible lines', () => {
    let textarea = { value: '完整 solution' };
    const f = contentFixture({
        document: {
            querySelector: () => textarea,
            querySelectorAll: () => [{ innerText: 'line one' }, { innerText: 'line two' }],
        },
    });
    assert.equal(f.context.getCode(), '完整 solution');
    textarea = null;
    assert.equal(f.context.getCode(), 'line one\nline two');
});
test('Markdown preserves paragraphs, Unicode and KaTeX source', () => {
    const text = value => ({ nodeType: 3, textContent: value });
    const math = {
        nodeType: 1,
        tagName: 'SPAN',
        textContent: 'math',
        classList: { contains: value => value === 'katex' },
        querySelector: () => ({ textContent: 'x^2' }),
    };
    const paragraph = {
        nodeType: 1,
        tagName: 'P',
        textContent: 'Find café x²',
        childNodes: [text('Find café'), math],
    };
    const f = contentFixture();
    assert.equal(
        f.context.formatArticleComponent('Example', { childNodes: [paragraph] }),
        '# **Example**\n\nFind café $x^2$',
    );
});

test('missing required markup times out and disconnects its observer', async () => {
    let timeout;
    let disconnected = 0;
    const f = contentFixture({
        document: { querySelector: () => null, body: {} },
        setTimeout: fn => {
            timeout = fn;
            return 1;
        },
        clearTimeout: () => {},
        MutationObserver: class {
            observe() {}
            disconnect() {
                disconnected++;
            }
        },
    });
    const pending = f.context.waitForElement('querySelector', 'h1');
    assert.equal(typeof timeout, 'function', 'Required DOM waits need a deadline');
    timeout();
    await assert.rejects(pending, error => error.code === 'PAGE_NOT_READY');
    assert.equal(disconnected, 1);
});

test(
    'cancelled DOM wait disconnects without leaving a pending observer',
    { timeout: 200 },
    async () => {
        let disconnected = 0;
        const controller = new AbortController();
        const f = contentFixture({
            document: { querySelector: () => null, body: {} },
            MutationObserver: class {
                observe() {}
                disconnect() {
                    disconnected++;
                }
            },
        });
        const pending = f.context.waitForElement('querySelector', 'h1', controller.signal);
        controller.abort();
        await assert.rejects(pending, error => error.code === 'PAGE_NOT_READY');
        assert.equal(disconnected, 1);
    },
);

test('absent optional topics do not block a problem save', { timeout: 200 }, async () => {
    const f = contentFixture({
        document: { querySelector: () => null },
        MutationObserver: class {
            constructor() {
                assert.fail('Optional tags must not wait');
            }
        },
    });
    assert.deepEqual(Array.from(await f.context.waitForTopics()), []);
});
