/** Return one path parameter, rejecting Express 5's array-shaped edge case. */
export function routeParam(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}
