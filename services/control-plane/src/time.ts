/** PGlite 返回字符串时间戳，node-postgres 返回 Date；统一转为 ISO 字符串。 */
export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value)).toISOString()
}

export function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  return new Date(String(value)).getTime()
}
