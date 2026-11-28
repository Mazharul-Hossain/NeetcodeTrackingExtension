# NeetcodeTrackingExtension/ -> scripts/ -> package-release.ps1
# Purpose: create dist/neetcode-tracking-<version>.zip with manifest.json at root.
# Agent skills: Windows PowerShell 5.1 and .NET ZIP archives; keep the README allowlist in sync.
# Never enumerate the working directory or read local credential configuration.

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseFiles = @(
    'manifest.json',
    'background.js',
    'vault-crypto.js',
    'content-script.js',
    'options.html',
    'options.js',
    'options.css',
    'icon.png',
    'LICENSE'
)

# Validate the full allowlist before reading files or changing an existing ZIP.
foreach ($name in $releaseFiles) {
    $item = Get-Item -LiteralPath (Join-Path $projectRoot $name)
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Release file must be a regular file: $name"
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+(\.\d+){0,3}$') {
    throw 'The manifest must contain a numeric Chrome extension version.'
}

$outputDirectory = Join-Path $projectRoot 'dist'
if (Test-Path -LiteralPath $outputDirectory) {
    $directory = Get-Item -LiteralPath $outputDirectory
    if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The release output directory must be a regular directory.'
    }
} else {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}
$outputPath = Join-Path $outputDirectory "neetcode-tracking-$version.zip"
if (Test-Path -LiteralPath $outputPath) {
    $previous = Get-Item -LiteralPath $outputPath
    if ($previous.PSIsContainer -or ($previous.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The existing release ZIP must be a regular file.'
    }
}
$temporaryPath = Join-Path $outputDirectory ('.release-' + [guid]::NewGuid().ToString('N') + '.zip')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

try {
    $archive = [IO.Compression.ZipFile]::Open($temporaryPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $releaseFiles) {
            # Explicit entry names keep files at ZIP root, without a project folder.
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                (Join-Path $projectRoot $name),
                $name,
                [IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }

    $archive = [IO.Compression.ZipFile]::OpenRead($temporaryPath)
    try {
        if ($archive.Entries.Count -ne $releaseFiles.Count -or -not $archive.GetEntry('manifest.json')) {
            throw 'Release ZIP verification failed.'
        }
        foreach ($entry in $archive.Entries) {
            if ($releaseFiles -cnotcontains $entry.FullName) {
                throw 'The release ZIP contains an unexpected entry.'
            }
        }
    } finally {
        $archive.Dispose()
    }

    Move-Item -LiteralPath $temporaryPath -Destination $outputPath -Force
    Write-Output "Created $outputPath"
} finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath
    }
}
