"use client";

import { api } from "./api";

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export async function listProjects(): Promise<Project[]> {
  return await api<Project[]>("/api/projects");
}

export async function getProject(id: string): Promise<Project> {
  return await api<Project>(`/api/projects/${encodeURIComponent(id)}`);
}

export async function createProject(input: {
  name: string;
  description?: string;
}): Promise<Project> {
  return await api<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
    }),
  });
}

export async function updateProject(
  id: string,
  input: { name: string; description?: string },
): Promise<Project> {
  return await api<Project>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
    }),
  });
}

export async function deleteProject(id: string): Promise<{ ok: true }> {
  return await api<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

