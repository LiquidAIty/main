import type { Command } from '../../commands.js'
import { isHostManagedProviderMode } from '../../utils/hostManagedMode.js'

const provider = {
  type: 'local-jsx',
  name: 'provider',
  description: 'Manage API provider profiles',
  isEnabled: () => !isHostManagedProviderMode(),
  load: () => import('./provider.js'),
} satisfies Command

export default provider
