import { NextResponse } from 'next/server';
import { dashboardRouteError, requireDashboardUser } from '@/server/ghl-dashboard/route';
import { getTeamOverview } from '@/server/ghl-dashboard/service';
import { DashboardGhlError } from '@/server/ghl-dashboard/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireDashboardUser(request);
  if (auth.error) return auth.error;
  try {
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get('pipelineId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!pipelineId) throw new DashboardGhlError('pipeline_required', 400);
    if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) throw new DashboardGhlError('invalid_period', 400);
    return NextResponse.json(await getTeamOverview(auth.user.id, auth.user.email, pipelineId, from, to));
  } catch (error) { return dashboardRouteError(error); }
}
