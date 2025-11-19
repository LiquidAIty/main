# Sol Dev Notes

- `/api/sol/run` powers the Sol chat backend used by `/agentic`.
- Auth behavior:
  - Default dev behavior: auth is disabled when `NODE_ENV=development` or `SOL_AUTH_DISABLED=1`.
  - Production: auth stays on unless you set `SOL_AUTH_DISABLED=1` explicitly.
- To develop locally on PowerShell:
  ```powershell
  $env:SOL_AUTH_DISABLED = "1"
  nx run backend:serve
  ```
- Volt is no longer required; `/api/sol/run` calls the Sol agent directly.
