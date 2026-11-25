import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getSessionQr } from '@/lib/waha/client'
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { try { const { supabase, accountId } = await requireRole('viewer'); const { id } = await params; const { data } = await supabase.from('waha_instances').select('session_name,status').eq('id', id).eq('account_id', accountId).single(); if (!data) return NextResponse.json({ error: 'Canal não encontrado' }, { status: 404 }); const qr = await getSessionQr(data.session_name); return NextResponse.json({ qr }) } catch (e) { return toErrorResponse(e) } }
