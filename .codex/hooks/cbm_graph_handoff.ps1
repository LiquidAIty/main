$ErrorActionPreference = 'Stop'

function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string[]] $Arguments,

        [switch] $DiscardStandardError
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if ($DiscardStandardError) {
            $lines = @(& $Executable @Arguments 2>$null | ForEach-Object { [string]$_ })
        } else {
            $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { [string]$_ })
        }
        $nativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    [pscustomobject]@{
        ExitCode = $nativeExitCode
        Lines = $lines
        Text = ($lines -join "`n")
    }
}

function Resolve-GitRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    $result = Invoke-NativeCapture -Executable 'git' -Arguments @(
        '-C', $Path, 'rev-parse', '--show-toplevel'
    ) -DiscardStandardError
    if ($result.ExitCode -ne 0 -or $result.Lines.Count -ne 1) { return $null }
    try {
        return [IO.Path]::GetFullPath($result.Lines[0].Trim()).TrimEnd([char[]]'\/')
    } catch {
        return $null
    }
}

function Get-CbmPayload {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject] $Result
    )

    for ($index = $Result.Lines.Count - 1; $index -ge 0; $index--) {
        $line = $Result.Lines[$index].Trim()
        if (-not ($line.StartsWith('{') -and $line.EndsWith('}'))) { continue }
        try { return ($line | ConvertFrom-Json) } catch { continue }
    }
    return $null
}

function Get-CbmStructuredContent {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject] $Result
    )

    $payload = Get-CbmPayload -Result $Result
    if ($null -eq $payload) { return $null }
    if ($null -ne $payload.PSObject.Properties['structuredContent']) {
        return $payload.structuredContent
    }
    if ($null -ne $payload.PSObject.Properties['content'] -and $payload.content.Count -gt 0) {
        $text = [string]$payload.content[0].text
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            try { return ($text | ConvertFrom-Json) } catch { return $null }
        }
    }
    return $null
}

function Get-CbmFailure {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject] $Result
    )

    $text = ($Result.Text -replace '\s+', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return "exit=$($Result.ExitCode)" }
    if ($text.Length -gt 600) { return $text.Substring($text.Length - 600) }
    return $text
}

function Test-CbmErrorPayload {
    param(
        [AllowNull()]
        [object] $Payload
    )

    return $null -ne $Payload -and
        $null -ne $Payload.PSObject.Properties['isError'] -and
        [bool]$Payload.isError
}

function Invoke-CbmCli {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    return Invoke-NativeCapture -Executable $Executable -Arguments $Arguments
}

function Invoke-ExactProjectDelete {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string] $ProjectName
    )

    $result = Invoke-CbmCli -Executable $Executable -Arguments @(
        'cli', '--json', 'delete_project', '--project', $ProjectName
    )
    $payload = Get-CbmPayload -Result $result
    $structured = Get-CbmStructuredContent -Result $result
    $status = if ($null -ne $structured) { [string]$structured.status } else { '' }
    $reportedProject = if ($null -ne $structured) { [string]$structured.project } else { '' }

    if ($status -ceq 'not_found' -and $reportedProject -ceq $ProjectName) {
        return [pscustomobject]@{ Status = 'not_found' }
    }
    if ($result.ExitCode -ne 0 -or (Test-CbmErrorPayload -Payload $payload)) {
        throw "delete_project failed with exit $($result.ExitCode): $(Get-CbmFailure -Result $result)"
    }
    if ($reportedProject -cne $ProjectName) {
        throw "delete_project returned the wrong project identity: $reportedProject"
    }
    return [pscustomobject]@{ Status = $(if ($status) { $status } else { 'deleted' }) }
}

