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

function Write-HookJson {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable] $Output
    )

    $Output | ConvertTo-Json -Depth 8 -Compress | Write-Output
}

$inputJson = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputJson)) { exit 0 }

$eventName = ''
$repoRootForward = ''

try {
    $event = $inputJson | ConvertFrom-Json
    $eventName = [string]$event.hook_event_name
    if ($eventName -cne 'UserPromptSubmit') { exit 0 }

    $canonicalRoot = 'C:/Projects/LiquidAIty/main'
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd([char[]]'\/')
    $repoRootForward = $repoRoot.Replace('\', '/')
    if ($repoRootForward -ine $canonicalRoot) { exit 0 }

    $scriptGitRoot = Resolve-GitRoot -Path $repoRoot
    if ([string]::IsNullOrWhiteSpace($scriptGitRoot) -or $scriptGitRoot -ine $repoRoot) {
        throw 'tracked hook did not resolve the repository root'
    }

    $eventCwd = [string]$event.cwd
    if ([string]::IsNullOrWhiteSpace($eventCwd)) { exit 0 }
    $eventGitRoot = Resolve-GitRoot -Path $eventCwd
    if ([string]::IsNullOrWhiteSpace($eventGitRoot) -or $eventGitRoot -ine $repoRoot) { exit 0 }

    foreach ($requiredPath in @('.cbmignore', 'AGENTS.md', 'LiquidAIty.idd', 'apps\python-models\app\python_models\idf.py')) {
        if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $requiredPath) -PathType Leaf)) {
            throw "repository identity check failed: missing $requiredPath"
        }
    }

    $context = @'
CODEGRAPH NAVIGATION RECIPE v1
The companion native MCP hook has searched the real submitted prompt and placed the native first result page in this turn; `has_more` remains the authority for useful continuation. The original GPT/PromptSpec prompt remains the user input. Its leading graph context answers what to search for next, not the final coding conclusion. Treat returned symbols, paths, degree hints, transported graph views, and upstream graph pointers as discovery anchors, not proof.

Stay in this corridor until the implementation owner is resolved:
1. search_graph: refine from the supplied rows or explicit CODEGRAPH_SEARCH criteria.
2. trace_path: use only when callers, callees, data flow, or impact matter.
3. get_code_snippet: use an exact qualified name returned by search_graph.
4. Read the complete current source identified by the graph.
5. Use focused rg only for literals, configuration, non-code, graph gaps, and exhaustive residue.
6. Make the bounded change; run focused tests, compile/build the touched boundary, reread source, and inspect the diff.

If the pre-turn search is empty or unavailable, report that truthfully, make one useful native MCP refinement, then use bounded direct-source fallback. Never fabricate a symbol or mutate/recover the index during the response. Follow skills/codebasedmemory.md for coverage and inverse-deletion proof.
'@.Trim()
    Write-HookJson -Output @{
        continue = $true
        hookSpecificOutput = @{
            hookEventName = 'UserPromptSubmit'
            additionalContext = $context
        }
    }
} catch {
    $failure = ($_.Exception.Message -replace '\s+', ' ').Trim()
    if ($failure.Length -gt 360) { $failure = $failure.Substring(0, 360) }
    Write-HookJson -Output @{
        continue = $true
        hookSpecificOutput = @{
            hookEventName = 'UserPromptSubmit'
            additionalContext = "CODEGRAPH NAVIGATION RECIPE UNAVAILABLE | error=$failure | Preserve the original prompt, use the already-connected native MCP search_graph doorway once, and fail open to bounded source discovery without index mutation."
        }
    }
}

exit 0
