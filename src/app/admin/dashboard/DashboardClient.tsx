"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import type { ProjectMetadata, ProjectSummary } from "@/lib/projects";

export function DashboardClient() {
  const router = useRouter();
  const [password, setPassword] = useState(() =>
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("adminPassword") || ""
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [status, setStatus] = useState("Enter the admin password to load projects.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hasPassword = Boolean(password);

  useEffect(() => {
    const storedPassword = window.sessionStorage.getItem("adminPassword") || "";
    if (!storedPassword) {
      return;
    }

    let cancelled = false;

    async function run() {
      setBusy(true);
      setStatus("Loading projects...");

      try {
        const nextProjects = await fetchProjects(storedPassword);
        if (cancelled) return;

        setPassword(storedPassword);
        setProjects(nextProjects);
        setStatus(nextProjects.length ? "Projects loaded." : "No projects yet.");
      } catch (caught) {
        if (cancelled) return;
        window.sessionStorage.removeItem("adminPassword");
        setStatus("Enter the admin password to load projects.");
        setError(caught instanceof Error ? caught.message : "Unable to load projects.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadProjects(nextPassword = password) {
    setBusy(true);
    setError("");
    setStatus("Loading projects...");

    try {
      const nextProjects = await fetchProjects(nextPassword);
      window.sessionStorage.setItem("adminPassword", nextPassword);
      setPassword(nextPassword);
      setProjects(nextProjects);
      setStatus(nextProjects.length ? "Projects loaded." : "No projects yet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load projects.");
      setStatus("Unable to load projects.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    await loadProjects(password);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();

    if (!name) {
      setError("Project name is required.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus("Creating project...");

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, name })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to create project.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      router.push(`/admin/project/${result.project.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create project.");
      setStatus("Create project failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importProject(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setStatus("Importing project JSON...");

    try {
      const parsed = JSON.parse(importJson) as unknown;
      const response = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, project: parsed })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to import project.");
      }

      setImportJson("");
      await loadProjects(password);
      setStatus("Project imported.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid project JSON.");
      setStatus("Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-5">
          <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]" href="/">
            QRcode AR
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link className="button-secondary" href="/marker">
              Marker
            </Link>
            <button
              type="button"
              className="focus-ring rounded-lg bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              disabled={!hasPassword || busy}
              onClick={() => setShowCreate((value) => !value)}
            >
              Create new project
            </button>
          </div>
        </nav>

        <header className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-[var(--ink)]">Project dashboard</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
              Manage persistent AR projects stored in Vercel Blob. Open a project to upload
              scenes, tune placement, and copy project-level AR links.
            </p>
          </div>
          <button
            type="button"
            className="button-secondary"
            disabled={!hasPassword || busy}
            onClick={() => loadProjects()}
          >
            Refresh
          </button>
        </header>

        <form onSubmit={unlock} className="mt-6 grid gap-3 rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm md:grid-cols-[1fr_auto]">
          <label className="text-sm font-semibold text-[var(--ink)]">
            Admin password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
              autoComplete="current-password"
            />
          </label>
          <button
            type="submit"
            className="focus-ring self-end rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white hover:bg-black disabled:opacity-60"
            disabled={busy || !password}
          >
            {busy ? "Working..." : "Load projects"}
          </button>
        </form>

        {showCreate ? (
          <form onSubmit={createProject} className="mt-6 grid gap-3 rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm md:grid-cols-[1fr_auto]">
            <label className="text-sm font-semibold text-[var(--ink)]">
              New project name
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                placeholder="Gallery installation"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !newProjectName.trim()}
              className="focus-ring self-end rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
            >
              Create and open
            </button>
          </form>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-[var(--ink)]">Projects</h2>
              <p className="text-sm font-semibold text-[var(--muted)]">{status}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {projects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-white p-6 text-sm leading-6 text-[var(--muted)] md:col-span-2">
                  {hasPassword
                    ? "No projects found in Vercel Blob yet. Create a project to start building scenes."
                    : "Enter the admin password to load projects from Vercel Blob."}
                </div>
              ) : null}

              {projects.map((project) => (
                <article key={project.id} className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-black text-[var(--ink)]">{project.name}</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {project.sceneCount} scene{project.sceneCount === 1 ? "" : "s"} - updated {formatDate(project.updatedAt)}
                      </p>
                    </div>
                    <Link
                      className="focus-ring rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-dark)]"
                      href={`/admin/project/${project.id}`}
                    >
                      Open project
                    </Link>
                  </div>

                  <div className="mt-5 grid gap-3 text-sm">
                    <LinkRow label="AR link" value={project.arUrl} />
                    <LinkRow label="Viewer link" value={project.viewUrl} />
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <a className="button-secondary" href={`/api/projects/${project.id}/export`}>
                      Export JSON
                    </a>
                    <Link className="button-secondary" href={project.markerUrl}>
                      Marker
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <form onSubmit={importProject} className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-xl font-black text-[var(--ink)]">Import JSON</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Manual backup import. Existing Blob files are never deleted automatically.
              </p>
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                className="focus-ring mt-4 h-36 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 font-mono text-xs text-[var(--ink)] shadow-inner"
                placeholder="{ ...project backup... }"
              />
              <button
                type="submit"
                disabled={busy || !password || !importJson.trim()}
                className="focus-ring mt-3 w-full rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white hover:bg-black disabled:opacity-60"
              >
                Import project
              </button>
            </form>
            <Link className="button-secondary w-full text-center" href="/admin/legacy-upload">
              Legacy single-upload debug page
            </Link>
          </aside>
        </div>

        {error ? (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}

async function fetchProjects(password: string) {
  const response = await fetch("/api/projects", {
    headers: { "x-admin-password": password },
    cache: "no-store"
  });
  const result = (await response.json()) as {
    projects?: ProjectSummary[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "Unable to load projects.");
  }

  return result.projects || [];
}

function LinkRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <p className="min-w-0 flex-1 break-all">{value}</p>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
