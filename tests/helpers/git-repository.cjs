const assert = require('node:assert/strict');

// Synthetic Git Data API with branch-visible files changed only by PATCH refs.
function gitRepository({ existing = {}, branch = 'main', empty = false } = {}) {
    const files = { ...existing };
    const blobs = new Map();
    const trees = new Map();
    const commits = new Map();
    const writes = [];
    let publications = 0;
    const response = (status, data = {}) => ({
        status,
        ok: status >= 200 && status < 300,
        headers: { get: () => null },
        json: async () => data,
    });
    const fetch = async (url, init) => {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
        const body = init.body ? JSON.parse(init.body) : null;
        if (init.method !== 'GET') writes.push({ path, method: init.method, body });
        if (parsed.pathname === '/user') return response(200, { login: 'test-owner' });
        if (path === '') return response(200, { default_branch: branch, size: empty ? 0 : 1 });
        if (path.startsWith('/git/ref/')) {
            return empty ? response(404) : response(200, { object: { sha: 'head-sha' } });
        }
        if (path === '/git/commits/head-sha') {
            return response(200, { tree: { sha: 'base-tree-sha' } });
        }
        if (path.startsWith('/contents/')) {
            assert.equal(init.method, 'GET');
            assert.equal(parsed.searchParams.get('ref'), 'head-sha');
            const file = decodeURIComponent(path.slice('/contents/'.length));
            return Object.hasOwn(files, file)
                ? response(200, { type: 'file', sha: 'existing-sha' })
                : response(404);
        }
        if (path === '/git/blobs') {
            assert.equal(init.method, 'POST');
            assert.equal(body.encoding, 'base64');
            const sha = `blob-${blobs.size + 1}`;
            blobs.set(sha, Buffer.from(body.content, 'base64').toString('utf8'));
            return response(201, { sha });
        }
        if (path === '/git/trees') {
            assert.equal(body.base_tree, 'base-tree-sha');
            trees.set('new-tree-sha', body.tree);
            return response(201, { sha: 'new-tree-sha' });
        }
        if (path === '/git/commits') {
            assert.deepEqual(body.parents, ['head-sha']);
            commits.set('new-commit-sha', body);
            return response(201, { sha: 'new-commit-sha' });
        }
        if (path.startsWith('/git/refs/')) {
            assert.equal(init.method, 'PATCH');
            assert.equal(path, `/git/refs/heads/${encodeURIComponent(branch)}`);
            assert.equal(body.force, false);
            const commit = commits.get(body.sha);
            assert.ok(commit);
            for (const entry of trees.get(commit.tree)) {
                assert.equal(entry.type, 'blob');
                assert.equal(entry.mode, '100644');
                assert.ok(blobs.has(entry.sha));
                files[entry.path] = blobs.get(entry.sha);
            }
            publications++;
            return response(200);
        }
        throw new Error('Unexpected synthetic GitHub endpoint');
    };
    return {
        fetch,
        files,
        blobs,
        trees,
        commits,
        writes,
        get publications() {
            return publications;
        },
    };
}
module.exports = { gitRepository };
