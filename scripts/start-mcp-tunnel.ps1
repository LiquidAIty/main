param(
    [Parameter(Mandatory = $true)]
    [string]$PublicResourceUrl,
    [ValidateRange(1, 65535)]
    [int]$McpPort = 8765,
    [ValidateRange(0, 300)]
    [int]$TimeoutSeconds = 0,
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
$deadline = if ($TimeoutSeconds -gt 0) {
    [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
} else {
    $null
}
$lastState = 'unreachable'
$lastLoggedState = ''
$pollMilliseconds = 500
$maximumPollMilliseconds = 2000

$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [TimeSpan]::FromSeconds(2)

try {
    $catalogReady = $false
    $catalogCount = 0
    $catalogUniqueCount = 0
    $catalogHash = ''
    while ($null -eq $deadline -or [DateTimeOffset]::UtcNow -lt $deadline) {
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
            $completedFamilies = @($readinessPayload.completedCatalogFamilies) -join ','
            $initializingFamily = [string]$readinessPayload.initializingCatalogFamily
            $catalogReady = (
                [int]$readiness.StatusCode -eq 200 -and
                [bool]$readinessPayload.catalogReady -and
                $catalogState -eq 'ready' -and
                $catalogCount -eq 71 -and
                $catalogUniqueCount -eq 71 -and
                -not [string]::IsNullOrWhiteSpace($catalogHash)
            )
        } catch {
            $catalogState = 'unreachable'
            $catalogReady = $false
            $catalogCount = 0
            $catalogUniqueCount = 0
            $catalogHash = ''
            $completedFamilies = ''
            $initializingFamily = ''
        } finally {
            if ($null -ne $readiness) {
                $readiness.Dispose()
            }
        }

        $lastState = (
            "catalogState=$catalogState completed=$completedFamilies " +
            "initializing=$initializingFamily catalogCount=$catalogCount"
        )
        if ($lastState -ne $lastLoggedState) {
            Write-Host "MCP readiness: $lastState"
            $lastLoggedState = $lastState
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
            break
        }

        Start-Sleep -Milliseconds $pollMilliseconds
        $pollMilliseconds = [Math]::Min(
            $maximumPollMilliseconds,
            [int][Math]::Ceiling($pollMilliseconds * 1.5)
        )
    }

    if (-not $catalogReady) {
        throw "MCP complete local readiness failed after $TimeoutSeconds seconds: $lastState"
    }

    $metadata = $null
    try {
        $metadata = $http.GetAsync($metadataUrl).GetAwaiter().GetResult()
        $metadataReady = [int]$metadata.StatusCode -eq 200
    } finally {
        if ($null -ne $metadata) {
            $metadata.Dispose()
        }
    }
    if (-not $metadataReady) {
        throw 'MCP OAuth protected-resource metadata did not return 200 after readiness.'
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
            $challenge -match 'resource_metadata="https://'
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

    $lastState = (
        "metadata=$metadataReady anonymous401=$anonymousRejected challenge=$challengeReady " +
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
