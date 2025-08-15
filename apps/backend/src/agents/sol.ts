import config from '../config/sol.config.json';
import { getTool } from './registry';
import { StreamService } from '../services/stream';
import { Logger } from '../services/logger';
import { ValidationService } from '../services/validation';
import type { Request as ExpressRequest } from 'express';
import type { TaskEnvelope } from '../types/agent';

export async function processRequest(task: TaskEnvelope, req: ExpressRequest) {
  try {
    Logger.log({ level: 'info', message: 'Task received', metadata: { userId: task.userId, task: task.task } });

    const validation = ValidationService.validateTaskEnvelope(task);
    if (!validation.valid) {
      StreamService.sendEvent(task.userId, { type: 'error', data: { message: 'Invalid task', errors: validation.errors } });
      return;
    }

    if (ValidationService.needsApproval(task, config)) {
      StreamService.sendEvent(task.userId, { type: 'awaiting_approval', data: { task: task.task } });
      return;
    }

    StreamService.sendEvent(task.userId, {
      type: 'model_selected',
      data: { model: config.models.primary, task: task.task }
    });

    const toolName = task.tool || 'openai';
    const tool = getTool(toolName);
    if (!tool) {
      StreamService.sendEvent(task.userId, { type: 'error', data: { message: `Unknown tool: ${toolName}` } });
      return;
    }

    const result = await tool.run(task.params ?? {});
    StreamService.sendEvent(task.userId, { type: 'tool_result', data: result });
  } catch (error: any) {
    Logger.log({ level: 'error', message: 'processRequest failed', metadata: { error: error?.message } });
    StreamService.sendEvent(task?.userId || 'unknown', {
      type: 'error',
      data: { message: 'Tool execution failed', error: error?.message || String(error) }
    });
  }
}
