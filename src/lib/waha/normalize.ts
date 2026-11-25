export function normalizeWahaPhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('@g.us') || value === 'status@broadcast') return null
  const digits = value.replace(/@(?:c|lid)\.us$/, '').replace(/\D/g, '')
  return digits.length >= 8 ? digits : null
}

export function wahaEvent(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const value = (body as {event?: unknown}).event
  return typeof value === 'string' ? value.toLowerCase() : ''
}
