import { isEnvTruthy } from './envUtils.js'

export function isHostManagedProviderMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) ||
    isEnvTruthy(env.OPENCLAUDE_LOCKED_PROVIDER)
  )
}
