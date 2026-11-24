/*
 * NeetcodeTrackingExtension/ -> tests/ -> manifest.test.cjs
 * Purpose: check shipped resources and absence of legacy credential exposure.
 * Agent skills: Manifest V3 JSON and extension package boundaries.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./helpers/extension-harness.cjs');
test('manifest loads settings and content script without any config file', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.options_ui?.page, 'options.html');
    assert.equal(manifest.options_ui.open_in_tab, true);
    assert.deepEqual(manifest.content_scripts[0].js, ['content-script.js']);
    assert.equal(manifest.content_scripts[0].all_frames, false);
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.deepEqual(manifest.permissions.slice().sort(), ['activeTab', 'scripting', 'storage', 'webRequest'].sort());
    for (const resource of [manifest.options_ui.page, manifest.background.service_worker, ...manifest.content_scripts[0].js, 'vault-crypto.js', 'options.js', 'options.css']) {
        assert.ok(fs.existsSync(path.join(root, resource)), `${resource} must be shipped`);
    }
});
test('untrusted content script has no credential, storage or authenticated networking code', () => {
    const source = fs.readFileSync(path.join(root, 'content-script.js'), 'utf8');
    assert.doesNotMatch(source, /config\.github|Authorization|api\.github\.com|chrome\.storage|\bfetch\s*\(/);
    const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
    assert.doesNotMatch(options, /<script[^>]*src=["']https?:|on(?:click|submit)=/i);
});
test('native form fallback cannot put the token into the URL', () => {
    const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
    const input = html.match(/<input\b[^>]*id="github-token"[^>]*>/)[0];
    assert.doesNotMatch(input, /\bname\s*=/i);
});
