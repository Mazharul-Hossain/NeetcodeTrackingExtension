/*
 * NeetcodeTrackingExtension/ -> tests/helpers/ -> extension-harness.cjs
 * Purpose: run extension scripts with isolated Chrome, fetch and DOM fixtures.
 * Agent skills: Node VM and browser API testing; use synthetic credentials only.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');

function event() {
    const listeners = [];
    return {
        listeners,
        addListener(fn) {
            listeners.push(fn);
        },
        fire(...args) {
            return listeners[0]?.(...args);
        },
    };
}

function loadScript(file, overrides = {}, transform = source => source) {
    const logs = [];
    const context = vm.createContext({
        TextEncoder,
        TextDecoder,
        Uint8Array,
        ArrayBuffer,
        URL,
        AbortController,
        crypto: webcrypto,
        setTimeout,
        clearTimeout,
        structuredClone,
        btoa: value => Buffer.from(value, 'binary').toString('base64'),
        atob: value => Buffer.from(value, 'base64').toString('binary'),
        console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
        ...overrides,
    });
    const source = transform(fs.readFileSync(path.join(root, file), 'utf8'));
    context.importScripts = (...files) =>
        files.forEach(name =>
            vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, {
                filename: name,
            }),
        );
    vm.runInContext(source, context, { filename: file });
    return { context, logs, evaluate: code => vm.runInContext(code, context) };
}

function backgroundFixture(transform) {
    return require('./worker-harness.cjs').workerFixture({ transform });
}

function contentFixture(overrides = {}, transform) {
    const chrome = { runtime: { id: 'synthetic-extension', onMessage: event() } };
    return loadScript(
        'content-script.js',
        {
            chrome,
            document: { body: { innerText: 'Data Structures & Algorithms' } },
            Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
            config: {
                github: {
                    username: 'synthetic-owner',
                    repo_name: 'synthetic-repo',
                    token: 'synthetic-test-token',
                    committer_name: 'Test',
                    committer_email: 'test@example.invalid',
                },
            },
            ...overrides,
        },
        transform,
    );
}

module.exports = { event, loadScript, backgroundFixture, contentFixture, root };
