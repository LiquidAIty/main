$ErrorActionPreference = 'Stop'

$ngrok = Get-Command ngrok -ErrorAction Stop
& $ngrok.Source http --url=exemption-unstable-wolverine.ngrok-free.dev 8765
exit $LASTEXITCODE
