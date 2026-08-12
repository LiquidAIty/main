$ErrorActionPreference = 'Stop'

try {
    $inputJson = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputJson)) { exit 0 }
    $event = $inputJson | ConvertFrom-Json

    $repoRoot = (& git -C ([string]$event.cwd) rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) { exit 0 }
    $repoRoot = $repoRoot.Trim().Replace('/', '\').TrimEnd('\')
    if ($repoRoot -ine 'C:\Projects\main') { exit 0 }

    $handoffPath = Join-Path $repoRoot '.codex\cbm-handoffs\C-Projects-main.md'

    if ($event.hook_event_name -eq 'UserPromptSubmit') {
        $handoff = if (Test-Path -LiteralPath $handoffPath) {
            Get-Content -Raw -LiteralPath $handoffPath
        } else {
            "CODEBASE GRAPH HANDOFF`n`nProject: C-Projects-main`n`nNo completed handoff exists yet."
        }

        @"
$handoff

INSTRUCTION

Use the already-connected native CBM search_graph for the CURRENT coding request. Use concrete request concepts plus relevant names above. Follow graph-returned names until the owning files and symbols are identified. Use trace_path for relationships and impact, get_code_snippet for exact qualified symbols, and search_code for literals, configuration, tests, mocks, comments, or residue. Then read the complete relevant source. If the request is unrelated to this handoff, search the new concept directly. If graph evidence stops helping, continue normally with source, focused rg, Git, execution, and tests.

Do not launch CBM, another MCP client, or an index operation from this prompt hook.
"@ | Write-Output
        exit 0
    }

    if ($event.hook_event_name -eq 'Stop') {
        if ($event.stop_hook_active -eq $true) { exit 0 }

        $changedFiles = @(& git -C $repoRoot diff HEAD --name-only --diff-filter=ACMRTUXB -- . ':(exclude).codex/**' 2>$null)
        if ($LASTEXITCODE -ne 0) { exit 0 }

        $sourcePattern = '(?i)\.(ts|tsx|js|jsx|mjs|cjs|py|sql|css|html|yml|yaml|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|swift|rb|php|vue|svelte)$'
        $sourceFiles = @($changedFiles | Where-Object { $_ -match $sourcePattern })
        if ($sourceFiles.Count -eq 0) { exit 0 }

        $fileList = ($sourceFiles | ForEach-Object { "- $_" }) -join "`n"
        $reason = @"
Before finishing, perform the single native-CBM completion pass for this task.

Changed tracked source:
$fileList

Use only the already-connected native Codebase Memory MCP. Do not launch CBM through a shell, CLI, wrapper, plugin, or second client.

1. Refresh C-Projects-main at most once using the native MCP capability available in this session.
2. Use Git diff to identify the changed files and symbols.
3. Use search_graph and, when useful, trace_path, get_code_snippet, search_code, or query_graph to resolve immediate named callers, consumers, callees, imports, registrations, routes/handlers, runtime crossings, and connected tests.
4. Update $handoffPath with a compact CODEBASE GRAPH HANDOFF containing CHANGED SYMBOLS, CONNECTED OWNERS, OUTBOUND DEPENDENCIES, RUNTIME CROSSINGS, RELATED TESTS, SEARCH SEEDS, and NEXT-AGENT INSTRUCTION. Use factual names and relationships, not counts or a generic architecture dump.
5. Make no repository source changes during this pass. If the one CBM attempt fails, preserve the previous successful content, add STALE — CBM refresh failed: <exact concise error>, and finish normally.
6. Finish normally. stop_hook_active prevents this hook from continuing the turn again.
"@

        @{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress | Write-Output
    }
} catch {
    # Fail open: hook failures never block ordinary coding.
    exit 0
}
