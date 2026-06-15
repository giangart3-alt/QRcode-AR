"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
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
  const [qrProjectId, setQrProjectId] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
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
        setPassword("");
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

  async function deleteProject(project: ProjectSummary) {
    const confirmed = window.confirm(
      `Delete "${project.name}" from Vercel Blob? This removes the project JSON and unreferenced GLB files.`
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");
    setStatus(`Deleting ${project.name}...`);

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const result = (await response.json()) as {
        deletedProjectId?: string;
        deletedAssets?: string[];
        error?: string;
      };

      if (!response.ok || !result.deletedProjectId) {
        throw new Error(result.error || "Unable to delete project.");
      }

      setQrProjectId((current) => (current === project.id ? "" : current));
      setQrDataUrl("");
      await loadProjects(password);
      setStatus(
        `Deleted ${project.name}. Removed ${result.deletedAssets?.length || 0} unreferenced asset(s).`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete project.");
      setStatus("Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cleanTestProjects() {
    const confirmed = window.confirm(
      "Clean test projects? This keeps only the most recently updated project and deletes the rest from Vercel Blob."
    );

    if (!confirmed) return;

    setBusy(true);
    setError("");
    setStatus("Cleaning test projects...");

    try {
      const response = await fetch("/api/projects/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm: true })
      });
      const result = (await response.json()) as {
        keptProject?: ProjectSummary | null;
        deletedProjects?: ProjectSummary[];
        deletedAssets?: string[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "Unable to clean test projects.");
      }

      await loadProjects(password);
      setStatus(
        `Cleanup complete. Kept ${result.keptProject?.name || "no project"} and deleted ${result.deletedProjects?.length || 0} project(s).`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to clean test projects.");
      setStatus("Cleanup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function showQr(project: ProjectSummary) {
    if (qrProjectId === project.id) {
      setQrProjectId("");
      setQrDataUrl("");
      return;
    }

    setError("");
    setQrProjectId(project.id);
    setQrDataUrl("");

    try {
      setQrDataUrl(await QRCode.toDataURL(project.arUrl, { margin: 1, width: 240 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate QR code.");
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
            <Link className="button-secondary" href="/ar/test">
              Open AR test
            </Link>
            <button
              type="button"
              className="focus-ring rounded-lg bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              disabled={!hasPassword || busy}
              onClick={() => setShowCreate((value) => !value)}
            >
              New project
            </button>
          </div>
        </nav>

        <header className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-[var(--ink)]">Project dashboard</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
              Saved projects from Vercel Blob. Open a project to upload scenes, tune placement,
              and share the stable AR QR link.
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

        {!hasPassword ? (
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
        ) : null}

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

        <div className="mt-6 grid gap-6">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-[var(--ink)]">Projects</h2>
              <p className="text-sm font-semibold text-[var(--muted)]">{status}</p>
            </div>

            <div>
              {projects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-white p-6">
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    {hasPassword
                      ? "No projects found in Vercel Blob yet."
                      : "Enter the admin password to load projects from Vercel Blob."}
                  </p>
                  {hasPassword ? (
                    <button
                      type="button"
                      className="focus-ring mt-4 rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-dark)]"
                      onClick={() => setShowCreate(true)}
                    >
                      New project
                    </button>
                  ) : null}
                </div>
              ) : null}

              {projects.length > 0 ? (
                <>
                  <div className="hidden overflow-x-auto rounded-xl border border-[var(--line)] bg-white md:block">
                    <table className="w-full min-w-[900px] border-collapse text-sm">
                      <thead className="bg-[var(--soft)] text-left text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)]">
                        <tr>
                          <th className="px-4 py-3">Project name</th>
                          <th className="px-4 py-3">Scenes</th>
                          <th className="px-4 py-3">Updated</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map((project) => (
                          <tr key={project.id} className="border-t border-[var(--line)]">
                            <td className="px-4 py-3">
                              <p className="font-black text-[var(--ink)]">{project.name}</p>
                              <p className="mt-1 max-w-md truncate text-xs text-[var(--muted)]">{project.arUrl}</p>
                            </td>
                            <td className="px-4 py-3 font-semibold text-[var(--muted)]">
                              {project.sceneCount}
                            </td>
                            <td className="px-4 py-3 font-semibold text-[var(--muted)]">
                              {formatDate(project.updatedAt)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <Link className="button-compact-primary" href={`/admin/project/${project.id}`}>
                                  Open
                                </Link>
                                <button type="button" className="button-compact" onClick={() => showQr(project)}>
                                  QR
                                </button>
                                <CopyButton value={project.arUrl} label="Copy link" compact />
                                <a className="button-compact" href={`/api/projects/${project.id}/export`}>
                                  Export JSON
                                </a>
                                <button
                                  type="button"
                                  className="button-compact-danger"
                                  disabled={busy}
                                  onClick={() => deleteProject(project)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-3 md:hidden">
                    {projects.map((project) => (
                      <article key={project.id} className="rounded-xl border border-[var(--line)] bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-base font-black text-[var(--ink)]">{project.name}</h3>
                            <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                              {project.sceneCount} scene{project.sceneCount === 1 ? "" : "s"} - {formatDate(project.updatedAt)}
                            </p>
                          </div>
                          <Link className="button-compact-primary shrink-0" href={`/admin/project/${project.id}`}>
                            Open
                          </Link>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button type="button" className="button-compact" onClick={() => showQr(project)}>
                            QR
                          </button>
                          <CopyButton value={project.arUrl} label="Copy link" compact />
                          <a className="button-compact" href={`/api/projects/${project.id}/export`}>
                            Export JSON
                          </a>
                          <button
                            type="button"
                            className="button-compact-danger"
                            disabled={busy}
                            onClick={() => deleteProject(project)}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}

              {qrProjectId ? (
                <div className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4">
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="Project AR QR code" className="mx-auto w-52 rounded-md border border-[var(--line)] bg-white p-2" />
                  ) : (
                    <p className="text-sm font-semibold text-[var(--muted)]">Generating QR...</p>
                  )}
                  <p className="mt-3 break-all text-xs font-semibold text-[var(--muted)]">
                    {projects.find((project) => project.id === qrProjectId)?.arUrl}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <details className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-black text-[var(--ink)]">
              Backup / Advanced
            </summary>
            <form onSubmit={importProject} className="mt-4">
              <h2 className="text-lg font-black text-[var(--ink)]">Import JSON</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Restore a manually exported project backup. Existing Blob model files are kept unless you delete projects or scenes.
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
                className="focus-ring mt-3 rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white hover:bg-black disabled:opacity-60"
              >
                Import project
              </button>
            </form>
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <h2 className="text-lg font-black text-[var(--ink)]">Clean test projects</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Keeps only the most recently updated project and deletes the rest from Vercel Blob.
              </p>
              <button
                type="button"
                disabled={busy || !password}
                className="button-compact-danger mt-3"
                onClick={cleanTestProjects}
              >
                Clean test projects
              </button>
            </div>
          </details>
        </div>

        {error ? (
          <p className="mt-6 rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-4 text-sm font-semibold text-[var(--ink)]">
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
