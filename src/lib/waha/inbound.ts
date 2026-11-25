import { createClient } from '@supabase/supabase-js'
import { normalizeWahaPhone } from './normalize'

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
// WAHA payloads vary by engine/version; normalize at this boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processWahaWebhook(body: any) {
  const session = body.session || body.payload?.session
  const message = body.payload?.id ? body.payload : body.message || body
  if (!session || body.event?.toLowerCase().includes('session')) return { accepted: false }
  if (message.fromMe) return { accepted: false }
  const phone = normalizeWahaPhone(message.from)
  if (!phone) return { accepted: false }
  const supabase = db()
  const { data: instance, error: instanceError } = await supabase.from('waha_instances').select('*').eq('session_name', session).maybeSingle()
  if (instanceError || !instance) return { accepted: false, error: 'instância não encontrada' }
  const providerId = typeof message.id === 'string' ? message.id : null
  if (providerId) { const { data: duplicate } = await supabase.from('messages').select('id').eq('waha_instance_id', instance.id).eq('message_id', providerId).maybeSingle(); if (duplicate) return { accepted: true, duplicate: true } }
  let { data: contact } = await supabase.from('contacts').select('id,name').eq('account_id', instance.account_id).eq('phone_normalized', phone).maybeSingle()
  if (!contact) { const created = await supabase.from('contacts').insert({ account_id: instance.account_id, user_id: instance.created_by, phone: phone, phone_normalized: phone, name: message._data?.notifyName || phone }).select('id,name').single(); contact = created.data; if (created.error) throw created.error }
  let { data: conversation } = await supabase.from('conversations').select('id,unread_count').eq('account_id', instance.account_id).eq('contact_id', contact!.id).eq('waha_instance_id', instance.id).in('status', ['open','pending']).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!conversation) { const created = await supabase.from('conversations').insert({ account_id: instance.account_id, user_id: instance.created_by, contact_id: contact!.id, waha_instance_id: instance.id, status: 'open' }).select('id,unread_count').single(); conversation = created.data; if (created.error) throw created.error }
  const text = typeof message.body === 'string' && message.body.trim() ? message.body : '[Mensagem recebida pelo WhatsApp]'
  const inserted = await supabase.from('messages').insert({ conversation_id: conversation!.id, sender_type: 'customer', content_type: 'text', content_text: text, message_id: providerId, status: 'delivered', waha_instance_id: instance.id }).select('id').single()
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error
  await supabase.from('conversations').update({ status: 'open', last_message_text: text, last_message_at: new Date().toISOString(), unread_count: (conversation!.unread_count || 0) + 1 }).eq('id', conversation!.id)
  return { accepted: true, conversationId: conversation!.id }
}