function Get-ReadyIndexStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string] $ProjectName,

        [Parameter(Mandatory = $true)]
        [string] $RepoRoot
    )

    $result = Invoke-CbmCli -Executable $Executable -Arguments @(
        'cli', '--json', 'index_status', '--project', $ProjectName
    )
    $payload = Get-CbmPayload -Result $result
    $structured = Get-CbmStructuredContent -Result $result
    if ($result.ExitCode -ne 0 -or (Test-CbmErrorPayload -Payload $payload) -or $null -eq $structured) {
        throw "index_status failed with exit $($result.ExitCode): $(Get-CbmFailure -Result $result)"
    }

    $reportedProject = [string]$structured.project
    $reportedRoot = ([string]$structured.root_path).Replace('\', '/').TrimEnd('/')
    $reportedStatus = [string]$structured.status
    if ($reportedProject -cne $ProjectName) {
        throw "index_status returned the wrong project identity: $reportedProject"
    }
    if ($reportedRoot -ine $RepoRoot) {
        throw "index_status returned the wrong root: $reportedRoot"
    }
    if ($reportedStatus -ine 'ready') {
        throw "index_status is not ready: $reportedStatus"
    }
    if ($null -eq $structured.PSObject.Properties['nodes'] -or
        $null -eq $structured.PSObject.Properties['edges']) {
        throw 'index_status omitted node or edge counts'
    }

    $nodeCount = 0L
    $edgeCount = 0L
    if (-not [long]::TryParse([string]$structured.nodes, [ref]$nodeCount) -or
        -not [long]::TryParse([string]$structured.edges, [ref]$edgeCount)) {
        throw 'index_status returned non-numeric node or edge counts'
    }

    [pscustomobject]@{
        Project = $reportedProject
        Root = $reportedRoot
        Status = $reportedStatus
        Nodes = $nodeCount
        Edges = $edgeCount
        ParsePartialFiles = if ($null -ne $structured.parse_partial) { [long]$structured.parse_partial.count } else { 0 }
        SkippedFiles = if ($null -ne $structured.skipped) { [long]$structured.skipped.count } else { 0 }
    }
}

function Assert-UniqueCanonicalProject {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string] $ProjectName,

        [Parameter(Mandatory = $true)]
        [string] $RepoRoot
    )

    $result = Invoke-CbmCli -Executable $Executable -Arguments @(
        'cli', '--json', 'list_projects', '--offset', '0',
        '--limit', '100', '--include-details', 'true'
    )
    $payload = Get-CbmPayload -Result $result
    $structured = Get-CbmStructuredContent -Result $result
    if ($result.ExitCode -ne 0 -or (Test-CbmErrorPayload -Payload $payload) -or $null -eq $structured) {
        throw "list_projects failed with exit $($result.ExitCode): $(Get-CbmFailure -Result $result)"
    }
    if ([bool]$structured.has_more) {
        throw 'list_projects returned more projects than one verification call can prove unique'
    }

    $matches = @($structured.projects | Where-Object { [string]$_.name -ceq $ProjectName })

    if ($matches.Count -ne 1) {
        throw "expected exactly one canonical project, found $($matches.Count)"
    }
    $reportedRoot = ([string]$matches[0].root_path).Replace('\', '/').TrimEnd('/')
    if ($reportedRoot -ine $RepoRoot) {
        throw "canonical project has the wrong root: $reportedRoot"
    }
}

function Invoke-FullCanonicalBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string] $ProjectName,

        [Parameter(Mandatory = $true)]
        [string] $RepoRoot
    )

    $started = [DateTime]::UtcNow
    $delete = Invoke-ExactProjectDelete -Executable $Executable -ProjectName $ProjectName
    $indexResult = Invoke-CbmCli -Executable $Executable -Arguments @(
        'cli', '--json', 'index_repository',
        '--repo-path', $RepoRoot,
        '--name', $ProjectName,
        '--mode', 'full',
        '--persistence', 'false'
    )
    $indexPayload = Get-CbmPayload -Result $indexResult
    $indexStructured = Get-CbmStructuredContent -Result $indexResult
    if ($indexResult.ExitCode -ne 0 -or (Test-CbmErrorPayload -Payload $indexPayload) -or $null -eq $indexStructured) {
        throw "index_repository failed with exit $($indexResult.ExitCode): $(Get-CbmFailure -Result $indexResult)"
    }
    $reportedProject = [string]$indexStructured.project
    if ($reportedProject -and $reportedProject -cne $ProjectName) {
        throw "index_repository returned the wrong project identity: $reportedProject"
    }

    $status = Get-ReadyIndexStatus -Executable $Executable -ProjectName $ProjectName -RepoRoot $RepoRoot
    Assert-UniqueCanonicalProject -Executable $Executable -ProjectName $ProjectName -RepoRoot $RepoRoot
    $duration = [long]([DateTime]::UtcNow - $started).TotalMilliseconds

    return [pscustomobject]@{
        DeleteStatus = $delete.Status
        DurationMs = $duration
        Status = $status
    }
}

