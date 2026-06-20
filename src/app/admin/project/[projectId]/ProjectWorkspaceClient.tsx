"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SceneThreeViewport, type TransformMode } from "@/components/SceneThreeViewport";
import { APP_AXIS_COLORS, type AppAxis } from "@/lib/coordinates";
import {
  MODEL_CORRECTION_MODES,
  createDefaultPlacement,
  createDefaultTarget,
  getImageTargetGeometry,
  normalizeDegrees,
  type ImageTargetSettings,
  type ModelCorrectionMode
} from "@/lib/placement";
import { fitModelToTarget, roundForStorage, type SceneScaleMetrics } from "@/lib/scene-transform";
import type { ProjectMetadata, SceneMetadata } from "@/lib/projects";

type UploadProgress = {
  loaded?: number;
  total?: number;
  percentage?: number;
};

type UploadStage = "idle" | "uploading" | "saving";
type SaveState = "saved" | "dirty" | "saving" | "error";
type TechnicalTargetPreset = "A4" | "A3" | "A2" | "A1" | "A0";

type TechnicalTargetOutput = {
  preset: TechnicalTargetPreset;
  widthMm: number;
  heightMm: number;
  svg: string;
  svgDataUrl: string;
  pngDataUrl: string;
  fileBaseName: string;
};

type UploadRouteResponse = {
  error?: string;
};

