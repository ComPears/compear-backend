function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

const log = (level: string, ...args: unknown[]) => {
  const [message, ...details] = args;
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: typeof message === 'string' ? message : 'application_log',
  };

  if (typeof message !== 'string') {
    entry.data = serialize(message);
  } else if (details.length === 1) {
    entry.data = serialize(details[0]);
  } else if (details.length > 1) {
    entry.data = details.map(serialize);
  }

  console.log(
    JSON.stringify(entry, (_key, value) => {
      return value instanceof Error ? serialize(value) : value;
    })
  );
};

export const logger = {
  info: (...args: unknown[]) => log('INFO', ...args),
  warn: (...args: unknown[]) => log('WARN', ...args),
  error: (...args: unknown[]) => log('ERROR', ...args),
};
