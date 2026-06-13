"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import type { ProjectMetadata, ProjectSummary } from "@/lib/projects";

export function DashboardClient() {
  const [password, setPassword] = useState(() =>
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("adminPassword") || ""
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [importJson, setImportJson] = useState("");
  const [status, setStatus] = useState("Enter the admin password to load projects.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadProjects(nextPassword = password) {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/projects", {
        headers: { "x-admin-password": nextPassword },
        cache: "no-store"
      });
      const result = (await response.json()) as {
        projects?: ProjectSummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "Unable to load projects.");
      }

      window.sessionStorage.setItem("adminPassword", nextPassword);
      setProjects(result.projects || []);
      setStatus(result.projects?.length ? "Projects loaded." : "No projects yet.");
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
    if (!name.trim()) {
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

      setName("");
      setStatus("Project created.");
      await loadProjects(password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create project.");
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
      setStatus("Project imported.");
      await loadProjects(password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid project JSON.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-5">
          <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]" href="/admin">
            Upload
          </Link>
          <Link className="button-secondary" href="/marker">
            Marker
          </Link>
        </nav>

        <header className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-[var(--ink)]">Project dashboard</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
              Persistent AR projects live as JSON in Vercel Blob. Each project can hold multiple scenes
              while old single-model links keep resolving through the active scene.
            </p>
          </div>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
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
            disabled={busy}
          >
            {busy ? "Working..." : "Load projects"}
          </button>
        </form>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-[var(--ink)]">Projects</h2>
              <p className="text-sm font-semibold text-[var(--muted)]">{status}</p>
            </div>

            <div className="mt-4 grid gap-3">
              {projects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--soft)] p-5 text-sm text-[var(--muted)]">
                  Create a project shell or import a JSON backup to begin.
                </div>
              ) : null}

              {projects.map((project) => (
                <article key={project.id} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black text-[var(--ink)]">{project.name}</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {project.sceneCount} scenes · active {project.activeSceneId || "none"}
                      </p>
                    </div>
                    <Link className="button-secondary" href={`/admin/project/${project.id}`}>
                      Open
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm">
                    <LinkRow label="AR project URL" value={project.arUrl} />
                    <LinkRow label="Marker URL" value={project.markerUrl} />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <form onSubmit={createProject} className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-xl font-black text-[var(--ink)]">Create project</h2>
              <label className="mt-4 block text-sm font-semibold text-[var(--ink)]">
                Project name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                  placeholder="Museum courtyard"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="focus-ring mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
              >
                Create empty project
              </button>
            </form>

            <form onSubmit={importProject} className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
              <h2 className="text-xl font-black text-[var(--ink)]">Import JSON</h2>
              <textarea
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                className="focus-ring mt-4 h-36 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 font-mono text-xs text-[var(--ink)] shadow-inner"
                placeholder="{ ...project backup... }"
              />
              <button
                type="submit"
                disabled={busy || !importJson.trim()}
                className="focus-ring mt-3 w-full rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white hover:bg-black disabled:opacity-60"
              >
                Import project
              </button>
            </form>
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
