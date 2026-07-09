export const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

export function parseUserId(value: string | undefined | null): string | null {
  const candidate = (value || '').trim();
  return USER_ID_PATTERN.test(candidate) ? candidate : null;
}

export function getUserIdFromRequest(req: {
  header(name: string): string | undefined;
  body?: { userId?: unknown };
}): string | null {
  const header = parseUserId(req.header('x-compear-user-id'));
  if (header) return header;
  if (typeof req.body?.userId === 'string') {
    return parseUserId(req.body.userId);
  }
  return null;
}
