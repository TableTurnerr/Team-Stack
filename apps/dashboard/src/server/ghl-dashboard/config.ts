import 'server-only';
import { DashboardGhlError } from './models';

export interface DashboardGhlConfig {
  token: string;
  locationId: string;
  leadSource: string;
  customFieldKeys: string[];
  staleDays: number;
  timeoutMs: number;
}

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new DashboardGhlError('ghl_not_configured', 503, undefined, { field: name });
  return value;
};

const positiveNumber = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new DashboardGhlError('ghl_invalid_configuration', 503, undefined, { field: name });
  }
  return value;
};

export function getDashboardGhlConfig(): DashboardGhlConfig {
  return {
    token: required('GHL_PRIVATE_INTEGRATION_TOKEN'),
    locationId: required('GHL_LOCATION_ID'),
    leadSource: required('GHL_DEFAULT_LEAD_SOURCE'),
    customFieldKeys: (process.env.GHL_LEAD_CUSTOM_FIELD_KEYS || '').split(',').map(v => v.trim()).filter(Boolean),
    staleDays: positiveNumber('GHL_STALE_DAYS', 14),
    timeoutMs: positiveNumber('GHL_REQUEST_TIMEOUT_MS', 12_000),
  };
}

export function dashboardGhlIsConfigured() {
  try { getDashboardGhlConfig(); return true; } catch { return false; }
}
