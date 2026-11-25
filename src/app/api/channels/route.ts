import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { startSession, WahaError } from '@/lib/waha/client'

export async function GET() {
  try { const { supabase, accountId } = await requireRole('viewer'); const { data, error } = await supabase.from('waha_instances').select('id,account_id,name,session_name,phone,status,engine,last_error,connected_at,last_seen_at,created_at,updated_at').eq('account_id', accountId).order('created_at', { ascending: false }); if (error) throw error; return NextResponse.json({ instances: data || [] }) } catch (e) { return toErrorResponse(e) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json(); const name = String(body.name || '').trim()
    const sessionName = String(body.session_name || name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || `canal-${Date.now()}`
    if (!name) return NextResponse.json({ error: 'Informe o nome do canal.' }, { status: 400 })
    const webhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin}/api/waha/webhook`
    const { data: instance, error } = await supabase.from('waha_instances').insert({ account_id: accountId, created_by: userId, name, session_name: sessionName, webhook_url: webhookUrl }).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 409 })
    try { await startSession(sessionName, webhookUrl); await supabase.from('waha_instances').update({ status: 'starting', last_error: null }).eq('id', instance.id); instance.status = 'starting' } catch (e) { const message = e instanceof WahaError ? e.message : 'Falha ao iniciar WAHA'; await supabase.from('waha_instances').update({ status: 'failed', last_error: message }).eq('id', instance.id); return NextResponse.json({ instance: { ...instance, status: 'failed', last_error: message }, error: message }, { status: e instanceof WahaError ? e.status : 502 }) }
    return NextResponse.json({ instance }, { status: 201 })
  } catch (e) { return toErrorResponse(e) }
}
