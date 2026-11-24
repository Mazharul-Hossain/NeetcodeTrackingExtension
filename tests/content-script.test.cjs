/*
 * NeetcodeTrackingExtension/ -> tests/ -> content-script.test.cjs
 * Purpose: pin extraction, Markdown, categories and credential-migration behavior.
 * Agent skills: browser DOM fixtures and Node tests; no live credentials.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture } = require('./helpers/extension-harness.cjs');

test('language mapping covers supported languages and rejects unknown labels', () => {
    const f = contentFixture();
    const expected = {
        Python: 'py',
        Python3: 'py',
        Java: 'java',
        'C++': 'cpp',
        C: 'c',
        'C#': 'cs',
        JavaScript: 'js',
        TypeScript: 'ts',
        Go: 'go',
        Rust: 'rs',
        Kotlin: 'kt',
        Swift: 'swift',
        Ruby: 'rb',
        PHP: 'php',
        Scala: 'scala',
        Dart: 'dart',
        Racket: 'rkt',
        Elixir: 'ex',
        Erlang: 'erl',
        'F#': 'fs',
        R: 'r',
        Perl: 'pl',
        Haskell: 'hs',
        Lua: 'lua',
        Bash: 'sh',
        SQL: 'sql',
    };
    for (const [label, extension] of Object.entries(expected)) {
        assert.equal(f.context.getLanguage(label), extension);
        assert.equal(f.context.getLanguage(` ${label.toUpperCase()} `), extension);
    }
    for (const label of ['unknown', '', '__proto__', 'constructor', undefined]) {
        assert.equal(f.context.getLanguage(label), null);
    }
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

test('editor capture requests the full model and never reads a textarea or rendered lines', async () => {
    const code = 'def solve():\n    return "完整"\n' + '# long line\n'.repeat(1000);
    const f = contentFixture({
        document: {
            querySelector: () => assert.fail('Must not read hidden textarea'),
            querySelectorAll: () => assert.fail('Must not read virtualized lines'),
        },
    });
    f.context.chrome.runtime.sendMessage = async message => {
        assert.equal(message.type, 'GET_EDITOR_CODE');
        assert.equal(message.pageUrl, f.context.location.href);
        return { ok: true, code };
    };
    assert.equal(await f.context.getCode(f.context.location.href), code);
    f.context.chrome.runtime.sendMessage = async () => ({ ok: false });
    await assert.rejects(f.context.getCode(f.context.location.href));
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

test('problem slugs trim once, collapse dashes and avoid Windows-invalid names', () => {
    const f = contentFixture();
    for (const [title, expected] of [
        ['  Two   Sum  ', 'two-sum'],
        [' A---B :?*<>"/\\| ', 'a-b'],
        ['...Hello...  ', 'hello'],
        ['CON', 'problem-con'],
        ['LPT1.txt', 'problem-lpt1.txt'],
        ['café\t問題', 'café-問題'],
    ]) {
        assert.equal(f.context.slugProblemTitle(title), expected);
    }
    for (const title of [' ', ':?*', '...']) assert.throws(() => f.context.slugProblemTitle(title));
    assert.ok(f.context.slugProblemTitle('x'.repeat(300)).length <= 200);
    assert.ok(f.context.slugProblemTitle('CON.' + 'x'.repeat(250)).length <= 200);
    const unicode = f.context.slugProblemTitle('x'.repeat(199) + '😀');
    assert.equal(unicode, 'x'.repeat(199));
    assert.doesNotThrow(() => encodeURIComponent(unicode));
});

test('problem heading prefers the article and refuses ambiguous page headings', () => {
    const scoped = { textContent: 'Problem title' };
    const visible = textContent => ({
        textContent,
        closest: () => null,
        getClientRects: () => [{}],
    });
    let headings = [visible('Problem title'), { closest: () => ({}), getClientRects: () => [{}] }];
    const f = contentFixture({ document: { querySelectorAll: () => headings } });
    assert.equal(f.context.getProblemHeading({ querySelector: () => scoped }), scoped);
    const article = { querySelector: () => null };
    assert.equal(f.context.getProblemHeading(article), headings[0]);
    headings = [visible('First'), visible('Second')];
    assert.equal(f.context.getProblemHeading(article), null);
    headings = [{ closest: () => null, getClientRects: () => [] }];
    assert.equal(f.context.getProblemHeading(article), null);
});

test('description lists preserve literal comparisons and render math only from KaTeX source', () => {
    const f = contentFixture();
    const text = textContent => ({ nodeType: 3, textContent });
    const element = (tagName, childNodes, extra = {}) => ({
        nodeType: 1,
        tagName,
        childNodes,
        textContent: childNodes.map(child => child.textContent).join(''),
        classList: { contains: () => false },
        ...extra,
    });
    const math = element('SPAN', [text('x²x^2x²')], {
        classList: { contains: value => value === 'katex' },
        querySelector: () => ({ textContent: 'x^2' }),
    });
    const list = element('UL', [
        element('LI', [text('nums[0] + nums[1] == 9')]),
        element('LI', [text('Bounds: 0 < n > 1 ^ 2')]),
        element('LI', [text('Use'), math]),
    ]);
    assert.equal(
        f.context.formatArticleComponent('Example', { childNodes: [list] }),
        '# **Example**\n\n- nums[0] + nums[1] == 9\n- Bounds: 0 < n > 1 ^ 2\n- Use $x^2$',
    );
});

test('nested ordered and unordered items appear once with correct indentation', () => {
    const f = contentFixture();
    const text = textContent => ({ nodeType: 3, textContent });
    const element = (tagName, childNodes) => ({
        nodeType: 1,
        tagName,
        childNodes,
        textContent: childNodes.map(child => child.textContent).join(''),
        classList: { contains: () => false },
    });
    const nested = element('UL', [element('LI', [text('Child')])]);
    const list = element('OL', [
        element('LI', [text('Parent'), nested]),
        element('LI', [text('Sibling')]),
    ]);
    assert.equal(
        f.context.formatArticleComponent('Example', { childNodes: [list] }),
        '# **Example**\n\n1. Parent\n   - Child\n2. Sibling',
    );
});
