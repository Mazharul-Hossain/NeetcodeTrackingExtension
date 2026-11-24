const test = require('node:test');
const assert = require('node:assert/strict');
const {
    workerFixture,
    configure,
    problemSender,
    payload,
    fields,
    response,
} = require('./helpers/worker-harness.cjs');
const { gitRepository } = require('./helpers/git-repository.cjs');
const folder = `${payload.category}/${payload.title}`;
const solutionPath = `${folder}/solution.py`;
const problemPath = `${folder}/problem.md`;

async function save(server, change = {}, fetch = server.fetch) {
    const f = workerFixture({ fetch });
    await configure(f);
    const result = await f.request(
        { type: 'UPLOAD_PROBLEM', payload: { ...payload, ...change } },
        problemSender,
    );
    return { f, result };
}

test('new solutions and descriptions publish in one commit with UTF-8 content and preserved base tree', async () => {
    const server = gitRepository({ branch: 'solutions/practice' });
    const { f, result } = await save(server);
    assert.equal(result.ok, true);
    assert.equal(result.updated, false);
    assert.equal(server.publications, 1);
    assert.equal(server.files[solutionPath], 'café');
    assert.equal(server.files[problemPath], '# Problem');
    assert.deepEqual(
        server.writes.map(write => write.method),
        ['POST', 'POST', 'POST', 'POST', 'PATCH'],
    );
    assert.equal(server.commits.size, 1);
    const commit = [...server.commits.values()][0];
    assert.equal(commit.message, 'Added two-sum on 2026-11-23');
    assert.deepEqual(commit.committer, {
        name: fields.committerName,
        email: fields.committerEmail,
    });
    assert.deepEqual(commit.author, commit.committer);
    assert.ok(
        f.calls.some(call =>
            call[0].includes(
                '/Data%20Structures%20%26%20Algorithms/two-sum/solution.py?ref=head-sha',
            ),
        ),
    );
    assert.ok(f.calls.every(call => call[1].redirect === 'error'));
    assert.equal(JSON.stringify(result).includes(fields.token), false);
    assert.equal(JSON.stringify(result).includes('café'), false);
});

test('repeat saves update the solution and preserve existing notes, front matter and description', async () => {
    const notes =
        '---\ncreated: 2020-01-01\ntags: [custom]\n---\n## Notes\nSynthetic notes\n---\nOriginal description';
    const server = gitRepository({
        existing: { [solutionPath]: 'old solution', [problemPath]: notes },
    });
    const { result } = await save(server);
    assert.equal(result.ok, true);
    assert.equal(result.updated, true);
    assert.equal(server.files[solutionPath], 'café');
    assert.equal(server.files[problemPath], notes);
    assert.equal(result.files.find(file => file.kind === 'problem').skipped, true);
    assert.equal(server.blobs.size, 1);
    assert.equal([...server.commits.values()][0].message, 'Updated two-sum on 2026-11-23');
    assert.deepEqual(
        [...server.trees.values()][0].map(file => file.path),
        [solutionPath],
    );
});

test('description-only saves create one commit or skip existing Markdown without writes', async () => {
    const change = { files: payload.files.filter(file => file.kind === 'problem') };
    const missing = gitRepository();
    assert.equal((await save(missing, change)).result.ok, true);
    assert.equal(missing.publications, 1);
    assert.deepEqual(Object.keys(missing.files), [problemPath]);
    const existing = gitRepository({ existing: { [problemPath]: 'Keep synthetic notes' } });
    const { result } = await save(existing, change);
    assert.equal(result.ok, true);
    assert.equal(result.files[0].skipped, true);
    assert.equal(result.unchanged, true);
    assert.equal(existing.writes.length, 0);
    assert.equal(existing.files[problemPath], 'Keep synthetic notes');
});

test('failures at every preparation stage leave both branch files unchanged', async () => {
    // Repository, ref, parent, both existence reads, both blobs, tree, commit and ref update.
    for (let failAt = 1; failAt <= 10; failAt++) {
        const server = gitRepository();
        let calls = 0;
        const { result, f } = await save(server, {}, async (...args) => {
            if (++calls === failAt) return response(403, { message: 'private response' });
            return server.fetch(...args);
        });
        assert.equal(result.ok, false, `stage ${failAt}`);
        assert.equal(result.error.code, 'ACCESS_DENIED');
        assert.equal('files' in result, false, 'Unpublished objects are not saved files');
        assert.equal(server.publications, 0);
        assert.deepEqual(server.files, {});
        assert.equal(f.calls.length, failAt);
        assert.doesNotMatch(JSON.stringify(result), /private response/);
    }
});

