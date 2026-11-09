[CmdletBinding()]
param(
    [ValidateRange(1, 10)]
    [int]$Runs = 5,
    [string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$npmCommand = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }
$startedAt = [DateTime]::UtcNow.ToString('o')
$results = [System.Collections.Generic.List[object]]::new()

Push-Location $repoRoot
try {
    $headSha = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify checkout commit.' }
    if (& git status --porcelain) { throw 'Commit or stash local changes before running the release gate.' }
    $nodeVersion = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw 'Node.js 24 LTS is required.' }
    $npmVersion = (& $npmCommand --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $npmVersion -notmatch '^(10|11)\.') { throw 'npm 10 or 11 is required.' }

    # Unlike the historical Mac gate, release verification must not silently skip browser tests.
    $chromeCandidates = @(
        $env:CHROME_PATH
        if ($env:PROGRAMFILES) { Join-Path $env:PROGRAMFILES 'Google/Chrome/Application/chrome.exe' }
        if (${env:PROGRAMFILES(X86)}) { Join-Path ${env:PROGRAMFILES(X86)} 'Google/Chrome/Application/chrome.exe' }
        if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe' }
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        '/usr/bin/google-chrome'
        '/usr/bin/chromium'
        '/usr/bin/chromium-browser'
    )
    $chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $chrome) { throw 'Chrome is required for release verification. Set CHROME_PATH to its executable.' }
    $env:CHROME_PATH = $chrome

    if (-not $EvidenceDirectory) {
        $EvidenceDirectory = Join-Path ([IO.Path]::GetTempPath()) ('klavierhaus-local-ci-' + $headSha.Substring(0, 12) + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
    }
    $EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
    if (Test-Path -LiteralPath $EvidenceDirectory) { throw 'Use a new evidence directory to preserve earlier runs.' }
    New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null

    function Invoke-GateStep([string]$Label, [string]$Command, [string[]]$CommandArgs) {
        $logPath = Join-Path $EvidenceDirectory ($Label + '.log')
        Write-Output "[LOCAL-CI] $Label"
        & $Command @CommandArgs *> $logPath
        $stepExitCode = $LASTEXITCODE
        $results.Add([ordered]@{
            step = $Label
            command = $Command
            arguments = $CommandArgs
            exitCode = $stepExitCode
            log = [IO.Path]::GetFileName($logPath)
            sha256 = (Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLowerInvariant()
        })
        Get-Content -LiteralPath $logPath -Tail 8
        if ($stepExitCode -ne 0) { throw "$Label failed (exit $stepExitCode). See $logPath" }
    }

    Write-Output "[LOCAL-CI] $headSha / $nodeVersion / npm $npmVersion / $([Environment]::OSVersion)"
    Invoke-GateStep 'diff-check' 'git' @('diff', '--check')
    Invoke-GateStep 'manifests' $npmCommand @('run', 'check:manifests')
    Invoke-GateStep 'erp-install' $npmCommand @('ci', '--no-audit', '--no-fund')
    Invoke-GateStep 'assets' $npmCommand @('run', 'check:assets')
    Invoke-GateStep 'assets-http' $npmCommand @('run', 'check:assets:http')
    Invoke-GateStep 'migration' $npmCommand @('run', 'check:migration')
    Invoke-GateStep 'erp-check' $npmCommand @('run', 'check')
    for ($run = 1; $run -le $Runs; $run++) {
        Invoke-GateStep "erp-tests-$run" $npmCommand @('test')
    }
    Push-Location (Join-Path $repoRoot 'website')
    try {
        Invoke-GateStep 'website-install' $npmCommand @('ci', '--no-audit', '--no-fund')
        Invoke-GateStep 'website-check' $npmCommand @('run', 'check')
        Invoke-GateStep 'website-tests' $npmCommand @('test')
        Invoke-GateStep 'website-audit' $npmCommand @('audit', '--omit=dev', '--audit-level=high', '--json')
    } finally { Pop-Location }
    Invoke-GateStep 'erp-audit' $npmCommand @('audit', '--omit=dev', '--audit-level=high', '--json')

    $finalSha = (& git rev-parse HEAD).Trim()
    if ($finalSha -ne $headSha -or (& git status --porcelain)) { throw 'Checkout changed during verification; results cannot attest this commit.' }
    $evidence = [ordered]@{
        status = 'success'
        commit = $headSha
        startedAt = $startedAt
        completedAt = [DateTime]::UtcNow.ToString('o')
        platform = [Environment]::OSVersion.ToString()
        node = $nodeVersion
        npm = $npmVersion
        erpRuns = $Runs
        browser = $chrome
        steps = $results
    }
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'result.json') -Encoding utf8
    Write-Output "[LOCAL-CI] All checks passed. Evidence: $EvidenceDirectory"
} finally { Pop-Location }
