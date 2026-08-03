export async function fetchWithTimeout(url: URL | string, init: RequestInit = {}, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`EXTERNAL_HTTP_${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

