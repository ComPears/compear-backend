const log = (level: string, ...args: unknown[]) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}]`, ...args);
};

export const logger = {
  info: (...args: unknown[]) => log('INFO', ...args),
  warn: (...args: unknown[]) => log('WARN', ...args),
  error: (...args: unknown[]) => log('ERROR', ...args),
};
