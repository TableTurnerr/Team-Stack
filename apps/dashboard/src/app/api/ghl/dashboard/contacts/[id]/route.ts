import { NextResponse } from 'next/server';
import { dashboardRouteError, requireDashboardUser } from '@/server/ghl-dashboard/route';
import { updateContact } from '@/server/ghl-dashboard/service';
import { parseContactPatch } from '@/server/ghl-dashboard/validation';

export const runtime = 'nodejs';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser(request);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    return NextResponse.json(await updateContact(id, parseContactPatch(await request.json()), auth.user.id));
  } catch (error) { return dashboardRouteError(error); }
}
