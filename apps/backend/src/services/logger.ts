import { ToolResult } from '../types/agent';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogData = {
  level: LogLevel;
  message: string;
  timestamp?: string;
  metadata?: Record<string, any>;
};

export class Logger {
  static log(data: LogData) {
    const payload = { timestamp: new Date().toISOString(), ...data };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  static logToolCall(tool: string, params: any, source: string) {
    this.log({
      level: 'debug',
      message: 'Tool called',
      metadata: { tool, params, source }
    });
  }

  static logToolResult(result: ToolResult, source: string) {
    this.log({
      level: result.status === 'error' ? 'error' : 'info',
      message: 'Tool result',
      metadata: {
        source,
        status: result.status,
        artifacts: result.artifacts?.length,
        events: result.events?.length
      }
    });
  }
}
