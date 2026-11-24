/*
 * NeetcodeTrackingExtension/ -> tests/fixtures/pin-vault/ -> probe.js
 * Purpose: test real passkey PRF enrollment and PIN-assisted decryption of
 * synthetic data across browser restarts, without GitHub or external requests.
 * Agent skills: WebAuthn PRF and Web Crypto; authenticator prompts are user-only.
 * This disposable fixture is not production credential-handling code.
 */
'use strict';

const RECORD_KEY = 'pinFeasibilityVault';
const TEST_MESSAGE = 'NeetCode synthetic PIN feasibility sentinel';
const encoder = new TextEncoder();
const statusElement = document.getElementById('status');
const enrollButton = document.getElementById('enroll');
const unlockButton = document.getElementById('unlock');
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
}

function pack(bytes) {
    return Array.from(new Uint8Array(bytes));
}

async function deriveKey(prfOutput, keySalt) {
    const source = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt: keySalt,
        info: encoder.encode('NeetCode:synthetic-PIN-feasibility:v1')
    }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function authenticate(credentialId, prfSalt) {
    // Omit rpId so Chrome uses its extension-origin-specific default.
    const credential = await navigator.credentials.get({ publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required', timeout: 120000,
        extensions: { prf: { eval: { first: prfSalt } } }
    } });
    const output = credential?.getClientExtensionResults().prf?.results?.first;
    if (!output || output.byteLength !== 32) {
        const error = new Error('PRF unsupported');
        error.name = 'PrfUnsupported';
        throw error;
    }
    return output;
}

async function enroll() {
    await storageReady;
    const existing = (await chrome.storage.local.get(RECORD_KEY))[RECORD_KEY];
    if (existing) {
        statusElement.textContent = 'Test data already enrolled. Use Unlock and verify; existing data was preserved.';
        return;
    }
    const prfSalt = randomBytes(32);
    // Omit rp.id for the same extension-default RP used during authentication.
    const credential = await navigator.credentials.create({ publicKey: {
        challenge: randomBytes(32), rp: { name: 'NeetCode PIN feasibility test' },
        user: { id: randomBytes(32), name: 'synthetic-test', displayName: 'Synthetic test only' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none', timeout: 120000,
        extensions: { prf: { eval: { first: prfSalt } } }
    } });
    if (!credential) throw new DOMException('Cancelled', 'NotAllowedError');
    statusElement.textContent = 'Test passkey created. Approve the next prompt to check PRF decryption support.';
    const prfOutput = await authenticate(credential.rawId, prfSalt);
    const keySalt = randomBytes(32);
    const iv = randomBytes(12);
    const key = await deriveKey(prfOutput, keySalt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(TEST_MESSAGE));
    await chrome.storage.local.set({ [RECORD_KEY]: {
        credentialId: pack(credential.rawId), prfSalt: pack(prfSalt),
        keySalt: pack(keySalt), iv: pack(iv), ciphertext: pack(ciphertext)
    } });
    statusElement.textContent = 'ENROLLMENT PASS: PRF encryption succeeded. Fully exit and restart Chrome, return here, then choose Unlock and verify.';
}

async function unlock() {
    await storageReady;
    const record = (await chrome.storage.local.get(RECORD_KEY))[RECORD_KEY];
    if (!record) {
        statusElement.textContent = 'No encrypted test data. Enroll first.';
        return;
    }
    const prfOutput = await authenticate(new Uint8Array(record.credentialId), new Uint8Array(record.prfSalt));
    const key = await deriveKey(prfOutput, new Uint8Array(record.keySalt));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv) },
        key, new Uint8Array(record.ciphertext));
    if (new TextDecoder().decode(plaintext) !== TEST_MESSAGE) throw new Error('Round trip failed');
    statusElement.textContent = 'UNLOCK PASS: the saved ciphertext decrypted with this passkey. Report this status, Chrome/Windows versions, the provider, and whether you used its PIN.';
}

async function run(operation) {
    enrollButton.disabled = true;
    unlockButton.disabled = true;
    statusElement.textContent = 'Waiting for the browser/provider. Complete its prompts yourself; never share your PIN.';
    try {
        await operation();
    } catch (error) {
        const messages = {
            PrfUnsupported: 'UNSUPPORTED: this credential/provider did not return PRF output. No encrypted test data was saved by this attempt.',
            NotAllowedError: 'NOT COMPLETED: prompt cancelled, timed out, or this authenticator is unavailable.',
            SecurityError: 'UNSUPPORTED: Chrome rejected the extension relying-party/origin configuration.',
            OperationError: 'FAILED: cryptographic operation failed. Existing encrypted test data was preserved.'
        };
        statusElement.textContent = messages[error?.name] || 'FAILED: test could not complete. Existing encrypted test data was preserved.';
    } finally {
        enrollButton.disabled = false;
        unlockButton.disabled = false;
    }
}

enrollButton.addEventListener('click', () => run(enroll));
unlockButton.addEventListener('click', () => run(unlock));
// Handle initialization failure immediately rather than leaving an unhandled rejection.
storageReady.catch(() => {
    statusElement.textContent = 'UNAVAILABLE: trusted-context local storage could not be initialized.';
    enrollButton.disabled = true;
    unlockButton.disabled = true;
});
