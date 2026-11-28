/*
 * NeetcodeTrackingExtension/ -> tests/ -> release.test.cjs
 * Purpose: verify the Windows release ZIP layout and explicit file allowlist.
 * Agent skills: PowerShell/.NET ZIP packaging; use synthetic fixture data only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const files = [
    'manifest.json',
    'background.js',
    'vault-crypto.js',
    'content-script.js',
    'options.html',
    'options.js',
    'options.css',
    'icon.png',
    'LICENSE',
];
const windowsOnly = { skip: process.platform !== 'win32' };

function fixture(t, version = '2.0.0') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neetcode-release-'));
    // One known temporary fixture directory; never remove a project directory.
    t.after(() => {
        assert.ok(
            path
                .resolve(root)
                .startsWith(path.resolve(os.tmpdir()) + path.sep + 'neetcode-release-'),
        );
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(
        path.join(__dirname, '../scripts/package-release.ps1'),
        path.join(root, 'scripts/package-release.ps1'),
    );
    for (const file of files) fs.writeFileSync(path.join(root, file), 'Synthetic fixture');
    fs.writeFileSync(
        path.join(root, 'manifest.json'),
        JSON.stringify({ manifest_version: 3, version }),
    );
    fs.writeFileSync(path.join(root, 'development-only.txt'), 'Must not be packaged');
    const zip = path.join(root, 'dist/neetcode-tracking-2.0.0.zip');
    const run = () =>
        spawnSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-File',
                path.join(root, 'scripts/package-release.ps1'),
            ],
            { encoding: 'utf8', timeout: 30000 },
        );
    return { root, zip, run };
}

test(
    'release ZIP contains exactly the allowlist at its root and can be rebuilt',
    windowsOnly,
    t => {
        const f = fixture(t);
        for (let i = 0; i < 2; i++) {
            const contents = `Synthetic fixture revision ${i}`;
            fs.writeFileSync(path.join(f.root, 'background.js'), contents);
            const result = f.run();
            assert.equal(result.status, 0, result.stderr || result.error?.message);
            const zipPath = f.zip.replaceAll("'", "''");
            const inspect = spawnSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [IO.Compression.ZipFile]::OpenRead('${zipPath}'); try { $reader = [IO.StreamReader]::new($archive.GetEntry('background.js').Open()); try { $contents = $reader.ReadToEnd() } finally { $reader.Dispose() }; @{ names = @($archive.Entries | ForEach-Object { $_.FullName }); contents = $contents } | ConvertTo-Json -Compress } finally { $archive.Dispose() }`,
                ],
                { encoding: 'utf8', timeout: 30000 },
            );
            assert.equal(inspect.status, 0, inspect.stderr);
            const archive = JSON.parse(inspect.stdout);
            assert.deepEqual(archive.names.sort(), [...files].sort());
            assert.equal(archive.contents, contents);
        }
        assert.equal(fs.readdirSync(path.dirname(f.zip)).length, 1, 'No staging files remain');
    },
);

test('missing release files fail without replacing the last valid ZIP', windowsOnly, t => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    const digest = () => createHash('sha256').update(fs.readFileSync(f.zip)).digest('hex');
    const before = digest();
    fs.unlinkSync(path.join(f.root, 'background.js'));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /background\.js/);
    assert.equal(digest(), before);
});

test('unsafe manifest versions cannot determine an output path', windowsOnly, t => {
    const f = fixture(t, '../../outside');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /numeric Chrome extension version/);
    assert.equal(fs.existsSync(path.join(f.root, 'dist')), false);
});

test('release packaging rejects file and directory mix-ups', windowsOnly, t => {
    for (const kind of ['source directory', 'output file', 'ZIP directory']) {
        const f = fixture(t);
        let expected;
        if (kind === 'source directory') {
            const source = path.join(f.root, 'icon.png');
            fs.unlinkSync(source);
            fs.mkdirSync(source);
            expected = /Release file must be a regular file/;
        } else if (kind === 'output file') {
            fs.writeFileSync(path.join(f.root, 'dist'), 'Synthetic fixture');
            expected = /output directory must be a regular directory/;
        } else {
            fs.mkdirSync(f.zip, { recursive: true });
            expected = /existing release ZIP must be a regular file/;
        }
        const result = f.run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, expected);
    }
});
