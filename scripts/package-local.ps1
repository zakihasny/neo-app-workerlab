[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [System.IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
Push-Location -LiteralPath $root
try {
  & pnpm check
  if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
  & pnpm test
  if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
  $rootFiles = @('package.json','pnpm-lock.yaml','Dockerfile','.dockerignore','.gitignore','.env.example','compose.yaml','compose.test.yaml','README.md','PROJECT.md')
  $files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
  foreach ($relative in $rootFiles) { $files.Add((Get-Item -LiteralPath (Join-Path $root $relative))) }
  foreach ($directory in @('src','public','migrations','scripts','test','docs')) {
    $folder = Get-Item -LiteralPath (Join-Path $root $directory)
    if ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source directory links are forbidden.' }
    foreach ($item in Get-ChildItem -LiteralPath $folder.FullName -Recurse -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Source link forbidden: $($item.Name)" }
      if (-not $item.PSIsContainer) { $files.Add($item) }
    }
  }
  $zipPath = Join-Path $root 'worker-validation-lab.zip'
  $temporary = Join-Path $root ('.workerlab-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $sources = @{}
  foreach ($file in $files) {
    $fullPath = [IO.Path]::GetFullPath($file.FullName)
    if (-not $fullPath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Source escaped the project.' }
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source file link forbidden.' }
    $relative = [IO.Path]::GetRelativePath($root,$fullPath).Replace('\','/')
    if ($relative -match '(^|/)(node_modules|\.git|coverage)(/|$)|\.(zip|log|pem|key|pfx)(\.|$)|(^|/)\.env($|\.)' -and $relative -ne '.env.example') { throw "Excluded file found in allowlisted source: $relative" }
    if (-not $seen.Add($relative)) { throw 'Duplicate archive path.' }
    $sources[$relative] = $fullPath
  }
  $archive = [IO.Compression.ZipFile]::Open($temporary,[IO.Compression.ZipArchiveMode]::Create)
  try { foreach ($relative in ($sources.Keys | Sort-Object)) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$sources[$relative],$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null } }
  finally { $archive.Dispose() }
  $archive = [IO.Compression.ZipFile]::OpenRead($temporary)
  try {
    if ($archive.Entries.Count -ne $sources.Count) { throw 'Entry count mismatch.' }
    foreach ($entry in $archive.Entries) {
      if (-not $sources.ContainsKey($entry.FullName)) { throw 'Unexpected ZIP entry.' }
      $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
      try { $hash = [Convert]::ToHexString($sha.ComputeHash($stream)) }
      finally { $stream.Dispose(); $sha.Dispose() }
      if ($hash -ne (Get-FileHash -LiteralPath $sources[$entry.FullName] -Algorithm SHA256).Hash) { throw "ZIP/source hash mismatch: $($entry.FullName)" }
    }
    foreach ($required in @('Dockerfile','package.json','pnpm-lock.yaml','src/start.js')) { if (-not $archive.GetEntry($required)) { throw "Root entry missing: $required" } }
  } finally { $archive.Dispose() }
  $backup = $null
  if (Test-Path -LiteralPath $zipPath) {
    $backup = $zipPath + '.' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.bak'
    [IO.File]::Move($zipPath,$backup)
  }
  [IO.File]::Move($temporary,$zipPath)
  [pscustomobject]@{ Path=$zipPath; Bytes=(Get-Item -LiteralPath $zipPath).Length; Files=$sources.Count; SHA256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash; PreviousArchiveBackup=$backup; EntryHashVerification='PASS' } | ConvertTo-Json
} finally { Pop-Location }
