"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project } from "./projects";
import { getProject, listProjects } from "./projects";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listProjects();
        if (!cancelled) setProjects(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const data = await listProjects();
    setProjects(data);
  }, []);

  return useMemo(
    () => ({ projects, loading, error, refresh }),
    [error, loading, projects, refresh],
  );
}

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getProject(id);
        if (!cancelled) setProject(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const refresh = useCallback(async () => {
    const data = await getProject(id);
    setProject(data);
  }, [id]);

  return useMemo(() => ({ project, loading, error, refresh }), [error, loading, project, refresh]);
}

