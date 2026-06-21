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
            alt="Single masterplan image target"
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
          Active marker: {project.target.markerSheet?.markers[0]?.id || "Masterplan"}.
        </p>
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