test('a concurrent branch update rejects the final publication without forcing or partial changes', async () => {
    const server = gitRepository({
        existing: { [solutionPath]: 'original', [problemPath]: 'notes' },
    });
    const { result } = await save(server, {}, async (url, init) => {
        if (init.method === 'PATCH') {
            assert.equal(JSON.parse(init.body).force, false);
            return response(422, { message: 'non-fast-forward private response' });
        }
        return server.fetch(url, init);
    });
    assert.equal(result.error.code, 'CONFLICT');
    assert.equal(server.publications, 0);
    assert.equal(server.files[solutionPath], 'original');
    assert.equal(server.files[problemPath], 'notes');
});

test('lost final confirmation can publish both files but never only one', async () => {
    const server = gitRepository();
    const { result } = await save(server, {}, async (url, init) => {
        const reply = await server.fetch(url, init);
        if (init.method === 'PATCH') throw new Error('private transport failure');
        return reply;
    });
    assert.equal(result.error.code, 'NETWORK_ERROR');
    assert.equal(server.publications, 1);
    assert.equal(server.files[solutionPath], 'café');
    assert.equal(server.files[problemPath], '# Problem');
});

test('empty repositories fail before any writes with an actionable message', async () => {
    const server = gitRepository({ empty: true });
    const { result } = await save(server);
    assert.equal(result.error.code, 'REPO_EMPTY');
    assert.match(result.error.message, /Initialize/);
    assert.equal(server.writes.length, 0);
});

test('missing Git objects and malformed create responses cannot publish a commit', async () => {
    for (const missing of ['/git/commits/head-sha', '/git/blobs', '/git/trees', '/git/commits']) {
        const server = gitRepository();
        const { result } = await save(server, {}, async (url, init) =>
            url.endsWith(missing)
                ? response(init.method === 'GET' ? 404 : 201, {})
                : server.fetch(url, init),
        );
        assert.equal(result.ok, false);
        assert.equal(server.publications, 0);
        assert.deepEqual(server.files, {});
    }
});

test('GitHub empty-database 409 responses report initialization rather than a retry conflict', async () => {
    const server = gitRepository({ empty: true });
    const { result } = await save(server, {}, async (url, init) =>
        url.includes('/git/ref/') ? response(409) : server.fetch(url, init),
    );
    assert.equal(result.error.code, 'REPO_EMPTY');
    assert.equal(server.writes.length, 0);
});

test('locking during preparation prevents publication and leaves the branch unchanged', async () => {
    const server = gitRepository();
    let locking;
    const f = workerFixture({
        fetch: async (url, init) => {
            const reply = await server.fetch(url, init);
            if (url.endsWith('/git/trees') && init.method === 'POST') {
                locking = f.request({ type: 'LOCK_VAULT' });
            }
            return reply;
        },
    });
    await configure(f);
    const result = await f.request({ type: 'UPLOAD_PROBLEM', payload }, problemSender);
    await locking;
    assert.equal(result.error.code, 'SETTINGS_CHANGED');
    assert.equal(server.publications, 0);
    assert.deepEqual(server.files, {});
});

test('saving identical code twice does not create or publish an empty second commit', async () => {
    const server = gitRepository();
    const first = await save(server);
    assert.equal(first.result.unchanged, false);
    const before = server.writes.length;
    const second = await save(server);
    assert.equal(second.result.ok, true);
    assert.equal(second.result.unchanged, true);
    assert.equal(second.result.updated, false);
    assert.ok(second.result.files.every(file => file.skipped && !file.updated));
    assert.deepEqual(
        server.writes.slice(before).map(write => write.path),
        ['/git/blobs', '/git/trees'],
    );
    assert.equal(server.publications, 1);
    assert.equal(server.commits.size, 1);
    assert.equal(server.files[solutionPath], 'café');
});

test('unchanged code still creates a commit when the problem Markdown is missing', async () => {
    const server = gitRepository({ existing: { [solutionPath]: 'café' } });
    const { result } = await save(server);
    assert.equal(result.unchanged, false);
    assert.equal(server.publications, 1);
    assert.equal(server.files[problemPath], '# Problem');
});
