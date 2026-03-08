import { NextResponse } from 'next/server';

const PS_BASE = 'https://api.partnerstack.com/api/v2';

export async function GET(request: Request) {
  const apiKey = process.env.PARTNERSTACK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'PARTNERSTACK_API_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  if (searchParams.get('limit')) params.set('limit', searchParams.get('limit')!);
  if (searchParams.get('starting_after')) params.set('starting_after', searchParams.get('starting_after')!);
  if (searchParams.get('payment_status')) params.set('payment_status', searchParams.get('payment_status')!);

  const qs = params.toString();
  const url = `${PS_BASE}/rewards${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `PartnerStack error: ${res.status}`, detail: text }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
