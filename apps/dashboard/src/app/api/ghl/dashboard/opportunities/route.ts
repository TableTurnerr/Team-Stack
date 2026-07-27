import { NextResponse } from 'next/server';
import { dashboardRouteError, requireDashboardUser } from '@/server/ghl-dashboard/route';
import { getOpportunity, listOpportunities } from '@/server/ghl-dashboard/service';
import { DashboardGhlError } from '@/server/ghl-dashboard/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireDashboardUser(request);
  if (auth.error) return auth.error;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (id) return NextResponse.json(await getOpportunity(id, auth.user.id));
    const pipelineId = url.searchParams.get('pipelineId');
    const stageId = url.searchParams.get('stageId');
    if (!pipelineId) throw new DashboardGhlError('pipeline_required', 400);
    if (!stageId) throw new DashboardGhlError('stage_required', 400);
    return NextResponse.json(await listOpportunities(pipelineId, stageId, url.searchParams.get('cursor') || undefined, auth.user.id));
  } catch (error) { return dashboardRouteError(error); }
}
