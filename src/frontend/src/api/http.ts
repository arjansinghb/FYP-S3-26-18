// Shared fetch wrapper over the FastAPI backend (src/backend) — used by both
// api/client.ts (child chat UI) and api/parentClient.ts (parent dashboard).
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {
      // response wasn't JSON — keep statusText
    }
    throw new ApiError(res.status, detail)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