function Get-CanonicalReadiness {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Executable,

        [Parameter(Mandatory = $true)]
        [string] $ProjectName,

        [Parameter(Mandatory = $true)]
        [string] $RepoRoot
    )

    $statusResult = Invoke-CbmCli -Executable $Executable -Arguments @(
        'cli', '--json', 'index_status', '--project', $ProjectName
    )
    $statusPayload = Get-CbmPayload -Result $statusResult
    $statusStructured = Get-CbmStructuredContent -Result $statusResult

    $projectsResult = Invoke-CbmCli -Executable $Executable -Arguments @(
        'cli', '--json', 'list_projects', '--offset', '0',
        '--limit', '100', '--include-details', 'true'
    )
    $projectsPayload = Get-CbmPayload -Result $projectsResult
    $projectsStructured = Get-CbmStructuredContent -Result $projectsResult
    if ($projectsResult.ExitCode -ne 0 -or
        (Test-CbmErrorPayload -Payload $projectsPayload) -or
        $null -eq $projectsStructured) {
        throw "list_projects failed with exit $($projectsResult.ExitCode): $(Get-CbmFailure -Result $projectsResult)"
    }
    if ([bool]$projectsStructured.has_more) {
        throw 'list_projects returned more projects than one verification call can prove unique'
    }

    $matches = @($projectsStructured.projects | Where-Object { [string]$_.name -ceq $ProjectName })
    if ($matches.Count -gt 1) {
        throw "expected at most one canonical project, found $($matches.Count)"
    }
    if ($matches.Count -eq 1) {
        $listedRoot = ([string]$matches[0].root_path).Replace('\', '/').TrimEnd('/')
        if ($listedRoot -ine $RepoRoot) {
            throw "canonical project has the wrong root: $listedRoot"
        }
    }

    if ($matches.Count -eq 0) {
        if ($null -ne $statusStructured -and
            [string]$statusStructured.project -ceq $ProjectName -and
            [string]$statusStructured.status -ieq 'ready') {
            throw 'index_status and list_projects disagree about canonical project presence'
        }
        return [pscustomobject]@{ Ready = $false; Status = $null; Reason = 'project absent' }
    }

    if ($statusResult.ExitCode -ne 0 -or
        (Test-CbmErrorPayload -Payload $statusPayload) -or
        $null -eq $statusStructured) {
        throw "index_status failed for an existing project with exit $($statusResult.ExitCode): $(Get-CbmFailure -Result $statusResult)"
    }

    $reportedProject = [string]$statusStructured.project
    $reportedRoot = ([string]$statusStructured.root_path).Replace('\', '/').TrimEnd('/')
    $reportedStatus = [string]$statusStructured.status
    if ($reportedProject -cne $ProjectName) {
        throw "index_status returned the wrong project identity: $reportedProject"
    }
    if ($reportedRoot -ine $RepoRoot) {
        throw "index_status returned the wrong root: $reportedRoot"
    }
    if ($reportedStatus -ine 'ready') {
        return [pscustomobject]@{ Ready = $false; Status = $null; Reason = "status=$reportedStatus" }
    }
    if ($null -eq $statusStructured.PSObject.Properties['nodes'] -or
        $null -eq $statusStructured.PSObject.Properties['edges']) {
        throw 'index_status omitted node or edge counts'
    }

    $nodeCount = 0L
    $edgeCount = 0L
    if (-not [long]::TryParse([string]$statusStructured.nodes, [ref]$nodeCount) -or
        -not [long]::TryParse([string]$statusStructured.edges, [ref]$edgeCount)) {
        throw 'index_status returned non-numeric node or edge counts'
    }

    return [pscustomobject]@{
        Ready = $true
        Reason = 'ready'
        Status = [pscustomobject]@{
            Project = $reportedProject
            Root = $reportedRoot
            Status = $reportedStatus
            Nodes = $nodeCount
            Edges = $edgeCount
        }
    }
}

$inputJson = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputJson)) { exit 0 }