const MAX_GLB_SIZE_BYTES = 500 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
const TECHNICAL_TARGET_PRESETS: Record<TechnicalTargetPreset, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 297, heightMm: 210 },
  A3: { widthMm: 420, heightMm: 297 },
  A2: { widthMm: 594, heightMm: 420 },
  A1: { widthMm: 841, heightMm: 594 },
  A0: { widthMm: 1189, heightMm: 841 }
};

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
  const [scenesOpen, setScenesOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [status, setStatus] = useState("Loading project...");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [desktopDebugStatus, setDesktopDebugStatus] = useState("");
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
  const saveStateLabel = {
    saved: "Saved",
    dirty: "Unsaved changes",
    saving: "Saving...",
    error: "Save error"
  }[saveState];

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

  const handleSceneTransformChange = useCallback((nextScene: SceneMetadata) => {
    setProject((current) =>
      current ? updateSceneInProject(current, nextScene.id, () => nextScene) : current
    );
    markDirty("Scene has unsaved changes.");
  }, [markDirty]);

  const copyDesktopDebug = useCallback(async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      viewport: viewportDebug(),
      saveState,
      status,
      project: project
        ? {
            id: project.id,
            name: project.name,
            arUrl: project.arUrl,
            activeSceneId: project.activeSceneId,
            target: project.target
          }
        : null,
      selectedScene: selectedScene
        ? {
            id: selectedScene.id,
            name: selectedScene.name,
            modelUrl: selectedScene.modelUrl,
            modelPathname: selectedScene.modelPathname,
            placement: selectedScene.placement,
            normalizedScale: selectedScene.normalizedScale,
            scaleMode: selectedScene.scaleMode
          }
        : null,
      metrics
    };

    try {
      await writeClipboard(JSON.stringify(report, null, 2));
      setDesktopDebugStatus("Desktop debug copied");
    } catch {
      setDesktopDebugStatus("Copy failed");
    }

    window.setTimeout(() => setDesktopDebugStatus(""), 2200);
  }, [metrics, project, saveState, selectedScene, status]);

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
          target: nextProject.target,
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
        scaleMode: "fit",
        normalizedScale: scene.normalizedScale || 1,
        architecturalScale: 100,
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

  function updateProjectName(name: string) {
    setProject((current) => (current ? { ...current, name } : current));
    markDirty("Project name changed.");
  }

  function updateScene(sceneId: string, updater: (scene: SceneMetadata) => SceneMetadata) {
    setProject((current) => (current ? updateSceneInProject(current, sceneId, updater) : current));
    markDirty("Scene has unsaved changes.");
  }

  function updateTarget(updater: (target: ImageTargetSettings) => ImageTargetSettings) {
    setProject((current) =>
      current ? { ...current, target: updater(current.target || createDefaultTarget()) } : current
    );
    markDirty("Target settings changed.");
  }

  function updateTargetWidth(value: string) {
    const parsed = parsePositiveDecimal(value, project?.target.widthMm || createDefaultTarget().widthMm);
    updateTarget((target) => {
      const aspect = getImageTargetGeometry(target).normalizedHeight;
      return {
        ...target,
        widthMm: parsed,
        heightMm: roundForStorage(parsed * aspect)
      };
    });
  }

  function updateTargetHeight(value: string) {
    const parsed = parsePositiveDecimal(value, project?.target.heightMm || createDefaultTarget().heightMm);
    updateTarget((target) => {
      const aspect = getImageTargetGeometry(target).normalizedHeight;
      return {
        ...target,
        widthMm: roundForStorage(parsed / aspect),
        heightMm: parsed
      };
    });
  }

  function updateCorrectionMode(mode: ModelCorrectionMode) {
    updateTarget((target) => ({ ...target, correctionMode: mode }));
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
          [field]:
            group === "rotation"
              ? normalizeDegrees(parseDecimal(value, scene.placement[group][field]))
              : parseDecimal(value, scene.placement[group][field])
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
          [axis]: roundForStorage(normalizeDegrees(scene.placement.rotation[axis] + 90))
        }
      }
    }));
  }

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
                  Scan this after saving. It opens the latest saved mobile AR page.
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
              className="focus-ring mt-2 h-10 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-sm text-[var(--ink)] shadow-inner"
            />
          </label>

          <form onSubmit={createScene} className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--soft)] p-3">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Add GLB scene</h2>
            <input
              value={newSceneName}
              onChange={(event) => setNewSceneName(event.target.value)}
              placeholder="Scene name"
              className="focus-ring mt-3 h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-sm text-[var(--ink)] shadow-inner"
            />
            <input
              type="file"
              accept=".glb,model/gltf-binary,application/octet-stream"
              onChange={(event) => setNewSceneFile(event.target.files?.[0] || null)}
              className="focus-ring mt-3 w-full rounded-md border border-dashed border-[var(--line)] bg-white px-2.5 py-2 text-xs text-[var(--ink)] file:mr-2 file:rounded file:border-0 file:bg-[var(--ink)] file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <button
              type="submit"
              disabled={working || !newSceneFile}
              className="button-compact-primary mt-3 w-full"
            >
              {uploadStage === "uploading" ? `Uploading ${uploadProgress}%` : "Add scene"}
            </button>
          </form>

          <div className="mt-5 space-y-2">
            {project?.scenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                className={`w-full rounded-lg border px-3 py-3 text-left text-sm font-semibold ${
                  scene.id === selectedScene?.id
                    ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                    : "border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--soft)]"
                }`}
                onClick={() => {
                  setSelectedSceneId(scene.id);
                  setScenesOpen(false);
                }}
              >
                <span className="block truncate">{scene.name}</span>
                <span className="mt-1 block truncate text-xs opacity-70">{scene.modelPathname || "No GLB"}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="relative flex min-h-0 flex-col">
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
            <div className="pointer-events-auto flex rounded-md border border-[var(--line)] bg-white/90 p-1 shadow-sm backdrop-blur">
              {(["translate", "rotate", "scale"] as const).map((mode) => (
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
            <button
              type="button"
              className="pointer-events-auto rounded-md border border-[var(--line)] bg-white/90 px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-sm backdrop-blur hover:bg-white"
              onClick={copyDesktopDebug}
            >
              {desktopDebugStatus || "Copy desktop debug"}
            </button>
          </div>
          {error && !selectedScene ? (
            <p className="border-b border-[var(--line)] bg-[var(--soft)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">
              {error}
            </p>
          ) : null}
          <SceneThreeViewport
            key={`${selectedScene?.id || "empty"}-${selectedScene?.modelUrl || "none"}-${project?.target.widthMm || 0}-${project?.target.correctionMode || "NONE"}`}
            scene={selectedScene}
            target={project?.target || createDefaultTarget()}
            editable
            transformMode={transformMode}
            className="flex-1"
            onSceneChange={handleSceneTransformChange}
            onMetricsChange={setMetrics}
            onStatusChange={setStatus}
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
              onTargetWidthChange={updateTargetWidth}
              onTargetHeightChange={updateTargetHeight}
              onCorrectionModeChange={updateCorrectionMode}
              onNormalizedScaleChange={(value) => updateSceneNumber(selectedScene.id, "normalizedScale", value)}
              onPositionChange={(axis, value) => updatePlacementNumber(selectedScene.id, "position", axis, value)}
              onRotationChange={(axis, value) => updatePlacementNumber(selectedScene.id, "rotation", axis, value)}
              onReset={() => resetScene(selectedScene.id)}
              onCenter={() => centerScene(selectedScene.id)}
              onFit={() => updateScene(selectedScene.id, fitModelToTarget)}
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
    </main>
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
  onTargetWidthChange,
  onTargetHeightChange,
  onCorrectionModeChange,
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
  onTargetWidthChange: (value: string) => void;
  onTargetHeightChange: (value: string) => void;
  onCorrectionModeChange: (mode: ModelCorrectionMode) => void;
  onNormalizedScaleChange: (value: string) => void;
  onPositionChange: (axis: "x" | "y" | "z", value: string) => void;
  onRotationChange: (axis: "x" | "y" | "z", value: string) => void;
  onReset: () => void;
  onCenter: () => void;
  onFit: () => void;
  onRotate: (axis: "x" | "y" | "z") => void;
}) {
  const [technicalTargetPreset, setTechnicalTargetPreset] = useState<TechnicalTargetPreset>("A1");
  const [technicalTarget, setTechnicalTarget] = useState<TechnicalTargetOutput | null>(null);
  const [technicalTargetStatus, setTechnicalTargetStatus] = useState("");

  const generateTechnicalTarget = useCallback(async () => {
    setTechnicalTargetStatus("Generating technical target...");

    try {
      const nextTarget = await createTechnicalTarget(project, technicalTargetPreset);
      setTechnicalTarget(nextTarget);
      setTechnicalTargetStatus("Technical target ready.");
    } catch (caught) {
      setTechnicalTarget(null);
      setTechnicalTargetStatus(
        caught instanceof Error ? caught.message : "Unable to generate technical target."
      );
    }
  }, [project, technicalTargetPreset]);

  const modelStats = metrics?.modelStats;
  const modelWarning = modelStats?.warning || "";

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

      {modelWarning ? (
        <section className="rounded-lg border border-[#f3b49b] bg-[#fff7ed] p-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Mobile WebAR performance</h3>
          <p className="mt-2 text-xs font-bold leading-5 text-[#9a3412]">{modelWarning}</p>
          {modelStats ? (
            <p className="mt-2 text-xs font-semibold leading-5 text-[var(--muted)]">
              {formatNumber(modelStats.triangleCount)} triangles, {modelStats.meshCount} meshes,{" "}
              {modelStats.materialCount} materials, {modelStats.textureCount} textures.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--line)] bg-white p-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Image target</h3>
        <div className="mt-3 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--soft)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={project.target.previewUrl || project.target.imageUrl}
            alt="A0 multi-marker tracking sheet"
            className="w-full object-contain"
            style={{
              aspectRatio: `${project.target.pixelWidth || 1189} / ${project.target.pixelHeight || 841}`
            }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberField
            label="Width mm"
            value={project.target.widthMm}
            onChange={onTargetWidthChange}
          />
          <NumberField
            label="Height mm"
            value={project.target.heightMm}
            onChange={onTargetHeightChange}
          />
        </div>
        <label className="mt-3 block text-xs font-semibold uppercase text-[var(--muted)]">
          Model correction
          <select
            value={project.target.correctionMode}
            onChange={(event) => onCorrectionModeChange(event.target.value as ModelCorrectionMode)}
            className="focus-ring mt-1.5 h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-sm font-medium text-[var(--ink)] shadow-inner"
          >
            {MODEL_CORRECTION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <a className="button-compact mt-3 w-full justify-center" href={project.target.imageUrl} download>
          Download target image
        </a>
        <p className="mt-2 text-xs font-semibold leading-5 text-[var(--muted)]">
          Target version: {project.target.targetVersion}. {project.target.pixelWidth} x{" "}
          {project.target.pixelHeight}px, {formatNumber(project.target.widthMm)} x{" "}
          {formatNumber(project.target.heightMm)}mm.
          {project.target.markerSheet ? (
            <>
              {" "}Sheet: {project.target.markerSheet.sheetId}, {project.target.markerSheet.markers.length} markers.
            </>
          ) : null}
        </p>

        <div className="mt-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--soft)] p-3">
          <h4 className="text-sm font-semibold text-[var(--ink)]">Technical MindAR target</h4>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <label className="block text-xs font-semibold uppercase text-[var(--muted)]">
              Print preset
              <select
                value={technicalTargetPreset}
                onChange={(event) =>
                  setTechnicalTargetPreset(event.target.value as TechnicalTargetPreset)
                }
                className="focus-ring mt-1.5 h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-sm font-medium text-[var(--ink)] shadow-inner"
              >
                {Object.keys(TECHNICAL_TARGET_PRESETS).map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button-compact-primary mt-6"
              onClick={generateTechnicalTarget}
            >
              Generate Technical Target
            </button>
          </div>
          <p className="mt-2 text-xs font-semibold leading-5 text-[var(--muted)]">
            Export this high-contrast image, then generate or replace the project `.mind` target from it.
          </p>
          {technicalTargetStatus ? (
            <p className="mt-2 text-xs font-bold text-[var(--muted)]">{technicalTargetStatus}</p>
          ) : null}
          {technicalTarget ? (
            <div className="mt-3 space-y-3">
              <div className="overflow-hidden rounded-md border border-[var(--line)] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={technicalTarget.svgDataUrl}
                  alt={`${technicalTarget.preset} technical MindAR target`}
                  className="w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  className="button-compact justify-center"
                  href={technicalTarget.pngDataUrl}
                  download={`${technicalTarget.fileBaseName}.png`}
                >
                  Download PNG
                </a>
                <a
                  className="button-compact justify-center"
                  href={technicalTarget.svgDataUrl}
                  download={`${technicalTarget.fileBaseName}.svg`}
                >
                  Download SVG
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </section>

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
        <h3 className="text-sm font-semibold text-[var(--ink)]">Scale on target</h3>
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
          <p className="mt-2 text-xs font-semibold text-[var(--muted)]">
            1 = fitted to the marker-frame masterplan image target.
          </p>
        </div>
        {metrics ? (
          <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--soft)] p-2 text-xs font-bold text-[var(--muted)]">
            Displayed: {formatNumber(metrics.modelWidthM * metrics.displayedScale)}m x {formatNumber(metrics.modelDepthM * metrics.displayedScale)}m
          </p>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button type="button" className="button-compact" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="button-compact" onClick={onCenter}>
          Center
        </button>
        <button type="button" className="button-compact" onClick={onFit}>
          Fit target
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

async function createTechnicalTarget(
  project: ProjectMetadata,
  presetKey: TechnicalTargetPreset
): Promise<TechnicalTargetOutput> {
  const preset = TECHNICAL_TARGET_PRESETS[presetKey];
  const qrDataUrl = await QRCode.toDataURL(project.arUrl, {
    margin: 1,
    width: 900,
    errorCorrectionLevel: "H",
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  });
  const svg = buildTechnicalTargetSvg({
    project,
    preset: presetKey,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    qrDataUrl
  });
  const svgDataUrl = svgToDataUrl(svg);
  const pngDataUrl = await renderSvgToPng(svg, preset.widthMm, preset.heightMm);
  const fileBaseName = `${slugForFile(project.id)}-${presetKey.toLowerCase()}-technical-target`;

  return {
    preset: presetKey,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    svg,
    svgDataUrl,
    pngDataUrl,
    fileBaseName
  };
}

function buildTechnicalTargetSvg({
  project,
  preset,
  widthMm,
  heightMm,
  qrDataUrl
}: {
  project: ProjectMetadata;
  preset: TechnicalTargetPreset;
  widthMm: number;
  heightMm: number;
  qrDataUrl: string;
}) {
  const shortSide = Math.min(widthMm, heightMm);
  const margin = roundSvg(shortSide * 0.025);
  const border = roundSvg(Math.max(4, shortSide * 0.012));
  const sideBand = roundSvg(Math.max(18, shortSide * 0.09));
  const labelHeight = roundSvg(Math.max(14, shortSide * 0.055));
  const innerX = margin + border;
  const innerY = margin + border;
  const innerWidth = widthMm - innerX * 2;
  const innerHeight = heightMm - innerY * 2;
  const fieldX = innerX + sideBand;
  const fieldY = innerY + labelHeight;
  const fieldWidth = innerWidth - sideBand * 2;
  const fieldHeight = innerHeight - labelHeight * 2;
  const qrSize = roundSvg(Math.min(Math.max(shortSide * 0.18, 34), 78));
  const qrX = roundSvg(widthMm - innerX - qrSize - 5);
  const qrY = roundSvg(heightMm - innerY - qrSize - 5);
  const projectName = escapeSvgText(project.name || project.id);
  const generatedDate = new Date().toISOString().slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" role="img" aria-label="Technical MindAR image target">
  <rect width="${widthMm}" height="${heightMm}" fill="#ffffff"/>
  <rect x="${margin}" y="${margin}" width="${widthMm - margin * 2}" height="${heightMm - margin * 2}" fill="#ffffff" stroke="#000000" stroke-width="${border}"/>
  <rect x="${innerX}" y="${innerY}" width="${innerWidth}" height="${innerHeight}" fill="none" stroke="#000000" stroke-width="1.2"/>
  <line x1="${innerX}" y1="${innerY}" x2="${widthMm - innerX}" y2="${heightMm - innerY}" stroke="#000000" stroke-width="1.4"/>
  <line x1="${widthMm - innerX}" y1="${innerY}" x2="${innerX}" y2="${heightMm - innerY}" stroke="#000000" stroke-width="0.9"/>
  ${cornerMarkerTopLeft(innerX, innerY, sideBand)}
  ${cornerMarkerTopRight(widthMm - innerX - sideBand, innerY, sideBand)}
  ${cornerMarkerBottomLeft(innerX, heightMm - innerY - sideBand, sideBand)}
  ${cornerMarkerBottomRight(widthMm - innerX - sideBand, heightMm - innerY - sideBand, sideBand)}
  ${topBottomLabels(innerX, innerY, innerWidth, innerHeight, labelHeight, preset)}
  ${sideBands(innerX, innerY, innerWidth, innerHeight, sideBand)}
  ${centralFeatureField(fieldX, fieldY, fieldWidth, fieldHeight, project)}
  <rect x="${qrX - 2}" y="${qrY - 2}" width="${qrSize + 4}" height="${qrSize + 4}" fill="#ffffff" stroke="#000000" stroke-width="1.4"/>
  <image href="${escapeSvgAttribute(qrDataUrl)}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${qrX + qrSize / 2}" y="${qrY - 4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(shortSide * 0.018)}" font-weight="900" fill="#000000">AR QR</text>
  <text x="${innerX}" y="${heightMm - margin - 2}" font-family="Arial, sans-serif" font-size="${roundSvg(shortSide * 0.018)}" font-weight="900" fill="#000000">PROJECT: ${projectName}</text>
  <text x="${widthMm - innerX}" y="${heightMm - margin - 2}" text-anchor="end" font-family="Arial, sans-serif" font-size="${roundSvg(shortSide * 0.016)}" font-weight="700" fill="#000000">TARGET ${preset} - GENERATED ${generatedDate}</text>
</svg>`;
}

function cornerMarkerTopLeft(x: number, y: number, size: number) {
  const mid = roundSvg(size / 2);
  return `<g>
    <rect x="${x + 4}" y="${y + 4}" width="${size - 8}" height="${size - 8}" fill="#000000"/>
    <rect x="${x + 10}" y="${y + 10}" width="${size - 20}" height="${size - 20}" fill="#ffffff"/>
    <circle cx="${x + mid}" cy="${y + mid}" r="${roundSvg(size * 0.16)}" fill="#000000"/>
    <text x="${x + mid}" y="${y + size - 3}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(size * 0.16)}" font-weight="900" fill="#ffffff">TL-01</text>
  </g>`;
}

function cornerMarkerTopRight(x: number, y: number, size: number) {
  const mid = roundSvg(size / 2);
  return `<g>
    <rect x="${x + 4}" y="${y + 4}" width="${size - 8}" height="${size - 8}" fill="#ffffff" stroke="#000000" stroke-width="2"/>
    <line x1="${x + mid}" y1="${y + 6}" x2="${x + mid}" y2="${y + size - 6}" stroke="#000000" stroke-width="3"/>
    <line x1="${x + 6}" y1="${y + mid}" x2="${x + size - 6}" y2="${y + mid}" stroke="#000000" stroke-width="1.7"/>
    <circle cx="${x + mid}" cy="${y + mid}" r="${roundSvg(size * 0.28)}" fill="none" stroke="#000000" stroke-width="2.2"/>
    <text x="${x + mid}" y="${y + size - 3}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(size * 0.16)}" font-weight="900" fill="#000000">TR-19</text>
  </g>`;
}

function cornerMarkerBottomLeft(x: number, y: number, size: number) {
  const inset = roundSvg(size * 0.14);
  return `<g>
    <rect x="${x + 4}" y="${y + 4}" width="${size - 8}" height="${size - 8}" fill="#ffffff" stroke="#000000" stroke-width="2"/>
    <polygon points="${x + inset},${y + size - inset} ${x + size / 2},${y + inset} ${x + size - inset},${y + size - inset}" fill="#000000"/>
    <polygon points="${x + size * 0.28},${y + size * 0.72} ${x + size / 2},${y + size * 0.32} ${x + size * 0.72},${y + size * 0.72}" fill="#ffffff"/>
    <text x="${x + size / 2}" y="${y + size - 3}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(size * 0.16)}" font-weight="900" fill="#000000">BL-37</text>
  </g>`;
}

function cornerMarkerBottomRight(x: number, y: number, size: number) {
  const bars = Array.from({ length: 7 }, (_, index) => {
    const barWidth = index % 2 === 0 ? size * 0.1 : size * 0.18;
    const barX = x + 7 + index * size * 0.115;
    return `<rect x="${roundSvg(barX)}" y="${roundSvg(y + 8)}" width="${roundSvg(barWidth)}" height="${roundSvg(size - 16)}" fill="#000000"/>`;
  }).join("");

  return `<g>
    <rect x="${x + 4}" y="${y + 4}" width="${size - 8}" height="${size - 8}" fill="#ffffff" stroke="#000000" stroke-width="2"/>
    ${bars}
    <line x1="${x + 7}" y1="${y + size * 0.33}" x2="${x + size - 7}" y2="${y + size * 0.77}" stroke="#ffffff" stroke-width="2"/>
    <text x="${x + size / 2}" y="${y + size - 3}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(size * 0.16)}" font-weight="900" fill="#000000">BR-82</text>
  </g>`;
}

function topBottomLabels(
  x: number,
  y: number,
  width: number,
  height: number,
  labelHeight: number,
  preset: TechnicalTargetPreset
) {
  const fontSize = roundSvg(labelHeight * 0.34);
  const tickStep = width / 16;
  const topTicks = Array.from({ length: 17 }, (_, index) => {
    const tickX = roundSvg(x + index * tickStep);
    const tickHeight = index % 4 === 0 ? labelHeight * 0.65 : labelHeight * 0.35;
    return `<line x1="${tickX}" y1="${y}" x2="${tickX}" y2="${roundSvg(y + tickHeight)}" stroke="#000000" stroke-width="${index % 4 === 0 ? 1.4 : 0.8}"/>`;
  }).join("");
  const bottomTicks = Array.from({ length: 13 }, (_, index) => {
    const tickX = roundSvg(x + index * (width / 12));
    return `<text x="${tickX}" y="${roundSvg(y + height - 3)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(fontSize * 0.68)}" font-weight="900" fill="#000000">${String(index).padStart(2, "0")}</text>`;
  }).join("");

  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${labelHeight}" fill="#ffffff"/>
    <rect x="${x}" y="${y + height - labelHeight}" width="${width}" height="${labelHeight}" fill="#ffffff"/>
    ${topTicks}
    ${bottomTicks}
    <text x="${x + width / 2}" y="${roundSvg(y + labelHeight * 0.66)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#000000">TOP - TECHNICAL IMAGE TARGET - ${preset}</text>
    <text x="${x + width / 2}" y="${roundSvg(y + height - labelHeight * 0.28)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(fontSize * 0.8)}" font-weight="900" fill="#000000">BOTTOM - USE FULL PAGE FOR MINDAR IMAGE TARGET GENERATION</text>
    <text x="${roundSvg(x + 4)}" y="${roundSvg(y + labelHeight * 0.65)}" font-family="Arial, sans-serif" font-size="${roundSvg(fontSize * 0.7)}" font-weight="900" fill="#000000">LEFT</text>
    <text x="${roundSvg(x + width - 4)}" y="${roundSvg(y + labelHeight * 0.65)}" text-anchor="end" font-family="Arial, sans-serif" font-size="${roundSvg(fontSize * 0.7)}" font-weight="900" fill="#000000">RIGHT</text>
  </g>`;
}

function sideBands(x: number, y: number, width: number, height: number, sideBand: number) {
  const usableY = y + sideBand;
  const usableHeight = height - sideBand * 2;
  const leftBlocks = Array.from({ length: 15 }, (_, index) => {
    const blockY = usableY + index * (usableHeight / 15);
    const blockHeight = usableHeight / 20 + ((index * 7) % 5);
    const blockWidth = sideBand * (0.28 + ((index * 11) % 7) * 0.055);
    const fill = index % 3 === 0 ? "#000000" : "#ffffff";
    const stroke = fill === "#000000" ? "#000000" : "#000000";
    return `<rect x="${roundSvg(x + 5)}" y="${roundSvg(blockY)}" width="${roundSvg(blockWidth)}" height="${roundSvg(blockHeight)}" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`;
  }).join("");
  const rightBars = Array.from({ length: 18 }, (_, index) => {
    const barY = usableY + index * (usableHeight / 18);
    const barLength = sideBand * (0.45 + ((index * 5) % 6) * 0.07);
    return `<line x1="${roundSvg(x + width - 5)}" y1="${roundSvg(barY)}" x2="${roundSvg(x + width - 5 - barLength)}" y2="${roundSvg(barY + sideBand * 0.35)}" stroke="#000000" stroke-width="${index % 2 === 0 ? 1.8 : 0.9}"/>`;
  }).join("");
  const leftNumbers = Array.from({ length: 8 }, (_, index) => {
    const labelY = usableY + index * (usableHeight / 7);
    return `<text x="${roundSvg(x + sideBand * 0.66)}" y="${roundSvg(labelY)}" font-family="Arial, sans-serif" font-size="${roundSvg(sideBand * 0.16)}" font-weight="900" fill="#000000" transform="rotate(-90 ${roundSvg(x + sideBand * 0.66)} ${roundSvg(labelY)})">L-${index * 13 + 5}</text>`;
  }).join("");

  return `<g>
    <rect x="${x}" y="${y + sideBand}" width="${sideBand}" height="${height - sideBand * 2}" fill="#ffffff" stroke="#000000" stroke-width="0.8"/>
    <rect x="${x + width - sideBand}" y="${y + sideBand}" width="${sideBand}" height="${height - sideBand * 2}" fill="#ffffff" stroke="#000000" stroke-width="0.8"/>
    ${leftBlocks}
    ${rightBars}
    ${leftNumbers}
    <text x="${roundSvg(x + sideBand * 0.5)}" y="${roundSvg(y + height / 2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(sideBand * 0.28)}" font-weight="900" fill="#000000" transform="rotate(-90 ${roundSvg(x + sideBand * 0.5)} ${roundSvg(y + height / 2)})">LEFT EDGE FEATURES</text>
    <text x="${roundSvg(x + width - sideBand * 0.5)}" y="${roundSvg(y + height / 2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(sideBand * 0.24)}" font-weight="900" fill="#000000" transform="rotate(90 ${roundSvg(x + width - sideBand * 0.5)} ${roundSvg(y + height / 2)})">RIGHT ASYMMETRIC EDGE</text>
  </g>`;
}

function centralFeatureField(
  x: number,
  y: number,
  width: number,
  height: number,
  project: ProjectMetadata
) {
  const columnCount = 9;
  const rowCount = 6;
  const grid = Array.from({ length: columnCount * rowCount }, (_, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const cellX = x + column * (width / columnCount);
    const cellY = y + row * (height / rowCount);
    const cellWidth = width / columnCount;
    const cellHeight = height / rowCount;
    const fill = (column * 3 + row * 5) % 4 === 0 ? "#000000" : "#ffffff";
    const accent =
      (column + row) % 3 === 0
        ? `<circle cx="${roundSvg(cellX + cellWidth * 0.72)}" cy="${roundSvg(cellY + cellHeight * 0.34)}" r="${roundSvg(Math.min(cellWidth, cellHeight) * 0.12)}" fill="${fill === "#000000" ? "#ffffff" : "#000000"}"/>`
        : `<line x1="${roundSvg(cellX + cellWidth * 0.18)}" y1="${roundSvg(cellY + cellHeight * 0.78)}" x2="${roundSvg(cellX + cellWidth * 0.82)}" y2="${roundSvg(cellY + cellHeight * 0.18)}" stroke="${fill === "#000000" ? "#ffffff" : "#000000"}" stroke-width="0.8"/>`;
    return `<g>
      <rect x="${roundSvg(cellX)}" y="${roundSvg(cellY)}" width="${roundSvg(cellWidth)}" height="${roundSvg(cellHeight)}" fill="${fill}" stroke="#000000" stroke-width="0.35"/>
      ${accent}
      <text x="${roundSvg(cellX + cellWidth * 0.08)}" y="${roundSvg(cellY + cellHeight * 0.26)}" font-family="Arial, sans-serif" font-size="${roundSvg(Math.min(cellWidth, cellHeight) * 0.16)}" font-weight="900" fill="${fill === "#000000" ? "#ffffff" : "#000000"}">${column}${row}</text>
    </g>`;
  }).join("");
  const diagonals = Array.from({ length: 12 }, (_, index) => {
    const startX = x + (index / 12) * width;
    const endX = x + ((index + 4) / 12) * width;
    return `<line x1="${roundSvg(startX)}" y1="${y}" x2="${roundSvg(endX)}" y2="${roundSvg(y + height)}" stroke="#000000" stroke-width="${index % 2 === 0 ? 0.8 : 0.35}" opacity="0.85"/>`;
  }).join("");
  const targetSize = `${formatNumber(project.target.widthMm)}mm x ${formatNumber(project.target.heightMm)}mm`;

  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff" stroke="#000000" stroke-width="1.4"/>
    ${grid}
    ${diagonals}
    <rect x="${roundSvg(x + width * 0.22)}" y="${roundSvg(y + height * 0.32)}" width="${roundSvg(width * 0.56)}" height="${roundSvg(height * 0.28)}" fill="#ffffff" stroke="#000000" stroke-width="1.8"/>
    <text x="${roundSvg(x + width / 2)}" y="${roundSvg(y + height * 0.43)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(Math.min(width, height) * 0.06)}" font-weight="900" fill="#000000">MASTERPLAN AREA</text>
    <text x="${roundSvg(x + width / 2)}" y="${roundSvg(y + height * 0.52)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(Math.min(width, height) * 0.037)}" font-weight="900" fill="#000000">TARGET SIZE ${escapeSvgText(targetSize)}</text>
    <text x="${roundSvg(x + width / 2)}" y="${roundSvg(y + height * 0.58)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${roundSvg(Math.min(width, height) * 0.032)}" font-weight="700" fill="#000000">NON-REPEATING TECHNICAL FEATURES FOR IMAGE TRACKING</text>
  </g>`;
}

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function renderSvgToPng(svg: string, widthMm: number, heightMm: number) {
  const image = new Image();
  const svgUrl = svgToDataUrl(svg);
  const pxPerMm = 4;
  const maxPixels = 20000000;
  let widthPx = Math.round(widthMm * pxPerMm);
  let heightPx = Math.round(heightMm * pxPerMm);
  const pixelCount = widthPx * heightPx;

  if (pixelCount > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixelCount);
    widthPx = Math.round(widthPx * scale);
    heightPx = Math.round(heightPx * scale);
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to rasterize technical target."));
    image.src = svgUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable for PNG export.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, widthPx, heightPx);
  context.drawImage(image, 0, 0, widthPx, heightPx);
  return canvas.toDataURL("image/png");
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeSvgAttribute(value: string) {
  return escapeSvgText(value).replace(/"/g, "&quot;");
}

function roundSvg(value: number) {
  return Math.round(value * 1000) / 1000;
}

function slugForFile(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
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

function viewportDebug() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    orientation: window.screen.orientation?.type || ""
  };
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function getGlbContentType(fileType: string) {
  if (fileType === "model/gltf-binary" || fileType === "application/octet-stream") {
    return fileType;
  }

  return "model/gltf-binary";
}
