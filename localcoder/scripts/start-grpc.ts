import path from 'node:path'
import { existsSync } from 'node:fs'
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

async function main() {
  console.log('Starting OpenClaude gRPC Server...')
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
