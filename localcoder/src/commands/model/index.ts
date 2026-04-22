import type { Command } from '../../commands.js'
import { isHostManagedProviderMode } from '../../utils/hostManagedMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI model for LocalCoder (currently ${renderModelName(getMainLoopModel())})`
  },
  argumentHint: '[model]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  isEnabled: () => !isHostManagedProviderMode(),
  load: () => import('./model.js'),
} satisfies Command
