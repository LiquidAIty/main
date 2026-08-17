param(
    [Parameter(Mandatory = $true)]
    [string]$PublicResourceUrl,
    [ValidateRange(1, 65535)]
    [int]$McpPort = 8765,
    [ValidateRange(1, 300)]
    [int]$TimeoutSeconds = 60,
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
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
$lastState = 'not checked'

$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [TimeSpan]::FromSeconds(2)

try {
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $tcpReady = $false
        $metadataReady = $false
        $anonymousRejected = $false
        $challengeReady = $false

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
            } catch {
                $metadataReady = $false
                $anonymousRejected = $false
                $challengeReady = $false
            }
        }

        $lastState = (
            "tcp=$tcpReady metadata=$metadataReady " +
            "anonymous401=$anonymousRejected challenge=$challengeReady"
        )
        if ($tcpReady -and $metadataReady -and $anonymousRejected -and $challengeReady) {
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

throw "MCP local OAuth readiness failed after $TimeoutSeconds seconds: $lastState"
