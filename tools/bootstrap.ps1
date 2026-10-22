# 获取已打补丁的上游 QuickJS；只校验、解包和自举，不编译或修改解释器。
$FetchOnly = $args.Count -eq 1 -and $args[0] -eq '-FetchOnly'
$BuildArguments = @($args)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$buildRoot = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -Raw -LiteralPath (Join-Path $buildRoot 'quickjs.lock.json') | ConvertFrom-Json
if ($lock.archive_sha256 -cnotmatch '^[a-f0-9]{64}$' -or $lock.binary_sha256 -cnotmatch '^[a-f0-9]{64}$' -or $lock.url -notmatch '^https://') {
    throw 'QuickJS 下载锁配置无效'
}
$cache = if ($env:DAIRN_QUICKJS_CACHE) { [IO.Path]::GetFullPath($env:DAIRN_QUICKJS_CACHE) } else { Join-Path $buildRoot '.build/quickjs' }
$binary = Join-Path $cache ('qjs-' + $lock.binary_sha256 + '.com')
$archive = Join-Path $cache ('quickjs-' + $lock.archive_sha256 + '.zip')
function Assert-Hash([string]$Path, [string]$Expected) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($actual -cne $Expected) {
        throw "SHA256 校验失败：$Path"
    }
}
if (Test-Path -LiteralPath $binary) {
    Assert-Hash $binary $lock.binary_sha256
} else {
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    if (!(Test-Path -LiteralPath $archive)) {
        if ($env:DAIRN_OFFLINE -eq '1') { throw "离线缓存缺少 QuickJS：$archive" }
        $partial = $archive + '.' + [Guid]::NewGuid().ToString('N') + '.part'
        try {
            [Console]::Error.WriteLine('下载 QuickJS：' + $lock.url)
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri $lock.url -OutFile $partial
            Assert-Hash $partial $lock.archive_sha256
            Move-Item -LiteralPath $partial -Destination $archive -Force
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
        }
    }
    Assert-Hash $archive $lock.archive_sha256
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    $partial = $binary + '.' + [Guid]::NewGuid().ToString('N') + '.part'
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -ceq $lock.member })
        if ($entries.Count -ne 1) { throw 'QuickJS 归档必须包含唯一的指定解释器文件' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $partial)
        Assert-Hash $partial $lock.binary_sha256
        Move-Item -LiteralPath $partial -Destination $binary -Force
    } finally {
        $zip.Dispose()
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
}
if ($FetchOnly) { Write-Output $binary; exit 0 }
& $binary (Join-Path $buildRoot 'tools/build-zip.mjs') --root $buildRoot --qjs $binary @BuildArguments
exit $LASTEXITCODE
