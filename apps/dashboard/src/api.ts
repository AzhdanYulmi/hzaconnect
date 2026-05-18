const API_BASE = ""; // same origin (nginx proxies /api)

export type AgentMe = {
  id: string;
  email: string;
  display_name: string;
  role: "agent" | "supervisor" | "admin";
};

let accessToken: string | null = null;
export const authToken = {
  get: () => accessToken,
  set: (t: string | null) => (accessToken = t),
};

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401 && path !== "/api/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${accessToken}`);
      const res2 = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        credentials: "include",
      });
      if (!res2.ok) throw new Error(await res2.text());
      return res2.json();
    }
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function tryRefresh(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { access_token: string };
  accessToken = data.access_token;
  return true;
}

export type AgentRow = {
  id: string;
  email: string;
  display_name: string;
  role: "agent" | "supervisor" | "admin";
  status: "active" | "disabled";
  last_seen_at: string | null;
  created_at: string;
};

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; agent: AgentMe }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  refresh: tryRefresh,
  me: () => request<AgentMe>("/api/auth/me"),
  logout: () =>
    fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }),
  presign: (mime: string, size: number, conversationId?: string) =>
    request<{ attachment_id: string; upload_url: string; object_key: string }>(
      "/api/attachments/presign",
      {
        method: "POST",
        body: JSON.stringify({
          mime_type: mime,
          byte_size: size,
          conversation_id: conversationId,
        }),
      },
    ),
  attachmentUrl: (id: string) =>
    request<{ url: string; mime_type: string; width: number | null; height: number | null }>(
      `/api/attachments/${id}/url`,
    ),
  // --- Tags ---
  listTags: () =>
    request<
      Array<{ id: string; slug: string; label_en: string; label_tr: string | null; color: string }>
    >("/api/tags"),
  adminListTags: () =>
    request<
      Array<{
        id: string;
        slug: string;
        label_en: string;
        label_tr: string | null;
        color: string;
        archived_at: string | null;
      }>
    >("/api/admin/tags"),
  adminCreateTag: (body: {
    slug: string;
    label_en: string;
    label_tr?: string;
    color?: string;
  }) =>
    request<{ id: string; slug: string; label_en: string; label_tr: string | null; color: string }>(
      "/api/admin/tags",
      { method: "POST", body: JSON.stringify(body) },
    ),
  adminUpdateTag: (
    id: string,
    body: {
      label_en?: string;
      label_tr?: string;
      color?: string;
      archived?: boolean;
    },
  ) =>
    request(`/api/admin/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listConversationTags: (id: string) =>
    request<
      Array<{
        tag_id: string;
        slug: string;
        label_en: string;
        label_tr: string | null;
        color: string;
        applied_at: string;
      }>
    >(`/api/conversations/${id}/tags`),
  applyConversationTag: (id: string, tagId: string) =>
    request(`/api/conversations/${id}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag_id: tagId }),
    }),
  removeConversationTag: (id: string, tagId: string) =>
    request(`/api/conversations/${id}/tags/${tagId}`, { method: "DELETE" }),
  conversationsByTag: (tagId: string) =>
    request<string[]>(`/api/conversations/by-tag?tag_id=${encodeURIComponent(tagId)}`),

  // --- Identifiers ---
  listSessionIdentifiers: (sessionId: string) =>
    request<
      Array<{
        id: string;
        kind: "player_id" | "email" | "phone" | "username" | "custom";
        custom_label: string | null;
        value: string;
        source: "self" | "agent" | "sso";
        superseded_at: string | null;
        created_at: string;
      }>
    >(`/api/sessions/${sessionId}/identifiers`),
  recordSessionIdentifier: (
    sessionId: string,
    body: {
      kind: "player_id" | "email" | "phone" | "username" | "custom";
      value: string;
      custom_label?: string;
    },
  ) =>
    request(`/api/sessions/${sessionId}/identifiers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  matchIdentifier: (
    kind: string,
    value: string,
    excludeSession: string,
  ) =>
    request<
      Array<{
        session_id: string;
        kind: string;
        value: string;
        conversations_count: number;
        created_at: string;
      }>
    >(
      `/api/identifiers/match?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(
        value,
      )}&exclude_session=${encodeURIComponent(excludeSession)}`,
    ),
  // Deployment-wide identifier configuration
  getDeploymentSettings: () =>
    request<{
      identifier_fields: Array<{
        kind: "player_id" | "email" | "phone" | "username" | "custom";
        custom_label?: string;
        required?: boolean;
        regex?: string;
        label_en?: string;
        label_tr?: string;
      }>;
      require_before_chat: boolean;
    }>("/api/admin/deployment-settings"),
  putDeploymentSettings: (body: {
    identifier_fields: Array<{
      kind: "player_id" | "email" | "phone" | "username" | "custom";
      custom_label?: string;
      required?: boolean;
      regex?: string;
      label_en?: string;
      label_tr?: string;
    }>;
    require_before_chat: boolean;
  }) =>
    request("/api/admin/deployment-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // --- Admin / agents ---
  listAgents: () => request<AgentRow[]>("/api/auth/agents"),
  createAgent: (input: {
    email: string;
    password: string;
    display_name: string;
    role: "agent" | "supervisor" | "admin";
  }) =>
    request<AgentRow>("/api/auth/agents", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAgent: (
    id: string,
    patch: Partial<{
      display_name: string;
      role: "agent" | "supervisor" | "admin";
      status: "active" | "disabled";
    }>,
  ) =>
    request<AgentRow>(`/api/auth/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};
