import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { GrpcServer, type PythonMcpConfig } from '../src/grpc/server.ts'
import { init } from '../src/entrypoints/init.ts'

// Polyfill MACRO which is normally injected by the bundler
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.1.7',
    DISPLAY_VERSION: '0.1.7',
    PACKAGE_URL: '@gitlawb/openclaude',
  }
})

// Official Python MCP host — the ONLY app MCP surface. Resolved from the real
// repo layout (localcoder/scripts → repo root) and validated before the server
// is even constructed. No LIQUIDAITY_MCP_* env vars, no localcoder/.env, no
// fallback path: a missing file is one exact fatal startup error.
function resolveOfficialPythonMcp(): PythonMcpConfig {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const config: PythonMcpConfig = {
    serverName: 'liquidaity',
    command: path.join(repoRoot, 'apps', 'python-models', '.venv', 'Scripts', 'python.exe'),
    hostPath: path.join(repoRoot, 'apps', 'python-models', 'app', 'mcp_host.py'),
  }
  const required: Array<[string, string]> = [
    ['official Python executable', config.command],
    ['official Python MCP host', config.hostPath],
  ]
  for (const [label, file] of required) {
    if (!existsSync(file)) {
      console.error(`gRPC Server: FATAL — ${label} missing: ${file}`)
      process.exit(1)
    }
  }
  return config
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/)
  if (!match) return null
  let value = match[2].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  } else {
    value = value.replace(/\s+#.*$/, '').trim()
  }
  return [match[1], value]
}

function loadBackendEnv(repoRoot: string): void {
  const envPath = path.join(repoRoot, 'apps', 'backend', '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line)
    if (!parsed) continue
    const [key, value] = parsed
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function applyOpenRouterCompatibleEnv(): void {
  const primary = String(process.env.SOL_PRIMARY || '').trim().toLowerCase()
  if (primary !== 'openrouter') return
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL =
    String(process.env.OPENROUTER_BASE_URL || '').trim() || 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (String(process.env.OPENROUTER_DEFAULT_MODEL || '').trim()) {
    process.env.OPENAI_MODEL = String(process.env.OPENROUTER_DEFAULT_MODEL).trim()
  }
}

async function main() {
  console.log('Starting OpenClaude gRPC Server...')
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  loadBackendEnv(repoRoot)
  await init()

  // Mirror CLI bootstrap: hydrate secure tokens and resolve provider profile
  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()
  const { hydrateGeminiAccessTokenFromSecureStorage } = await import('../src/utils/geminiCredentials.js')
  hydrateGeminiAccessTokenFromSecureStorage()
  const { hydrateGithubModelsTokenFromSecureStorage } = await import('../src/utils/githubModelsCredentials.js')
  hydrateGithubModelsTokenFromSecureStorage()

  const { buildStartupEnvFromProfile, applyProfileEnvToProcessEnv } = await import('../src/utils/providerProfile.js')
  const { getProviderValidationError, validateProviderEnvOrExit } = await import('../src/utils/providerValidation.js')
  const startupEnv = await buildStartupEnvFromProfile({ processEnv: process.env })
  if (startupEnv !== process.env) {
    const startupProfileError = await getProviderValidationError(startupEnv)
    if (startupProfileError) {
      console.warn(`Warning: ignoring saved provider profile. ${startupProfileError}`)
    } else {
      applyProfileEnvToProcessEnv(process.env, startupEnv)
    }
  }
  applyOpenRouterCompatibleEnv()
  await validateProviderEnvOrExit()

  const port = process.env.GRPC_PORT ? parseInt(process.env.GRPC_PORT, 10) : 50051
  const host = process.env.GRPC_HOST || 'localhost'
  const server = new GrpcServer(resolveOfficialPythonMcp())

  // Establishes the one server-lifetime Python MCP connection BEFORE binding —
  // no chat work is accepted until the official host is connected and validated.
  await server.start(port, host)
}

main().catch((err) => {
  console.error('Fatal error starting gRPC server:', err)
  process.exit(1)
})
