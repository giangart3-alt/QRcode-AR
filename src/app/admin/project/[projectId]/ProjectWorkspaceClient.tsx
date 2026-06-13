"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import type { ProjectMetadata, ScaleMode, SceneMetadata } from "@/lib/projects";

const SCALE_PRESETS = [50, 100, 200, 500, 1000];

export function ProjectWorkspaceClient({ projectId }: { projectId: string }) {
  const [password, setPassword] = useState(() =>
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("adminPassword") || ""
  );
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [draft, setDraft] = useState<ProjectMetadata | null>(null);
  const [newSceneName, setNewSceneName] = useState("");
  const [status, setStatus] = useState("Loading project...");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const activeScene = useMemo(() => {
    if (!draft) return null;
    return (
      draft.scenes.find((scene) => scene.id === draft.activeSceneId) ||
      draft.scenes[0] ||
      null
    );
  }, [draft]);

  const loadProject = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const result = (await response.json()) as {
      project?: ProjectMetadata;
      error?: string;
    };

    if (!response.ok || !result.project) {
      throw new Error(result.error || "Project not found.");
    }

    setError("");
    setProject(result.project);
    setDraft(result.project);
    setStatus("Project loaded.");
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        const result = (await response.json()) as {
          project?: ProjectMetadata;
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok || !result.project) {
          throw new Error(result.error || "Project not found.");
        }

        setError("");
        setProject(result.project);
        setDraft(result.project);
        setStatus("Project loaded.");
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Unable to load project.");
        setStatus("Unable to load project.");
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function saveProject(event?: FormEvent) {
    event?.preventDefault();
    if (!draft) return;

    setBusy(true);
    setError("");
    setStatus("Saving project...");

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          name: draft.name,
          marker: draft.marker,
          scenes: draft.scenes,
          activeSceneId: draft.activeSceneId
        })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to save project.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      setProject(result.project);
      setDraft(result.project);
      setStatus("Project saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save project.");
      setStatus("Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addScene(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("Adding scene placeholder...");

    try {
      const response = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          name: newSceneName || `Scene ${(draft?.scenes.length || 0) + 1}`
        })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to add scene.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      setProject(result.project);
      setDraft(result.project);
      setNewSceneName("");
      setStatus("Scene placeholder added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add scene.");
      setStatus("Add scene failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setActiveScene(sceneId: string) {
    setBusy(true);
    setError("");
    setStatus("Setting active scene...");

    try {
      const response = await fetch(`/api/projects/${projectId}/active-scene`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, activeSceneId: sceneId })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to set active scene.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      setProject(result.project);
      setDraft(result.project);
      setStatus("Active scene updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to set active scene.");
      setStatus("Active scene update failed.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(updater: (current: ProjectMetadata) => ProjectMetadata) {
    setDraft((current) => (current ? updater(current) : current));
  }

  function updateMarker(field: "styleId" | "widthMm" | "heightMm", value: string) {
    updateDraft((current) => ({
      ...current,
      marker: {
        ...current.marker,
        [field]: field === "styleId" ? value : parsePositiveDecimal(value, current.marker[field])
      }
    }));
  }

  function updateScene(sceneId: string, updater: (scene: SceneMetadata) => SceneMetadata) {
    updateDraft((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => (scene.id === sceneId ? updater(scene) : scene))
    }));
  }

  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-5">
          <div className="flex flex-wrap gap-2">
            <Link className="button-secondary" href="/admin/dashboard">
              Dashboard
            </Link>
            <Link className="button-secondary" href="/admin">
              Upload
            </Link>
          </div>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => loadProject()}
          >
            Refresh
          </button>
        </nav>

        <header className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
              Project workspace
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-[var(--ink)]">
              {draft?.name || projectId}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--muted)]">
              First architecture pass: project JSON, scenes, active scene selection,
              marker settings, scale settings, and public project links.
            </p>
          </div>
          {project ? (
            <a className="button-secondary" href={`/api/projects/${project.id}/export`}>
              Export JSON
            </a>
          ) : null}
        </header>

        <label className="mt-6 block max-w-md text-sm font-semibold text-[var(--ink)]">
          Admin password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
            autoComplete="current-password"
          />
        </label>

        {draft ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_420px]">
            <form noValidate onSubmit={saveProject} className="space-y-6">
              <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-[var(--ink)] md:col-span-2">
                    Project name
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                    />
                  </label>
                  <label className="text-sm font-semibold text-[var(--ink)]">
                    Marker style
                    <select
                      value={draft.marker.styleId}
                      onChange={(event) => updateMarker("styleId", event.target.value)}
                      className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)]"
                    >
                      <option value="technical-grid">Technical grid</option>
                      <option value="minimal-high-contrast">Minimal high contrast</option>
                      <option value="architectural-presentation-board">Architectural presentation board</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="Width mm"
                      value={draft.marker.widthMm}
                      onChange={(value) => updateMarker("widthMm", value)}
                    />
                    <NumberField
                      label="Height mm"
                      value={draft.marker.heightMm}
                      onChange={(value) => updateMarker("heightMm", value)}
                    />
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-[var(--soft)] p-4 text-sm leading-6 text-[var(--muted)]">
                  Origin is marker center. X moves left/right, Z moves forward/back on the marker,
                  and Y is vertical height above the marker. Print/export presets are modeled here;
                  full PDF/vector generation comes later.
                </div>
              </section>

              <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-[var(--ink)]">Scenes</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Active scene powers the QR project link and old single-model fallback routes.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {draft.scenes.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--soft)] p-5 text-sm text-[var(--muted)]">
                      No scenes yet. Add a placeholder or create a project from the upload page.
                    </div>
                  ) : null}

                  {draft.scenes.map((scene) => (
                    <article key={scene.id} className="rounded-lg border border-[var(--line)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black text-[var(--ink)]">{scene.name}</h3>
                          <p className="mt-1 break-all text-sm text-[var(--muted)]">
                            {scene.modelPathname || "GLB model placeholder"}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={scene.id === draft.activeSceneId ? "focus-ring rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white" : "button-secondary"}
                          disabled={busy || scene.id === draft.activeSceneId}
                          onClick={() => setActiveScene(scene.id)}
                        >
                          {scene.id === draft.activeSceneId ? "Active" : "Set active"}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <label className="text-sm font-semibold text-[var(--ink)]">
                          Scale mode
                          <select
                            value={scene.scaleMode}
                            onChange={(event) =>
                              updateScene(scene.id, (current) => ({
                                ...current,
                                scaleMode: event.target.value as ScaleMode
                              }))
                            }
                            className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)]"
                          >
                            <option value="fit">Fit to playground</option>
                            <option value="architectural">Architectural scale</option>
                          </select>
                        </label>
                        <NumberField
                          label="Normalized scale"
                          value={scene.normalizedScale}
                          onChange={(value) =>
                            updateScene(scene.id, (current) => ({
                              ...current,
                              normalizedScale: parsePositiveDecimal(value, current.normalizedScale)
                            }))
                          }
                        />
                        <label className="text-sm font-semibold text-[var(--ink)]">
                          Architectural scale
                          <select
                            value={SCALE_PRESETS.includes(scene.architecturalScale) ? String(scene.architecturalScale) : "custom"}
                            onChange={(event) => {
                              if (event.target.value === "custom") return;
                              updateScene(scene.id, (current) => ({
                                ...current,
                                architecturalScale: Number(event.target.value)
                              }));
                            }}
                            className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)]"
                          >
                            {SCALE_PRESETS.map((scale) => (
                              <option key={scale} value={scale}>
                                1:{scale}
                              </option>
                            ))}
                            <option value="custom">Custom</option>
                          </select>
                        </label>
                      </div>
                      <div className="mt-3 max-w-xs">
                        <NumberField
                          label="Custom architectural scale"
                          value={scene.architecturalScale}
                          onChange={(value) =>
                            updateScene(scene.id, (current) => ({
                              ...current,
                              architecturalScale: parsePositiveDecimal(value, current.architecturalScale)
                            }))
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <button
                type="submit"
                disabled={busy}
                className="focus-ring rounded-lg bg-[var(--accent)] px-5 py-3 font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
              >
                {busy ? "Saving..." : "Save workspace"}
              </button>
            </form>

            <aside className="space-y-6">
              <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                <h2 className="text-xl font-black text-[var(--ink)]">Project links</h2>
                <div className="mt-4 space-y-4">
                  <LinkRow label="AR project URL" value={draft.arUrl} />
                  <LinkRow label="Fallback viewer" value={draft.viewUrl} />
                  <LinkRow label="Marker board" value={draft.markerUrl} />
                  <LinkRow label="Legacy AR URL" value={draft.urls.legacyArUrl} />
                </div>
                <div className="mt-4 grid gap-2">
                  <Link className="focus-ring rounded-lg bg-[var(--ink)] px-4 py-3 text-center font-semibold text-white hover:bg-black" href={draft.arUrl}>
                    Open project AR
                  </Link>
                  <Link className="button-secondary text-center" href={draft.viewUrl}>
                    Open project viewer
                  </Link>
                  <Link className="button-secondary text-center" href={draft.markerUrl}>
                    Open marker page
                  </Link>
                </div>
              </section>

              <form onSubmit={addScene} className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                <h2 className="text-xl font-black text-[var(--ink)]">Add scene placeholder</h2>
                <label className="mt-4 block text-sm font-semibold text-[var(--ink)]">
                  Scene name
                  <input
                    value={newSceneName}
                    onChange={(event) => setNewSceneName(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                    placeholder={`Scene ${draft.scenes.length + 1}`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="focus-ring mt-4 w-full rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white hover:bg-black disabled:opacity-60"
                >
                  Add placeholder
                </button>
              </form>

              <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                <h2 className="text-xl font-black text-[var(--ink)]">Scale architecture</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
                  <p>
                    GLB units are treated as meters. Fit mode uses normalized scale as a
                    multiplier over a future baseFitScale measurement.
                  </p>
                  <p>
                    Architectural mode stores ratios like 1:100, so a 100 m model displays
                    around 1 m before final placement transforms.
                  </p>
                </div>
                {activeScene ? (
                  <div className="mt-4 rounded-lg bg-[var(--soft)] p-3 text-sm">
                    Active scene scale: <strong>{activeScene.scaleMode}</strong>
                  </div>
                ) : null}
              </section>

              <section className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-sm">
                <h2 className="text-xl font-black text-[var(--ink)]">Marker export placeholders</h2>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-semibold text-[var(--muted)]">
                  {["A4", "A3", "A2", "A1", "A0", "2A0", "4A0", "16:9", "16:10", "1:1", "Full HD", "4K", "8K", "Custom"].map((item) => (
                    <span key={item} className="rounded-md border border-[var(--line)] bg-[var(--soft)] px-3 py-2">
                      {item}
                    </span>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        ) : null}

        {error ? (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : null}
        <p className="mt-4 text-sm font-semibold text-[var(--muted)]">{status}</p>
      </div>
    </main>
  );
}

function LinkRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <p className="min-w-0 flex-1 break-all text-sm">{value}</p>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-[var(--ink)]">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={formatNumber(value)}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)] shadow-inner"
      />
    </label>
  );
}

function parsePositiveDecimal(value: string, fallback: number) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
