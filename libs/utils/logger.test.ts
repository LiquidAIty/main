import logger from './logger';

describe('Logger Utility', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('getTimestamp returns ISO string', () => {
    const timestamp = logger.getTimestamp();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('info logs with correct format', () => {
    logger.info('test message');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.*\] \[INFO\] test message$/)
    );
  });

  test('warn logs with correct format', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warning message');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.*\] \[WARN\] warning message$/)
    );
    warnSpy.mockRestore();
  });

  test('error logs with correct format', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('error message');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.*\] \[ERROR\] error message$/)
    );
    errorSpy.mockRestore();
  });
});
