import { NextResponse } from 'next/server';
import { dashboardRouteError, requireDashboardUser } from '@/server/ghl-dashboard/route';
import { submitLead } from '@/server/ghl-dashboard/service';
import { parseLeadSubmission } from '@/server/ghl-dashboard/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireDashboardUser(request);
  if (auth.error) return auth.error;
  try {
    const result = await submitLead(parseLeadSubmission(await request.json()), auth.user.id, auth.user.email);
    return NextResponse.json(result, { status: result.status === 'duplicate' ? 409 : 201 });
  } catch (error) { return dashboardRouteError(error); }
}
