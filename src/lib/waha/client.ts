const baseUrl = () => (process.env.WAHA_BASE_URL || '').replace(/\/$/, '')

export class WahaError extends Error { constructor(message: string, public status = 502) { super(message) } }

export async function wahaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = baseUrl()
  if (!base) throw new WahaError('WAHA_BASE_URL não configurada', 503)
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (process.env.WAHA_API_KEY) headers.set('X-Api-Key', process.env.WAHA_API_KEY)
  const response = await fetch(`${base}${path}`, { ...init, headers, cache: 'no-store' })
  const text = await response.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) throw new WahaError(typeof data === 'object' && data && 'message' in data ? String((data as {message?: unknown}).message) : `WAHA respondeu ${response.status}`, response.status)
  return data as T
}

export const startSession = (name: string, webhookUrl: string) => wahaFetch('/api/sessions/start', { method: 'POST', body: JSON.stringify({ name, config: { webhooks: [{ url: webhookUrl, events: ['message', 'session.status'] }] } }) })
export const stopSession = (name: string) => wahaFetch('/api/sessions/stop', { method: 'POST', body: JSON.stringify({ name }) })
export const getSessionQr = (name: string) => wahaFetch<unknown>(`/api/${encodeURIComponent(name)}/auth/qr`)
export const sendText = (session: string, chatId: string, text: string) => wahaFetch<{id?: string}>('/api/sendText', { method: 'POST', body: JSON.stringify({ session, chatId, text }) })