$eventName = ''
$repoRootForward = ''
$mutex = $null
$ownsMutex = $false
$exitCode = 0

try {
    $event = $inputJson | ConvertFrom-Json
    $eventName = [string]$event.hook_event_name
    if ($eventName -notin @('UserPromptSubmit', 'Stop')) { exit 0 }
    if ($eventName -ceq 'Stop' -and $event.stop_hook_active -eq $true) { exit 0 }

    $canonicalRoot = 'C:/Projects/LiquidAIty/main'
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd([char[]]'\/')
    $repoRootForward = $repoRoot.Replace('\', '/')
    if ($repoRootForward -ine $canonicalRoot) { exit 0 }

    $scriptGitRoot = Resolve-GitRoot -Path $repoRoot
    if ([string]::IsNullOrWhiteSpace($scriptGitRoot) -or $scriptGitRoot -ine $repoRoot) {
        throw 'tracked lifecycle script did not resolve the repository root'
    }

    $eventCwd = [string]$event.cwd
    if ([string]::IsNullOrWhiteSpace($eventCwd)) { exit 0 }
    $eventGitRoot = Resolve-GitRoot -Path $eventCwd
    if ([string]::IsNullOrWhiteSpace($eventGitRoot) -or $eventGitRoot -ine $repoRoot) { exit 0 }

    foreach ($requiredPath in @('.cbmignore', 'AGENTS.md', 'LiquidAIty.idd', 'apps\python-models\app\python_models\icf.py')) {
        if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $requiredPath) -PathType Leaf)) {
            throw "repository identity check failed: missing $requiredPath"
        }
    }

    $projectName = 'C-Projects-LiquidAIty-main'
    $cbmExecutable = Join-Path $env:LOCALAPPDATA 'Programs\codebase-memory-mcp\codebase-memory-mcp.exe'
    if (-not (Test-Path -LiteralPath $cbmExecutable -PathType Leaf)) {
        throw 'installed CBM executable is missing from the canonical Windows location'
    }

    $mutex = New-Object System.Threading.Mutex($false, 'Local\LiquidAIty.CBM.C-Projects-LiquidAIty-main')
    try {
        $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(115))
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) { throw 'timed out waiting for the CBM lifecycle mutex' }

    if ($eventName -ceq 'Stop') {
        $build = Invoke-FullCanonicalBuild -Executable $cbmExecutable -ProjectName $projectName -RepoRoot $repoRootForward
        "CODEBASE GRAPH REBUILT | project=$projectName | root=$repoRootForward | status=$($build.Status.Status) | nodes=$($build.Status.Nodes) | edges=$($build.Status.Edges) | duration_ms=$($build.DurationMs)" | Write-Output
    } else {
        $readiness = Get-CanonicalReadiness -Executable $cbmExecutable -ProjectName $projectName -RepoRoot $repoRootForward
        $recovered = $false
        if (-not $readiness.Ready) {
            $build = Invoke-FullCanonicalBuild -Executable $cbmExecutable -ProjectName $projectName -RepoRoot $repoRootForward
            $status = $build.Status
            $recovered = $true
        } else {
            $status = $readiness.Status
        }

        "CODEBASE GRAPH READY | project=$projectName | root=$repoRootForward | status=$($status.Status) | nodes=$($status.Nodes) | edges=$($status.Edges) | recovery=$($recovered.ToString().ToLowerInvariant()) | Follow skills/codebasedmemory.md and use the ready canonical native CBM graph." | Write-Output
    }
} catch {
    $failure = ($_.Exception.Message -replace '\s+', ' ').Trim()
    if ($eventName -ceq 'UserPromptSubmit') {
        "CODEBASE GRAPH UNAVAILABLE | project=C-Projects-LiquidAIty-main | root=$repoRootForward | error=$failure | Continue source-first without lifecycle retries." | Write-Output
        $exitCode = 0
    } else {
        [Console]::Error.WriteLine("CBM completion rebuild failed: $failure")
        $exitCode = 1
    }
} finally {
    if ($ownsMutex -and $null -ne $mutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}

exit $exitCode
