param(
    [Parameter(Mandatory = $true)]
    [string]$PublicResourceUrl,
    [ValidateRange(1, 65535)]
    [int]$McpPort = 8765,
    [switch]$ReadyOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$resourceUri = [Uri]$PublicResourceUrl
if (
    -not $resourceUri.IsAbsoluteUri -or
    $resourceUri.Scheme -ne 'https' -or
    $resourceUri.AbsolutePath -ne '/mcp' -or
    $resourceUri.Query -or
    $resourceUri.Fragment
) {
    throw 'MCP public resource URL must be one canonical HTTPS /mcp URL.'
}

$localBaseUrl = "http://127.0.0.1:$McpPort"
$metadataUrl = "$localBaseUrl/.well-known/oauth-protected-resource/mcp"
$mcpUrl = "$localBaseUrl/mcp"
$readinessUrl = "$localBaseUrl/health/ready"
$catalogUrl = 'http://127.0.0.1:4000/api/coder/input-data-dictionary/tools?limit=1'
$lastState = 'unreachable'
$lastLoggedState = ''
$lastLoggedAt = [DateTimeOffset]::MinValue
$pollMilliseconds = 500
$maximumPollMilliseconds = 2000

$http = [System.Net.Http.HttpClient]::new()

try {
    $catalogReady = $false
    $catalogCount = 0
    $catalogUniqueCount = 0
    $catalogHash = ''
    $publicationReady = $false
    while ($true) {
        $readiness = $null
        $readinessBody = ''
        $catalogState = 'unreachable'
        try {
            $readiness = $http.GetAsync($readinessUrl).GetAwaiter().GetResult()
            $readinessBody = $readiness.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $readinessPayload = $readinessBody | ConvertFrom-Json
            $catalogState = [string]$readinessPayload.catalogState
            $catalogCount = [int]$readinessPayload.publicToolCount
            $catalogUniqueCount = [int]$readinessPayload.publicToolUniqueCount
            $catalogHash = [string]$readinessPayload.catalogHash
            $runtimeReady = [bool]$readinessPayload.runtimeReady
            $binaryReady = [bool]$readinessPayload.binaryReady
            $daemonAttached = [bool]$readinessPayload.daemonAttached
            $frontendAttached = [bool]$readinessPayload.nativeFrontendAttached
            $projectReady = [bool]$readinessPayload.canonicalProjectRegistered
            $indexReady = [bool]$readinessPayload.indexReady
            $watcherActive = [bool]$readinessPayload.watcherActive
            $completedFamilies = @($readinessPayload.completedCatalogFamilies) -join ','
            $initializingFamily = [string]$readinessPayload.initializingCatalogFamily
            $catalogReady = (
                [bool]$readinessPayload.catalogReady -and
                [bool]$readinessPayload.publicCatalogReady -and
                $catalogState -eq 'ready' -and
                $catalogCount -gt 0 -and
                $catalogUniqueCount -eq $catalogCount -and
                -not [string]::IsNullOrWhiteSpace($catalogHash)
            )
            # Catalog discovery alone does not prove the native project ready.
            # Honor the existing readiness owner's HTTP and dependency result.
            $publicationReady = (
                [int]$readiness.StatusCode -eq 200 -and
                [bool]$readinessPayload.ok -and
                [bool]$readinessPayload.codeGraphReady -and
                [string]$readinessPayload.state -eq 'ready' -and
                $catalogReady
            )
        } catch {
            $catalogState = 'unreachable'
            $catalogReady = $false
            $catalogCount = 0
            $catalogUniqueCount = 0
            $catalogHash = ''
            $publicationReady = $false
            $runtimeReady = $false
            $binaryReady = $false
            $daemonAttached = $false
            $frontendAttached = $false
            $projectReady = $false
            $indexReady = $false
            $watcherActive = $false
            $completedFamilies = ''
            $initializingFamily = ''
        } finally {
            if ($null -ne $readiness) {
                $readiness.Dispose()
            }
        }

        $lastState = (
            "catalogState=$catalogState completed=$completedFamilies " +
            "initializing=$initializingFamily catalogCount=$catalogCount " +
            "runtime=$runtimeReady binary=$binaryReady daemon=$daemonAttached " +
            "frontend=$frontendAttached project=$projectReady index=$indexReady " +
            "watcher=$watcherActive"
        )
        $now = [DateTimeOffset]::UtcNow
        if (
            $lastState -ne $lastLoggedState -or
            ($now - $lastLoggedAt).TotalSeconds -ge 30
        ) {
            Write-Host "MCP readiness: $lastState"
            $lastLoggedState = $lastState
            $lastLoggedAt = $now
            $pollMilliseconds = 500
        }

        if ($catalogState -eq 'failed') {
            Write-Host "MCP catalog initialization failed; tunnel remains unpublished: $readinessBody"
            $failureCode = [string]$readinessPayload.failureCode
            if ([string]::IsNullOrWhiteSpace($failureCode)) {
                $failureCode = 'catalog_initialization_failed'
            }
            throw "MCP catalog initialization failed: $failureCode"
        }
        if ($catalogState -eq 'ready') {
            if (-not $catalogReady) {
                throw "MCP reported ready with an incomplete catalog: $lastState"
            }
            if ($publicationReady) {
                break
            }
        }

        Start-Sleep -Milliseconds $pollMilliseconds
        $pollMilliseconds = [Math]::Min(
            $maximumPollMilliseconds,
            [int][Math]::Ceiling($pollMilliseconds * 1.5)
        )
    }

    $metadata = $null
    try {
        $metadata = $http.GetAsync($metadataUrl).GetAwaiter().GetResult()
        $metadataPayload = $metadata.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        $metadataReady = (
            [int]$metadata.StatusCode -eq 200 -and
            [string]$metadataPayload.resource -ceq $PublicResourceUrl -and
            @($metadataPayload.scopes_supported) -contains 'liquidaity.main'
        )
    } finally {
        if ($null -ne $metadata) {
            $metadata.Dispose()
        }
    }
    if (-not $metadataReady) {
        throw 'MCP OAuth protected-resource metadata does not match the canonical resource and scope.'
    }

    $request = $null
    $anonymous = $null
    try {
        $request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::Post,
            $mcpUrl
        )
        $request.Headers.Accept.ParseAdd('application/json, text/event-stream')
        $request.Content = [System.Net.Http.StringContent]::new(
            '{}',
            [System.Text.Encoding]::UTF8,
            'application/json'
        )
        $anonymous = $http.SendAsync($request).GetAwaiter().GetResult()
        $anonymousRejected = [int]$anonymous.StatusCode -eq 401
        $challenge = $anonymous.Headers.WwwAuthenticate.ToString()
        $challengeReady = (
            $challenge -match '^Bearer' -and
            $challenge -match 'scope="liquidaity\.main"' -and
            $challenge.Contains('resource_metadata="' + $resourceUri.GetLeftPart([UriPartial]::Authority) + '/.well-known/oauth-protected-resource/mcp"')
        )
    } finally {
        if ($null -ne $anonymous) {
            $anonymous.Dispose()
        }
        if ($null -ne $request) {
            $request.Dispose()
        }
    }
    if (-not $anonymousRejected -or -not $challengeReady) {
        throw 'MCP anonymous OAuth challenge was not the expected 401 after readiness.'
    }

    # Reuse the backend's existing authenticated SDK client. The tunnel does
    # not receive a credential or initialize another MCP/native process.
    $catalog = $null
    try {
        $catalog = $http.GetAsync($catalogUrl).GetAwaiter().GetResult()
        $catalogPayload = $catalog.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        $authenticatedCatalogReady = (
            [int]$catalog.StatusCode -eq 200 -and
            $catalogPayload.ok -eq $true -and
            @($catalogPayload.references).Count -gt 0
        )
    } finally {
        if ($null -ne $catalog) {
            $catalog.Dispose()
        }
    }
    if (-not $authenticatedCatalogReady) {
        throw 'MCP authenticated catalog read failed through the existing backend client.'
    }

    $lastState = (
        "metadata=$metadataReady anonymous401=$anonymousRejected challenge=$challengeReady " +
        "authenticatedCatalog=$authenticatedCatalogReady " +
        "catalogState=ready catalogCount=$catalogCount catalogHash=$catalogHash"
    )
    Write-Host "MCP local OAuth readiness passed: $lastState"
    if ($ReadyOnly) {
        exit 0
    }
    $tunnelUrl = $resourceUri.GetLeftPart([UriPartial]::Authority)
    Write-Host "Starting reserved ngrok endpoint $tunnelUrl -> $localBaseUrl"
    & ngrok http $localBaseUrl --url $tunnelUrl
    exit $LASTEXITCODE
} finally {
    $http.Dispose()
}
