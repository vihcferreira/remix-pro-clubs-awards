const ADMIN_TOKEN_STORAGE_KEY = 'pca_admin_session_token_v1';

export function getApiBaseUrl(): string {
  try {
    const raw = import.meta.env?.VITE_API_URL;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim().replace(/\/+$/, '');
    }
  } catch {
    // ignore in non-Vite environments
  }
  return '';
}

export function apiUrl(endpoint: string): string {
  const base = getApiBaseUrl();
  const normalizedPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${normalizedPath}`;
}

export function getStoredAdminToken(): string | null {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(endpoint), options);
}

export async function adminFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredAdminToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(apiUrl(endpoint), {
    ...options,
    headers,
  });
}
