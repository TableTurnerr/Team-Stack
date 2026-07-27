import 'server-only';
import { getDashboardGhlConfig } from './config';
import { DashboardGhlError } from './models';

const BASE_URL = 'https://services.leadconnectorhq.com';
type RequestOptions = { method?: string; body?: unknown; version?: string; userId?: string; recordId?: string };

export async function ghlRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const config = getDashboardGhlConfig();
  const started = Date.now();
  const operation = `${options.method || 'GET'} ${path.split('?')[0]}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Version: options.version || '2021-07-28',
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const requestId = response.headers.get('x-request-id') || undefined;
      if (response.ok) {
        const result = response.status === 204 ? {} : await response.json();
        console.info('[ghl-dashboard]', { operation, durationMs: Date.now() - started, status: response.status, requestId, applicationUserId: options.userId, ghlRecordId: options.recordId });
        return result as T;
      }
      const retryAfter = Number(response.headers.get('retry-after') || 0) || undefined;
      const code = response.status === 401 ? 'ghl_unauthorized' : response.status === 403 ? 'ghl_forbidden' : response.status === 429 ? 'ghl_rate_limited' : 'ghl_upstream_error';
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, Math.min((retryAfter || 2 ** attempt) * 1000, 4000)));
        continue;
      }
      throw new DashboardGhlError(code, response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status, retryAfter);
    } catch (error) {
      lastError = error;
      if (error instanceof DashboardGhlError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new DashboardGhlError('ghl_timeout', 504);
      if (attempt === 2) throw new DashboardGhlError('ghl_network_error', 502);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new DashboardGhlError('ghl_upstream_error');
}
