import js from '@eslint/js';
import globals from 'globals';

// Extension files are classic scripts (not ES modules): top-level declarations are
// shared through importScripts (worker) or read by the Node VM test harness.
const script = { sourceType: 'script', ecmaVersion: 'latest' };
const unusedVars = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true };

export default [
    { ignores: ['node_modules/', 'dist/'] },
    js.configs.recommended,
    {
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: {
            curly: ['error', 'multi-line'],
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': ['error', unusedVars],
        },
    },
    {
        files: ['background.js'],
        languageOptions: {
            ...script,
            globals: {
                ...globals.serviceworker,
                ...globals.webextensions,
                VaultCrypto: 'readonly',
            },
        },
        rules: {
            // Validation regexes match control characters on purpose, in order to reject them.
            'no-control-regex': 'off',
        },
    },
    {
        files: ['vault-crypto.js'],
        languageOptions: { ...script, globals: globals.serviceworker },
        rules: {
            // Defined here, consumed by background.js through importScripts().
            'no-unused-vars': ['error', { ...unusedVars, varsIgnorePattern: '^(_|VaultCrypto$)' }],
        },
    },
    {
        files: ['options.js'],
        languageOptions: { ...script, globals: { ...globals.browser, ...globals.webextensions } },
        rules: {
            // Awaited by the options-page tests to know the initial load has finished.
            'no-unused-vars': ['error', { ...unusedVars, varsIgnorePattern: '^(_|optionsReady$)' }],
        },
    },
    {
        files: ['content-script.js', 'tests/fixtures/**/*.js'],
        languageOptions: { ...script, globals: { ...globals.browser, ...globals.webextensions } },
    },
    {
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs', ecmaVersion: 'latest', globals: globals.node },
    },
];
