/*
 * NeetcodeTrackingExtension/ -> tests/ -> pin-fixture.test.cjs
 * Purpose: verify the isolated PIN fixture opens its tab from the toolbar.
 * Agent skills: Node test runner, VM isolation and Chrome action messaging.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('PIN fixture toolbar action opens its declared options page', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'pin-vault');
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'NeetCode PIN feasibility test');
    assert.equal(manifest.options_ui.open_in_tab, true);
    assert.ok(fs.existsSync(path.join(fixture, manifest.options_ui.page)));
    assert.ok(manifest.background?.service_worker, 'Fixture needs a toolbar action handler');
    let handleClick;
    let opened = 0;
    vm.runInNewContext(fs.readFileSync(path.join(fixture, manifest.background.service_worker), 'utf8'), {
        chrome: {
            action: { onClicked: { addListener(handler) { handleClick = handler; } } },
            runtime: { async openOptionsPage() { opened++; } }
        }
    });
    assert.equal(typeof handleClick, 'function');
    await handleClick();
    assert.equal(opened, 1);
});
