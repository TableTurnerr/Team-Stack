import { NextResponse } from 'next/server';
import { dashboardRouteError, requireDashboardUser } from '@/server/ghl-dashboard/route';
import { getLeadFormConfig } from '@/server/ghl-dashboard/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireDashboardUser(request);
  if (auth.error) return auth.error;
  try { return NextResponse.json(await getLeadFormConfig(auth.user.id, auth.user.email)); }
  catch (error) { return dashboardRouteError(error); }
}
