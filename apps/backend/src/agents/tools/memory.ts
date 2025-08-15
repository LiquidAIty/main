import { ToolResult, MemoryRecord } from '../../types/agent';

const memoryStore = new Map<string, { value: any, expires?: number }>();

export const memoryTool = {
  async run(params: { operation: 'get'|'set', record: MemoryRecord }): Promise<ToolResult> {
    try {
      const { operation, record } = params;
      
      if (operation === 'set') {
        const expires = record.ttl ? Date.now() + record.ttl * 1000 : undefined;
        const key = `${record.kind}:${record.scope}:${record.key}`;
        memoryStore.set(key, { value: record.value, expires });
        return {
          jobId: 'memory-' + Date.now(),
          status: 'ok',
          events: [{ type: 'info', data: { message: 'Memory write operation' } }],
          artifacts: [],
          metrics: {}
        };
      } else if (operation === 'get') {
        const key = `${record.kind}:${record.scope}:${record.key}`;
        const entry = memoryStore.get(key);
        
        if (!entry) {
          return {
            jobId: 'memory-' + Date.now(),
            status: 'not_found',
            events: [{ type: 'info', data: { message: 'Memory read operation' } }],
            artifacts: [],
            metrics: {}
          };
        }
        
        // Check if expired
        if (entry.expires && entry.expires < Date.now()) {
          memoryStore.delete(key);
          return {
            jobId: 'memory-' + Date.now(),
            status: 'expired',
            events: [{ type: 'info', data: { message: 'Memory read operation' } }],
            artifacts: [],
            metrics: {}
          };
        }
        
        return {
          jobId: 'memory-' + Date.now(),
          status: 'ok',
          events: [{ type: 'info', data: { message: 'Memory read operation' } }],
          artifacts: [{ type: 'memory_value', data: entry.value }],
          metrics: {}
        };
      }
      
      throw new Error(`Invalid memory operation: ${operation}`);
    } catch (error: any) {
      return {
        jobId: 'memory-' + Date.now(),
        status: 'error',
        events: [{ type: 'error', data: { message: error?.message || 'Memory operation failed' } }],
        artifacts: []
      };
    }
  }
};
