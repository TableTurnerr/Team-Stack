import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company } from '@/lib/types';

/**
 * If the company is unassigned, set assigned_to = userId.
 * Used to auto-claim extension/unassigned leads when a member logs a call.
 * Silently no-ops on errors or when already assigned.
 */
export async function autoClaimCompany(companyId: string | undefined, userId: string | undefined): Promise<void> {
  if (!companyId || !userId) return;
  try {
    const company = await pb.collection(COLLECTIONS.COMPANIES).getOne<Company>(companyId, { fields: 'id,assigned_to' });
    if (company.assigned_to) return;
    await pb.collection(COLLECTIONS.COMPANIES).update(companyId, { assigned_to: userId });
  } catch {
    /* non-blocking */
  }
}
