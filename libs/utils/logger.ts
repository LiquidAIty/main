export function getTimestamp(): string {
  return new Date().toISOString();
}

export function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const timestamp = getTimestamp();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  
  switch (level) {
    case 'error':
      console.error(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    default:
      console.log(logMessage);
  }
}

export default {
  info: (message: string) => log(message, 'info'),
  warn: (message: string) => log(message, 'warn'),
  error: (message: string) => log(message, 'error')
};
