/*
 * NeetcodeTrackingExtension/ -> vault-crypto.js (worker import)
 * |-- encoding/validation: canonical, bounded vault metadata
 * `-- HKDF/AES-GCM: authenticated encryption of the GitHub token
 * Purpose: encrypt durable secrets; no storage, network or PIN handling.
 * Agent skills: Web Crypto HKDF-SHA-256 and AES-GCM; never persist derived keys.
 */
'use strict';

const VaultCrypto = (() => {
    const encoder = new TextEncoder();
    const random = length => crypto.getRandomValues(new Uint8Array(length));

    function pack(value) {
        return btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join(''))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replace(/=+$/, '');
    }

    function unpack(value, min = 1, max = 2048) {
        if (
            typeof value !== 'string' ||
            value.length > Math.ceil((max * 4) / 3) ||
            !/^[A-Za-z0-9_-]+$/.test(value)
        ) {
            throw new Error('Invalid vault');
        }
        const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c =>
            c.charCodeAt(0),
        );
        if (bytes.length < min || bytes.length > max || pack(bytes) !== value) {
            throw new Error('Invalid vault');
        }
        return bytes;
    }

    function validateVault(vault) {
        if (
            !vault ||
            vault.version !== 1 ||
            typeof vault.rpId !== 'string' ||
            !/^chrome-extension:\/\/[a-p]{32}$/.test(vault.rpId)
        ) {
            throw new Error('Invalid vault');
        }
        unpack(vault.vaultId, 16, 16);
        unpack(vault.credentialId, 1, 1024);
        unpack(vault.prfSalt, 32, 32);
        unpack(vault.keySalt, 32, 32);
        unpack(vault.iv, 12, 12);
        unpack(vault.ciphertext, 17, 1040);
        return vault;
    }

    const aad = v =>
        encoder.encode(
            JSON.stringify([1, v.vaultId, v.rpId, v.credentialId, v.prfSalt, v.keySalt]),
        );

    async function deriveVaultKey(output, keySalt) {
        if (!(output instanceof Uint8Array) || output.byteLength !== 32) {
            throw new Error('Invalid key');
        }
        const material = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: keySalt,
                info: encoder.encode('NeetcodeTrackingExtension:vault:v1'),
            },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
    }

    async function encryptToken(token, output, metadata) {
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(token)) {
            throw new Error('Invalid token');
        }
        const vault = { version: 1, ...metadata, keySalt: pack(random(32)), iv: pack(random(12)) };
        const key = await deriveVaultKey(output, unpack(vault.keySalt, 32, 32));
        vault.ciphertext = pack(
            await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: unpack(vault.iv),
                    additionalData: aad(vault),
                    tagLength: 128,
                },
                key,
                encoder.encode(token),
            ),
        );
        return validateVault(vault);
    }

    async function decryptToken(vault, output) {
        validateVault(vault);
        const key = await deriveVaultKey(output, unpack(vault.keySalt, 32, 32));
        const bytes = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: unpack(vault.iv), additionalData: aad(vault), tagLength: 128 },
            key,
            unpack(vault.ciphertext),
        );
        const token = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!/^[\x21-\x7e]{1,1024}$/.test(token)) throw new Error('Invalid token');
        return token;
    }

    return { pack, unpack, random, validateVault, deriveVaultKey, encryptToken, decryptToken };
})();
