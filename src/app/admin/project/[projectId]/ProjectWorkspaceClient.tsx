"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SceneThreeViewport, type TransformMode } from "@/components/SceneThreeViewport";
import { APP_AXIS_COLORS, type AppAxis } from "@/lib/coordinates";
import {
  HIRO_MARKER_IMAGE_URL,
  createDefaultMarker,
  createDefaultPlacement,
  getMarkerBoardGeometry,
  type MarkerSettings
} from "@/lib/placement";
import { fitModelToMarker, roundForStorage, type SceneScaleMetrics } from "@/lib/scene-transform";
import type { ProjectMetadata, SceneMetadata } from "@/lib/projects";

type UploadProgress = {
  loaded?: number;
  total?: number;
  percentage?: number;
};

type UploadStage = "idle" | "uploading" | "saving";
type SaveState = "saved" | "dirty" | "saving" | "error";

type UploadRouteResponse = {
  error?: string;
};

const MAX_GLB_SIZE_BYTES = 500 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

export function ProjectWorkspaceClient({ projectId }: { projectId: string }) {
  const [password] = useState(() =>
    typeof window === "undefined" ? "" : window.sessionStorage.getItem("adminPassword") || ""
  );
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [newSceneName, setNewSceneName] = useState("");
  const [newSceneFile, setNewSceneFile] = useState<File | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [metrics, setMetrics] = useState<SceneScaleMetrics | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [markerOpen, setMarkerOpen] = useState(false);
  const [scenesOpen, setScenesOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [status, setStatus] = useState("Loading project...");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);

  const selectedScene = useMemo(() => {
    if (!project) return null;
    return (
      project.scenes.find((scene) => scene.id === selectedSceneId) ||
      project.scenes.find((scene) => scene.id === project.activeSceneId) ||
      project.scenes[0] ||
      null
    );
  }, [project, selectedSceneId]);
  const working = busy || uploadStage !== "idle";
  const canOpenQr = saveState === "saved" && !working;

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
        setSelectedSceneId(result.project.activeSceneId || result.project.scenes[0]?.id || "");
        setSaveState("saved");
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

  const markDirty = useCallback((nextStatus = "Unsaved changes.") => {
    setQrOpen(false);
    setQrDataUrl("");
    setSaveState("dirty");
    setStatus(nextStatus);
  }, []);

  const handleViewportStatus = useCallback((nextStatus: string) => {
    setStatus(nextStatus);
  }, []);

  const handleMetricsChange = useCallback((nextMetrics: SceneScaleMetrics | null) => {
    setMetrics(nextMetrics);
  }, []);

  const handleSceneTransformChange = useCallback((nextScene: SceneMetadata) => {
    setProject((current) =>
      current ? updateSceneInProject(current, nextScene.id, () => nextScene) : current
    );
    markDirty("Scene has unsaved changes.");
  }, [markDirty]);

  async function saveProject(nextProject = project, nextStatus = "Project saved.") {
    if (!nextProject) return null;

    setBusy(true);
    setError("");
    setSaveState("saving");
    setStatus("Saving project...");

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          name: nextProject.name,
          marker: nextProject.marker,
          scenes: nextProject.scenes,
          activeSceneId: nextProject.activeSceneId
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
      setSelectedSceneId((current) => current || result.project?.activeSceneId || "");
      setQrDataUrl("");
      setSaveState("saved");
      setStatus(nextStatus);
      return result.project;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save project.");
      setSaveState("error");
      setStatus("Save failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createScene(event: FormEvent) {
    event.preventDefault();

    try {
      if (!newSceneFile) {
        throw new Error("Choose a .glb file for the new scene.");
      }

      const sceneName = newSceneName.trim() || newSceneFile.name.replace(/\.glb$/i, "");
      setUploadStage("uploading");
      setUploadProgress(0);
      setError("");
      setStatus("Uploading scene GLB...");

      const blob = await uploadGlb(newSceneFile, password, (progress) => setUploadProgress(progress));
      setUploadStage("saving");
      setStatus("Saving scene...");

      const response = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          name: sceneName,
          modelUrl: blob.url,
          modelPathname: blob.pathname,
          modelSize: newSceneFile.size,
          scaleMode: "fit",
          normalizedScale: 1,
          architecturalScale: 100
        })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        scene?: SceneMetadata;
        error?: string;
      };

      if (!response.ok || !result.project || !result.scene) {
        throw new Error(result.error || "Unable to add scene.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      setProject(result.project);
      setSelectedSceneId(result.scene.id);
      setNewSceneName("");
      setNewSceneFile(null);
      setUploadProgress(100);
      setSaveState("saved");
      setStatus("Scene added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add scene.");
      setStatus("Add scene failed.");
    } finally {
      setUploadStage("idle");
    }
  }

  async function replaceSceneModel(event: FormEvent) {
    event.preventDefault();
    if (!selectedScene || !project) return;

    try {
      if (!replaceFile) {
        throw new Error("Choose a .glb file.");
      }

      setUploadStage("uploading");
      setUploadProgress(0);
      setError("");
      setStatus("Uploading replacement GLB...");

      const blob = await uploadGlb(replaceFile, password, (progress) => setUploadProgress(progress));
      const updatedProject = updateSceneInProject(project, selectedScene.id, (scene) => ({
        ...scene,
        name: scene.name || replaceFile.name.replace(/\.glb$/i, ""),
        modelUrl: blob.url,
        modelPathname: blob.pathname,
        modelSize: replaceFile.size,
        scaleMode: scene.scaleMode || "fit",
        normalizedScale: scene.normalizedScale || 1,
        architecturalScale: scene.architecturalScale || 100,
        placement: scene.placement || createDefaultPlacement(1, 0)
      }));

      setUploadStage("saving");
      setStatus("Saving scene model...");
      setProject(updatedProject);
      setReplaceFile(null);
      await saveProject(updatedProject, "Scene model saved.");
      setUploadProgress(100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to upload scene model.");
      setStatus("Upload failed.");
    } finally {
      setUploadStage("idle");
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
      setSelectedSceneId(sceneId);
      setSaveState("saved");
      setStatus("Active scene updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to set active scene.");
      setStatus("Active scene update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleQr() {
    if (!project) return;

    if (qrOpen) {
      setQrOpen(false);
      return;
    }

    if (!canOpenQr) {
      setStatus("Save the project before opening the QR code.");
      return;
    }

    setQrOpen(true);
    await ensureQrDataUrl();
  }

  async function openMarkerModal() {
    setMarkerOpen(true);
  }

  async function ensureQrDataUrl() {
    if (!project || qrDataUrl) return;

    setQrDataUrl("");
    setError("");

    try {
      setQrDataUrl(await QRCode.toDataURL(project.arUrl, { margin: 1, width: 260 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate QR code.");
    }
  }

  async function deleteScene(sceneId: string) {
    if (!project) return;

    const scene = project.scenes.find((item) => item.id === sceneId);
    if (!scene) return;

    const confirmed = window.confirm(
      `Delete "${scene.name}" from this project? Its GLB will be deleted from Vercel Blob if no other project references it.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    setStatus("Deleting scene...");

    try {
      const response = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        deletedAssets?: string[];
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to delete scene.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      setProject(result.project);
      setSelectedSceneId(result.project.activeSceneId || result.project.scenes[0]?.id || "");
      setInspectorOpen(false);
      setSaveState("saved");
      setStatus(`Scene deleted. Removed ${result.deletedAssets?.length || 0} unreferenced asset(s).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete scene.");
      setStatus("Delete scene failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMarkerSettings(closeAfterSave = false) {
    const saved = await saveProject(project, "Marker settings saved.");
    if (saved && closeAfterSave) {
      setMarkerOpen(false);
    }
  }

  function updateProjectName(name: string) {
    setProject((current) => (current ? { ...current, name } : current));
    markDirty("Project name changed.");
  }

  function updateScene(sceneId: string, updater: (scene: SceneMetadata) => SceneMetadata) {
    setProject((current) => (current ? updateSceneInProject(current, sceneId, updater) : current));
    markDirty("Scene has unsaved changes.");
  }

  function updateSceneNumber(
    sceneId: string,
    field: "normalizedScale",
    value: string
  ) {
    updateScene(sceneId, (scene) => ({
      ...scene,
      [field]: parsePositiveDecimal(value, scene[field])
    }));
  }

  function updatePlacementNumber(
    sceneId: string,
    group: "position" | "rotation",
    field: "x" | "y" | "z",
    value: string
  ) {
    updateScene(sceneId, (scene) => ({
      ...scene,
      placement: {
        ...scene.placement,
        [group]: {
          ...scene.placement[group],
          [field]: parseDecimal(value, scene.placement[group][field])
        }
      }
    }));
  }

  function centerScene(sceneId: string) {
    updateScene(sceneId, (scene) => ({
      ...scene,
      placement: {
        ...scene.placement,
        position: { ...scene.placement.position, x: 0, y: 0 }
      }
    }));
  }

  function resetScene(sceneId: string) {
    updateScene(sceneId, (scene) => ({
      ...scene,
      scaleMode: "fit",
      normalizedScale: 1,
      architecturalScale: 100,
      placement: createDefaultPlacement(1, 0)
    }));
  }

  function rotateScene(sceneId: string, axis: "x" | "y" | "z") {
    updateScene(sceneId, (scene) => ({
      ...scene,
      placement: {
        ...scene.placement,
        rotation: {
          ...scene.placement.rotation,
          [axis]: roundForStorage(scene.placement.rotation[axis] + 90)
        }
      }
    }));
  }

  const saveStateLabel = {
    saved: "Saved",
    dirty: "Unsaved changes",
    saving: "Saving...",
    error: "Save error"
  }[saveState];

  return (
    <main className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-white px-3 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link className="button-compact shrink-0" href="/admin/dashboard">
            Back
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-[var(--ink)]">
              {project?.name || projectId}
            </h1>
            <p className="truncate text-xs text-[var(--muted)]">
              {saveStateLabel} - {status}
            </p>
          </div>
        </div>

        {project ? (
          <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button type="button" className="button-compact" onClick={openMarkerModal}>
              Marker
            </button>
            <button
              type="button"
              className="button-compact"
              disabled={!canOpenQr}
              title={canOpenQr ? "Show QR code" : "Save the project before opening the QR code"}
              onClick={toggleQr}
            >
              QR
            </button>
            <button
              type="button"
              className="button-compact-primary"
              disabled={working || saveState === "saving"}
              onClick={() => saveProject(project, "Project saved.")}
            >
              Save project
            </button>
            {qrOpen ? (
              <div className="absolute right-0 top-14 z-20 w-72 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt={`QR code for ${project.name}`} className="mx-auto w-44 rounded-md border border-[var(--line)] bg-white p-2" />
                ) : (
                  <p className="text-sm font-semibold text-[var(--muted)]">Generating QR...</p>
                )}
                <p className="mt-3 text-center text-xs font-semibold text-[var(--muted)]">
                  Scan this after saving. It opens the latest saved project on mobile.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className={selectedScene ? "relative h-[calc(100vh-3.5rem)] lg:grid lg:grid-cols-[280px_minmax(0,1fr)_340px]" : "relative h-[calc(100vh-3.5rem)] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]"}>
        {scenesOpen ? (
          <button
            type="button"
            aria-label="Close scenes"
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            onClick={() => setScenesOpen(false)}
          />
        ) : null}
        <aside className={`${scenesOpen ? "fixed inset-y-0 left-0 z-30 w-[min(22rem,88vw)]" : "hidden"} overflow-y-auto border-r border-[var(--line)] bg-white p-4 lg:relative lg:inset-auto lg:z-auto lg:block lg:w-auto`}>
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--ink)]">Scenes</h2>
            <button type="button" className="button-compact" onClick={() => setScenesOpen(false)}>
              Close
            </button>
          </div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            Project name
            <input
              value={project?.name || ""}
              onChange={(event) => updateProjectName(event.target.value)}
              className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-sm font-semibold normal-case tracking-normal text-[var(--ink)] shadow-inner"
            />
          </label>

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--ink)]">Scenes</h2>
              <span className="text-xs font-semibold text-[var(--muted)]">{project?.scenes.length || 0}</span>
            </div>

            <div className="space-y-2">
              {project?.scenes.map((scene) => (
                <div
                  key={scene.id}
                  className={
                    scene.id === selectedScene?.id
                      ? "rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-2"
                      : "rounded-lg border border-[var(--line)] bg-white p-2"
                  }
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <button
                      type="button"
                      className="focus-ring min-w-0 rounded-md text-left"
                      onClick={() => {
                        setSelectedSceneId(scene.id);
                        setScenesOpen(false);
                      }}
                    >
                      <span className="block truncate text-sm font-black text-[var(--ink)]">{scene.name}</span>
                      <span className="mt-1 block truncate text-[11px] text-[var(--muted)]">
                        {scene.id === project.activeSceneId ? "Active" : scene.modelPathname || "No GLB"}
                      </span>
                    </button>
                    <span className={scene.id === project.activeSceneId ? "rounded-full bg-[var(--ink)] px-2 py-1 text-[10px] font-black text-white" : "rounded-full border border-[var(--line)] px-2 py-1 text-[10px] font-black text-[var(--muted)]"}>
                      {scene.id === project.activeSceneId ? "ON" : "Scene"}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className={scene.id === project.activeSceneId ? "button-compact-primary flex-1" : "button-compact flex-1"}
                      disabled={working || scene.id === project.activeSceneId}
                      onClick={() => setActiveScene(scene.id)}
                    >
                      {scene.id === project.activeSceneId ? "Active" : "Set active"}
                    </button>
                    <button
                      type="button"
                      className="button-compact-danger"
                      disabled={working}
                      onClick={() => deleteScene(scene.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}

              {project && project.scenes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--soft)] p-3 text-sm leading-6 text-[var(--muted)]">
                  No scenes yet. Add a GLB scene below.
                </div>
              ) : null}
            </div>
          </section>

          <form onSubmit={createScene} className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--soft)] p-3">
            <h3 className="text-sm font-black text-[var(--ink)]">Add scene</h3>
            <input
              value={newSceneName}
              onChange={(event) => setNewSceneName(event.target.value)}
              className="focus-ring mt-3 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
              placeholder="Scene name"
            />
            <input
              type="file"
              accept=".glb,model/gltf-binary,application/octet-stream"
              onChange={(event) => setNewSceneFile(event.target.files?.[0] || null)}
              className="focus-ring mt-3 w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-3 py-3 text-xs text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
            />
            <button
              type="submit"
              disabled={working || !password || !newSceneFile}
              className="focus-ring mt-3 w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
            >
              {uploadStage === "uploading" ? `Uploading ${uploadProgress}%` : "Upload and add scene"}
            </button>
          </form>

        </aside>

        <section className="relative flex h-full min-w-0 flex-col">
          <div className={`pointer-events-none absolute left-3 z-20 flex max-w-[calc(100%-7rem)] flex-wrap items-center gap-2 ${error && !selectedScene ? "top-14" : "top-3"}`}>
            <div className="pointer-events-auto flex rounded-md border border-[var(--line)] bg-white/90 p-1 shadow-sm backdrop-blur">
              {(["translate", "rotate", "scale"] as TransformMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  title={`Transform mode: ${mode}`}
                  className={
                    transformMode === mode
                      ? "rounded bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white"
                      : "rounded px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--soft)]"
                  }
                  onClick={() => setTransformMode(mode)}
                >
                  {mode === "translate" ? "Move" : mode === "rotate" ? "Rotate" : "Scale"}
                </button>
              ))}
            </div>
            {metrics ? (
              <p className="pointer-events-auto rounded-md border border-[var(--line)] bg-white/90 px-3 py-1.5 text-xs font-semibold text-[var(--muted)] shadow-sm backdrop-blur">
                Model {formatNumber(metrics.modelWidthM)}m x {formatNumber(metrics.modelDepthM)}m - scale {formatNumber(metrics.displayedScale)}
              </p>
            ) : null}
          </div>
          {error && !selectedScene ? (
            <p className="border-b border-[var(--line)] bg-[var(--soft)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">
              {error}
            </p>
          ) : null}
          <SceneThreeViewport
            key={`${selectedScene?.id || "empty"}-${selectedScene?.modelUrl || "none"}`}
            scene={selectedScene}
            marker={project?.marker || defaultMarkerForRender()}
            editable
            transformMode={transformMode}
            className="flex-1"
            onSceneChange={handleSceneTransformChange}
            onMetricsChange={handleMetricsChange}
            onStatusChange={handleViewportStatus}
          />
        </section>

        {selectedScene && project && inspectorOpen ? (
          <button
            type="button"
            aria-label="Close inspector"
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            onClick={() => setInspectorOpen(false)}
          />
        ) : null}
        {selectedScene && project ? (
          <aside className={`${inspectorOpen ? "fixed inset-x-0 bottom-0 z-30 max-h-[82vh]" : "hidden"} overflow-y-auto rounded-t-2xl border-l border-[var(--line)] bg-white p-4 shadow-2xl lg:relative lg:inset-auto lg:z-auto lg:block lg:max-h-none lg:rounded-none lg:shadow-none`}>
            <div className="mb-4 flex items-center justify-between lg:hidden">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--ink)]">Inspector</h2>
              <button type="button" className="button-compact" onClick={() => setInspectorOpen(false)}>
                Close
              </button>
            </div>
            <SceneInspector
              busy={working}
              project={project}
              scene={selectedScene}
              metrics={metrics}
              replaceFile={replaceFile}
              uploadProgress={uploadProgress}
              uploadStage={uploadStage}
              onReplaceFile={setReplaceFile}
              onReplaceModel={replaceSceneModel}
              onSetActive={() => setActiveScene(selectedScene.id)}
              onDelete={() => deleteScene(selectedScene.id)}
              onSave={() => saveProject(project, "Scene saved.")}
              onSceneNameChange={(name) => updateScene(selectedScene.id, (scene) => ({ ...scene, name }))}
              onNormalizedScaleChange={(value) => updateSceneNumber(selectedScene.id, "normalizedScale", value)}
              onPositionChange={(axis, value) => updatePlacementNumber(selectedScene.id, "position", axis, value)}
              onRotationChange={(axis, value) => updatePlacementNumber(selectedScene.id, "rotation", axis, value)}
              onReset={() => resetScene(selectedScene.id)}
              onCenter={() => centerScene(selectedScene.id)}
              onFit={() => updateScene(selectedScene.id, fitModelToMarker)}
              onRotate={(axis) => rotateScene(selectedScene.id, axis)}
            />

            {error ? (
              <p className="mt-4 rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-3 text-sm font-semibold text-[var(--ink)]">
                {error}
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>
      {project && markerOpen ? (
        <MarkerModal
          project={project}
          saveState={saveState}
          busy={working}
          onApply={() => saveMarkerSettings(true)}
        />
      ) : null}
    </main>
  );
}

function MarkerModal({
  project,
  saveState,
  busy,
  onApply
}: {
  project: ProjectMetadata;
  saveState: SaveState;
  busy: boolean;
  onApply: () => void;
}) {
  const marker = project.marker;
  const markerSaveLabel = {
    saved: "Saved",
    dirty: "Unsaved",
    saving: "Saving...",
    error: "Save error"
  }[saveState];
  const svgHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    buildMarkerSvg(project.name, marker)
  )}`;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-3">
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-4 shadow-2xl md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Marker settings</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{markerSaveLabel} - {project.name}</p>
          </div>
          <button type="button" className="button-compact-primary" disabled={busy} onClick={onApply}>
            Apply changes
          </button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-h-[26rem] place-items-center rounded-lg border border-[var(--line)] bg-white p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={HIRO_MARKER_IMAGE_URL} alt="HIRO marker" className="aspect-square w-full max-w-md object-contain" />
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-[var(--line)] bg-[var(--soft)] p-3 text-sm font-semibold text-[var(--ink)]">
              Fixed baseline: one 200mm x 200mm HIRO marker. This is the same marker shown in the 3D playground and tracked on mobile.
            </div>
            <a className="button-compact-primary w-full justify-center" href={svgHref} download={`${safeFileName(project.name)}-marker.svg`}>
              Download Marker
            </a>
          </aside>
        </div>
      </section>
    </div>
  );
}

function SceneInspector({
  busy,
  project,
  scene,
  metrics,
  replaceFile,
  uploadProgress,
  uploadStage,
  onReplaceFile,
  onReplaceModel,
  onSetActive,
  onDelete,
  onSave,
  onSceneNameChange,
  onNormalizedScaleChange,
  onPositionChange,
  onRotationChange,
  onReset,
  onCenter,
  onFit,
  onRotate
}: {
  busy: boolean;
  project: ProjectMetadata;
  scene: SceneMetadata;
  metrics: SceneScaleMetrics | null;
  replaceFile: File | null;
  uploadProgress: number;
  uploadStage: UploadStage;
  onReplaceFile: (file: File | null) => void;
  onReplaceModel: (event: FormEvent) => void;
  onSetActive: () => void;
  onDelete: () => void;
  onSave: () => void;
  onSceneNameChange: (name: string) => void;
  onNormalizedScaleChange: (value: string) => void;
  onPositionChange: (axis: "x" | "y" | "z", value: string) => void;
  onRotationChange: (axis: "x" | "y" | "z", value: string) => void;
  onReset: () => void;
  onCenter: () => void;
  onFit: () => void;
  onRotate: (axis: "x" | "y" | "z") => void;
}) {
  return (
    <div className="space-y-3">
      <section>
        <p className="text-xs font-semibold uppercase text-[var(--muted)]">Scene inspector</p>
        <h2 className="mt-1 truncate text-base font-semibold text-[var(--ink)]">{scene.name}</h2>
      </section>

      <details className="rounded-lg border border-[var(--line)] bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
          Scene settings
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-[var(--ink)]">
            Scene name
            <input
              value={scene.name}
              onChange={(event) => onSceneNameChange(event.target.value)}
              className="focus-ring mt-1.5 h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-sm text-[var(--ink)] shadow-inner"
            />
          </label>

          <div>
            <p className="text-xs font-semibold uppercase text-[var(--muted)]">Model path</p>
            <p className="mt-1.5 break-all rounded-md border border-[var(--line)] bg-[var(--soft)] p-2 text-xs leading-5 text-[var(--muted)]">
              {scene.modelPathname || "No model uploaded for this scene."}
            </p>
          </div>

          <form onSubmit={onReplaceModel}>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              {scene.modelUrl ? "Replace GLB" : "Upload GLB"}
            </h3>
            <input
              type="file"
              accept=".glb,model/gltf-binary,application/octet-stream"
              onChange={(event) => onReplaceFile(event.target.files?.[0] || null)}
              className="focus-ring mt-2 w-full rounded-md border border-dashed border-[var(--line)] bg-white px-2.5 py-2 text-xs text-[var(--ink)] file:mr-2 file:rounded file:border-0 file:bg-[var(--ink)] file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <button
              type="submit"
              disabled={busy || !replaceFile}
              className="button-compact-primary mt-2 w-full"
            >
              {uploadStage === "uploading" ? `Uploading ${uploadProgress}%` : "Upload GLB"}
            </button>
          </form>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={scene.id === project.activeSceneId ? "button-compact-primary" : "button-compact"}
              disabled={busy || scene.id === project.activeSceneId}
              onClick={onSetActive}
            >
              {scene.id === project.activeSceneId ? "Active" : "Set active"}
            </button>
            <button type="button" className="button-compact-danger" disabled={busy} onClick={onDelete}>
              Delete scene
            </button>
          </div>
        </div>
      </details>

      <section className="rounded-lg border border-[var(--line)] bg-white p-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Position (mm)</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              axis={axis}
              value={scene.placement.position[axis]}
              onChange={(value) => onPositionChange(axis, value)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-white p-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Rotation (degrees)</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              axis={axis}
              value={scene.placement.rotation[axis]}
              onChange={(value) => onRotationChange(axis, value)}
            />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <button key={axis} type="button" className="button-compact" onClick={() => onRotate(axis)}>
              +90 {axis.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-white p-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Scale on marker</h3>
        <div className="mt-3">
          <NumberField
            label="Relative scale"
            value={scene.normalizedScale}
            onChange={onNormalizedScaleChange}
          />
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={scene.normalizedScale}
            onChange={(event) => onNormalizedScaleChange(event.target.value)}
            className="mt-3 w-full accent-[var(--accent)]"
          />
          <p className="mt-2 text-xs font-semibold text-[var(--muted)]">1 = fitted to the 200mm HIRO marker.</p>
        </div>
        {metrics ? (
          <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--soft)] p-2 text-xs font-bold text-[var(--muted)]">
            Displayed: {formatNumber(metrics.modelWidthM * metrics.displayedScale)}m x {formatNumber(metrics.modelDepthM * metrics.displayedScale)}m
          </p>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          The desktop preview and phone AR both use this same marker-relative scale.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button type="button" className="button-compact" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="button-compact" onClick={onCenter}>
          Center
        </button>
        <button type="button" className="button-compact" onClick={onFit}>
          Fit marker
        </button>
        <button
          type="button"
          disabled={busy}
          className="button-compact-primary"
          onClick={onSave}
        >
          Save scene
        </button>
      </section>
    </div>
  );
}

async function uploadGlb(
  file: File,
  password: string,
  onProgress: (progress: number) => void
) {
  if (!file.name.toLowerCase().endsWith(".glb")) {
    throw new Error("Only .glb files are allowed.");
  }

  if (file.size > MAX_GLB_SIZE_BYTES) {
    throw new Error("Choose a GLB file that is 500 MB or smaller.");
  }

  const pathname = `models/${crypto.randomUUID()}.glb`;
  const multipart = file.size >= MULTIPART_THRESHOLD_BYTES;
  const clientPayload = JSON.stringify({ password });

  try {
    return await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/blob/upload",
      clientPayload,
      multipart,
      contentType: getGlbContentType(file.type),
      onUploadProgress: (event: UploadProgress) => {
        if (typeof event.percentage === "number") {
          onProgress(Math.round(event.percentage));
          return;
        }

        if (event.loaded && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      }
    });
  } catch (uploadError) {
    throw await resolveBlobUploadError(uploadError, pathname, clientPayload, multipart);
  }
}

async function resolveBlobUploadError(
  uploadError: unknown,
  pathname: string,
  clientPayload: string,
  multipart: boolean
) {
  const originalMessage =
    uploadError instanceof Error ? uploadError.message : "Unable to upload this GLB file.";

  if (!originalMessage.toLowerCase().includes("client token")) {
    return uploadError instanceof Error ? uploadError : new Error(originalMessage);
  }

  try {
    const response = await fetch("/api/blob/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          pathname,
          multipart,
          clientPayload
        }
      })
    });
    const result = await readJson<UploadRouteResponse>(response);

    if (!response.ok && result?.error) {
      return new Error(result.error);
    }
  } catch {
    return new Error(originalMessage);
  }

  return new Error(originalMessage);
}

function updateSceneInProject(
  project: ProjectMetadata,
  sceneId: string,
  updater: (scene: SceneMetadata) => SceneMetadata
) {
  return {
    ...project,
    scenes: project.scenes.map((scene) => (scene.id === sceneId ? updater(scene) : scene))
  };
}

async function readJson<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function NumberField({
  label,
  axis,
  value,
  onChange
}: {
  label: string;
  axis?: AppAxis;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-2 block text-xs font-semibold uppercase text-[var(--muted)]">
      <span style={axis ? { color: APP_AXIS_COLORS[axis] } : undefined}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={formatNumber(value)}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-1.5 h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-sm font-medium text-[var(--ink)] shadow-inner"
      />
    </label>
  );
}

function buildMarkerSvg(projectName: string, marker: MarkerSettings) {
  const geometry = getMarkerBoardGeometry(marker);
  const width = geometry.widthMm;
  const height = geometry.heightMm;
  void projectName;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <image href="${escapeXml(HIRO_MARKER_IMAGE_URL)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

function safeFileName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "marker";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function defaultMarkerForRender() {
  return createDefaultMarker();
}

function parseDecimal(value: string, fallback: number) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveDecimal(value: string, fallback: number) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(roundForStorage(value));
}

function getGlbContentType(fileType: string) {
  if (fileType === "model/gltf-binary" || fileType === "application/octet-stream") {
    return fileType;
  }

  return "model/gltf-binary";
}
