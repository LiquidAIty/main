$ErrorActionPreference = 'Stop'

$ngrok = Get-Command ngrok -ErrorAction Stop
& $ngrok.Source http --domain=exemption-unstable-wolverine.ngrok-free.dev 8765
exit $LASTEXITCODE
