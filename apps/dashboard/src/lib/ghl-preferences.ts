'use client';

export interface GhlPreferences {
  pipelineId?: string;
  stageId?: string;
  submissionTag?: string;
}

const key = (userId: string) => `tt_ghl_preferences_${userId}`;

export function getGhlPreferences(userId: string): GhlPreferences {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) || '{}') as GhlPreferences;
  } catch {
    return {};
  }
}

export function saveGhlPreferences(userId: string, patch: Partial<GhlPreferences>) {
  const next = { ...getGhlPreferences(userId), ...patch };
  localStorage.setItem(key(userId), JSON.stringify(next));
  return next;
}
