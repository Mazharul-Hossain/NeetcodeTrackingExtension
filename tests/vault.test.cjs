/*
 * NeetcodeTrackingExtension/ -> tests/ -> vault.test.cjs
 * Purpose: verify actual vault encryption and fail-closed tamper handling.
 * Agent skills: Web Crypto HKDF/AES-GCM and Node test runner.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript, root } = require('./helpers/extension-harness.cjs');

function api() {
    assert.ok(fs.existsSync(path.join(root, 'vault-crypto.js')), 'Vault encryption implementation must exist');
    return loadScript('vault-crypto.js').evaluate('VaultCrypto');
}
const bytes = n => new Uint8Array(n).fill(7);
function metadata(v) {
    return { vaultId: v.pack(bytes(16)), rpId: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', credentialId: v.pack(bytes(32)), prfSalt: v.pack(bytes(32)) };
}
test('vault encrypts UTF-8 token and decrypts only with its PRF key', async () => {
    const v = api();
    const record = await v.encryptToken('synthetic-token', bytes(32), metadata(v));
    assert.equal(JSON.stringify(record).includes('synthetic-token'), false);
    assert.equal('token' in record, false);
    assert.equal(await v.decryptToken(record, bytes(32)), 'synthetic-token');
    await assert.rejects(v.decryptToken(record, new Uint8Array(32).fill(8)));
});
test('every encryption gets fresh salt and IV', async () => {
    const v = api();
    const first = await v.encryptToken('synthetic-token', bytes(32), metadata(v));
    const second = await v.encryptToken('synthetic-token', bytes(32), metadata(v));
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.keySalt, second.keySalt);
    assert.notEqual(first.ciphertext, second.ciphertext);
});
test('tampered ciphertext and authenticated metadata cannot decrypt', async () => {
    const v = api();
    const record = await v.encryptToken('synthetic-token', bytes(32), metadata(v));
    for (const key of ['ciphertext', 'iv', 'keySalt', 'prfSalt', 'credentialId', 'vaultId']) {
        const raw = v.unpack(record[key]);
        raw[0] ^= 1;
        await assert.rejects(v.decryptToken({ ...record, [key]: v.pack(raw) }, bytes(32)), key);
    }
    await assert.rejects(v.decryptToken({ ...record, rpId: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, bytes(32)));
});
test('unknown versions, malformed lengths and invalid PRF keys fail closed', async () => {
    const v = api();
    const record = await v.encryptToken('synthetic-token', bytes(32), metadata(v));
    await assert.rejects(v.decryptToken({ ...record, version: 99 }, bytes(32)));
    await assert.rejects(v.decryptToken({ ...record, iv: 'bad!' }, bytes(32)));
    await assert.rejects(v.encryptToken('synthetic-token', bytes(31), metadata(v)));
});
