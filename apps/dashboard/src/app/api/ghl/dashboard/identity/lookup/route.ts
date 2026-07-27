import { NextResponse } from 'next/server';
import { DashboardGhlError } from '@/server/ghl-dashboard/models';
import { dashboardRouteError, requireDashboardUser } from '@/server/ghl-dashboard/route';
import { lookupGhlIdentity } from '@/server/ghl-dashboard/service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireDashboardUser(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { ghlUserId?: unknown };
    const ghlUserId = typeof body.ghlUserId === 'string' ? body.ghlUserId.trim() : '';
    if (!ghlUserId || ghlUserId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(ghlUserId)) {
      throw new DashboardGhlError('invalid_ghl_user_id', 400);
    }
    return NextResponse.json(await lookupGhlIdentity(ghlUserId, auth.user.id));
  } catch (error) {
    return dashboardRouteError(error);
  }
}
