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
$lastState = 'not checked'
$lastCatalogFailure = ''

$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [TimeSpan]::FromSeconds(2)

try {
    while ($null -eq $deadline -or [DateTimeOffset]::UtcNow -lt $deadline) {
        $tcpReady = $false
        $metadataReady = $false
        $anonymousRejected = $false
        $challengeReady = $false
        $catalogReady = $false
        $catalogState = 'unreachable'
        $catalogCount = 0

        $tcp = [System.Net.Sockets.TcpClient]::new()
        try {
            $connect = $tcp.ConnectAsync('127.0.0.1', $McpPort)
            $tcpReady = $connect.Wait(1000) -and $tcp.Connected
        } catch {
            $tcpReady = $false
        } finally {
            $tcp.Dispose()
        }

        if ($tcpReady) {
            try {
                $metadata = $http.GetAsync($metadataUrl).GetAwaiter().GetResult()
                $metadataReady = [int]$metadata.StatusCode -eq 200
                $metadata.Dispose()

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
                $anonymous.Dispose()
                $request.Dispose()

                $readiness = $http.GetAsync($readinessUrl).GetAwaiter().GetResult()
                $readinessBody = $readiness.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $readinessPayload = $readinessBody | ConvertFrom-Json
                $catalogState = [string]$readinessPayload.catalogState
                $catalogCount = [int]$readinessPayload.publicToolCount
                $catalogReady = (
                    [int]$readiness.StatusCode -eq 200 -and
                    [bool]$readinessPayload.catalogReady -and
                    $catalogState -eq 'ready' -and
                    $catalogCount -eq 70 -and
                    [int]$readinessPayload.publicToolUniqueCount -eq 70
                )
                if ($catalogState -eq 'failed') {
                    $catalogFailure = [string]$readinessPayload.catalogFailure
                    if ($catalogFailure -and $catalogFailure -ne $lastCatalogFailure) {
                        Write-Host "MCP catalog initialization failed; tunnel remains unpublished: $catalogFailure"
                        $lastCatalogFailure = $catalogFailure
                    }
                }
                $readiness.Dispose()
            } catch {
                $metadataReady = $false
                $anonymousRejected = $false
                $challengeReady = $false
                $catalogReady = $false
            }
        }

        $lastState = (
            "tcp=$tcpReady metadata=$metadataReady " +
            "anonymous401=$anonymousRejected challenge=$challengeReady " +
            "catalogState=$catalogState catalogCount=$catalogCount catalogReady=$catalogReady"
        )
        if (
            $tcpReady -and
            $metadataReady -and
            $anonymousRejected -and
            $challengeReady -and
            $catalogReady
        ) {
            Write-Host "MCP local OAuth readiness passed: $lastState"
            if ($ReadyOnly) {
                exit 0
            }
            $tunnelUrl = $resourceUri.GetLeftPart([UriPartial]::Authority)
            Write-Host "Starting reserved ngrok endpoint $tunnelUrl -> $localBaseUrl"
            & ngrok http $localBaseUrl --url $tunnelUrl
            exit $LASTEXITCODE
        }

        Start-Sleep -Milliseconds 500
    }
} finally {
    $http.Dispose()
}

throw "MCP complete local readiness failed after $TimeoutSeconds seconds: $lastState"
