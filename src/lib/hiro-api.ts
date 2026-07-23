/**
 * Shared fetch wrapper for Hiro's Stacks API, attaching the API key
 * (raises rate limits) when configured.
 */

const HIRO_API_KEY = import.meta.env.VITE_HIRO_API_KEY;

export const HIRO_API_BASE = 'https://api.hiro.so';

export function hiroFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (HIRO_API_KEY) {
    headers.set('x-api-key', HIRO_API_KEY);
  }
  return fetch(url, { ...init, headers });
}
