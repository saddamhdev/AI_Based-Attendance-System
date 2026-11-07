const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api";
export type UserRole = "ADMIN" | "TEACHER" | "STUDENT";

let token: string | null = localStorage.getItem("attendance-token");

export function setToken(nextToken: string | null) {
  token = nextToken;
  if (nextToken) localStorage.setItem("attendance-token", nextToken);
  else localStorage.removeItem("attendance-token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = "Bearer " + token;

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message ?? "Request failed");
  }
  return response.status === 204 ? ({} as T) : (await response.json());
}

export const api = {
  login: (usernameOrEmail: string, password: string) =>
    request<{ token: string; role: UserRole; username: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail, password }),
    }),
  me: () => request<{ id: number; username: string; role: UserRole; studentId?: number }>("/auth/me"),
  students: (q = "") => request<any[]>(`/students?q=${encodeURIComponent(q)}`),
  createStudent: (payload: any) => request<any>("/students", { method: "POST", body: JSON.stringify(payload) }),
  courses: () => request<any[]>("/courses"),
  sections: () => request<any[]>("/courses/sections"),
  enrollments: (sectionId: number) => request<any[]>(`/courses/enrollments?sectionId=${sectionId}`),
  sessions: () => request<any[]>("/attendance/sessions"),
  createSession: (payload: any) => request<any>("/attendance/sessions", { method: "POST", body: JSON.stringify(payload) }),
  review: (sessionId: number) => request<any>(`/attendance/sessions/${sessionId}/review`),
  mark: (sessionId: number, studentId: number, payload: any) =>
    request<any>(`/attendance/sessions/${sessionId}/records/${studentId}`, { method: "PUT", body: JSON.stringify(payload) }),
  confirm: (sessionId: number) => request<any>(`/attendance/sessions/${sessionId}/confirm`, { method: "POST" }),
  uploadPhotos: async (sessionId: number, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch(`${API_BASE}/attendance/sessions/${sessionId}/photos`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message ?? "Upload failed");
    }
    return response.json();
  },
  reports: () => request<any>("/reports/summary"),
  settings: () => request<any[]>("/settings"),
  updateSettings: (payload: Record<string, string>) => request<any[]>("/settings", { method: "PUT", body: JSON.stringify(payload) }),
};
