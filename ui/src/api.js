async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

export const api = {
  // Omitting `project` asks for every project's prompts.
  listPrompts: (project) =>
    request(`/api/prompts${project ? `?project=${encodeURIComponent(project)}` : ""}`)
      .then((data) => data.prompts),
  listProjects: () => request("/api/projects").then((data) => data.projects),
  addPrompt: (project, text) =>
    request("/api/prompts", { method: "POST", body: { project, text } }).then((d) => d.prompt),
  editPrompt: (id, text) =>
    request(`/api/prompts/${id}`, { method: "PATCH", body: { text } }).then((d) => d.prompt),
  movePrompt: (id, project) =>
    request(`/api/prompts/${id}`, { method: "PATCH", body: { project } }).then((d) => d.prompt),
  setStatus: (id, status) =>
    request(`/api/prompts/${id}`, { method: "PATCH", body: { status } }).then((d) => d.prompt),
  removePrompt: (id) => request(`/api/prompts/${id}`, { method: "DELETE" }),
  // `ids` is the project's pending prompts in their new order.
  reorder: (ids) => request("/api/reorder", { method: "POST", body: { ids } }),
  session: (project) =>
    request(`/api/session${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  enhance: (payload) =>
    request("/api/enhance", { method: "POST", body: payload }).then((d) => d.content),
};
