Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
$eventName = 'UserPromptSubmit'
$inputObject = $null
if ($raw.Trim()) {
  try {
    $inputObject = $raw | ConvertFrom-Json
    if ($inputObject.hook_event_name) {
      $eventName = [string]$inputObject.hook_event_name
    }
  }
  catch {
    $eventName = 'UserPromptSubmit'
  }
}

$repoRoot = $null
if ($inputObject -and $inputObject.cwd) {
  $candidateRoot = & git -C ([string]$inputObject.cwd) rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -eq 0 -and $candidateRoot) {
    $repoRoot = $candidateRoot.Trim().Replace('/', '\').TrimEnd('\')
  }
}

$handoffPath = if ($repoRoot -ieq 'C:\Projects\main') {
  Join-Path $repoRoot '.codex\cbm-handoffs\C-Projects-main.md'
} else {
  $null
}

if ($eventName -eq 'Stop') {
  if (-not $handoffPath -or ($inputObject -and $inputObject.stop_hook_active -eq $true)) {
    exit 0
  }

  $changedFiles = @(& git -c core.safecrlf=false -C $repoRoot diff HEAD --name-only --diff-filter=ACMRTUXB -- . ':(exclude).codex/**' 2>$null)
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
5. Make no repository source changes during this pass. If the one CBM attempt fails, preserve the previous successful content, add STALE - CBM refresh failed: <exact concise error>, and finish normally.
6. Finish normally. stop_hook_active prevents this hook from continuing the turn again.
"@

  @{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress
  exit 0
}

$context = @'
CODER OPERATING CONTRACT

Role: bounded coding specialist only. Preserve the interactive terminal, native file/read/edit/shell/test tools, and the requested CoderReport. Do not act as Main, research owner, graph owner, or general orchestrator.

Code discovery order:
1. Use the already-connected native codebase-memory-mcp search_graph until structural owners are found.
2. Use trace_path when caller/callee or change impact matters.
3. Use get_code_snippet for an exact qualified-symbol snapshot.
4. Direct-read the complete current source that CBM identified.
5. Use search_code and focused rg for literals, configs, tests, residue, and missing graph coverage.

Use one calm native CBM lifecycle. Do not launch another server/indexer, access SQLite directly, reindex per query, or retry equivalent failed searches in a swarm. If CBM coverage is missing, report it and verify the exact source directly.

Git reads and diffs are normal discovery. The repository owner performs saves/commits/pushes. Do not run Git mutations unless the active task explicitly authorizes them. Never reset or restore owner work.

Before editing, state the requested delta and Preservation Set. Make the smallest complete change, delete a replaced path only after its replacement is proven, inverse-traverse deletions for callers/config/tests/docs/residue, run focused tests/typecheck, inspect the final diff, and return a bounded CoderReport with regressions and blockers.
'@

if ($handoffPath) {
  $handoff = if (Test-Path -LiteralPath $handoffPath) {
    Get-Content -Raw -LiteralPath $handoffPath
  } else {
    "CODEBASE GRAPH HANDOFF`n`nProject: C-Projects-main`n`nNo completed handoff exists yet."
  }
  $context = "$context`n`n$handoff`n`nUse this handoff as orientation for the current request. Search the current request directly when it is unrelated."
}

@{
  suppressOutput = $true
  hookSpecificOutput = @{
    hookEventName = $eventName
    additionalContext = $context.Trim()
  }
} | ConvertTo-Json -Compress -Depth 5
