import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import configSchema from '../config/sol.config.schema.json';
import type { TaskEnvelope } from '../types/agent';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateConfigFn = ajv.compile(configSchema);

export const ValidationService = {
  validateConfig(config: any) {
    const ok = validateConfigFn(config);
    return { ok: !!ok, errors: ok ? [] : (validateConfigFn.errors || []).map(e => `${e.instancePath} ${e.message}`) };
  },
  
  validateTask(task: any) {
    return this.validateTaskEnvelope(task);
  },
  
  validateTaskEnvelope(task: any) {
    const errors: string[] = [];
    if (!task || typeof task !== 'object') errors.push('task envelope missing');
    if (!task?.task || typeof task.task !== 'string') errors.push('task.task (string) required');
    if (!task?.userId || typeof task.userId !== 'string') errors.push('task.userId (string) required');
    return { valid: errors.length === 0, errors };
  },
  
  needsApproval(task: TaskEnvelope, config: any) {
    const rules: string[] = config?.safety?.needsApproval || [];
    return rules.includes(task?.task);
  }
};
