"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { SceneThreeViewport, type TransformMode } from "@/components/SceneThreeViewport";
import { createDefaultPlacement } from "@/lib/placement";
import { fitModelToMarker, roundForStorage, type SceneScaleMetrics } from "@/lib/scene-transform";
import type { ProjectMetadata, ScaleMode, SceneMetadata } from "@/lib/projects";

type UploadProgress = {
  loaded?: number;
  total?: number;
  percentage?: number;
};

type UploadStage = "idle" | "uploading" | "saving";

type UploadRouteResponse = {
  error?: string;
};

const MAX_GLB_SIZE_BYTES = 500 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
const SCALE_PRESETS = [50, 100, 200, 500, 1000];

export function ProjectWorkspaceClient({ projectId }: { projectId: string }) {
  const [password, setPassword] = useState(() =>
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
  const [status, setStatus] = useState("Loading project...");
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

  const handleViewportStatus = useCallback((nextStatus: string) => {
    setStatus(nextStatus);
  }, []);

  const handleMetricsChange = useCallback((nextMetrics: SceneScaleMetrics | null) => {
    setMetrics(nextMetrics);
  }, []);

  const handleSceneTransformChange = useCallback((nextScene: SceneMetadata) => {
    updateScene(nextScene.id, () => nextScene);
  }, []);

  async function saveProject(nextProject = project, nextStatus = "Project saved.") {
    if (!nextProject) return null;

    setBusy(true);
    setError("");
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
      setStatus(nextStatus);
      return result.project;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save project.");
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

    setQrOpen(true);
    setQrDataUrl("");
    setError("");

    try {
      setQrDataUrl(await QRCode.toDataURL(project.arUrl, { margin: 1, width: 240 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate QR code.");
    }
  }

  async function removeScene(sceneId: string) {
    if (!project) return;

    const scene = project.scenes.find((item) => item.id === sceneId);
    if (!scene) return;

    const confirmed = window.confirm(
      `Remove "${scene.name}" from this project JSON? The GLB file in Vercel Blob will not be deleted.`
    );
    if (!confirmed) return;

    const scenes = project.scenes.filter((item) => item.id !== sceneId);
    const activeSceneId =
      project.activeSceneId === sceneId ? scenes[0]?.id || "" : project.activeSceneId;
    const updatedProject = {
      ...project,
      scenes,
      activeSceneId
    };

    setProject(updatedProject);
    setSelectedSceneId(activeSceneId || scenes[0]?.id || "");
    await saveProject(updatedProject, "Scene removed. GLB file remains in Blob.");
  }

  function updateProjectName(name: string) {
    setProject((current) => (current ? { ...current, name } : current));
  }

  function updateScene(sceneId: string, updater: (scene: SceneMetadata) => SceneMetadata) {
    setProject((current) => (current ? updateSceneInProject(current, sceneId, updater) : current));
  }

  function updateSceneNumber(
    sceneId: string,
    field: "normalizedScale" | "architecturalScale",
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
        position: { ...scene.placement.position, x: 0, z: 0 }
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

  function setScaleMode(sceneId: string, scaleMode: ScaleMode) {
    updateScene(sceneId, (scene) => ({
      ...scene,
      scaleMode
    }));
  }

  return (
    <main className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-[var(--line)] bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link className="button-secondary shrink-0" href="/admin/dashboard">
            Back to dashboard
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black text-[var(--ink)]">
              {project?.name || projectId}
            </h1>
            <p className="truncate text-xs font-semibold text-[var(--muted)]">{status}</p>
          </div>
        </div>

        {project ? (
          <div className="relative flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Link className="button-secondary" href={project.markerUrl}>
              Print / Export Marker
            </Link>
            <button type="button" className="button-secondary" onClick={toggleQr}>
              QR
            </button>
            <CopyButton value={project.arUrl} label="Copy AR link" />
            <CopyButton value={project.viewUrl} label="Copy Viewer link" />
            {qrOpen ? (
              <div className="absolute right-0 top-14 z-20 w-72 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt={`QR code for ${project.name}`} className="mx-auto w-44 rounded-md border border-[var(--line)] bg-white p-2" />
                ) : (
                  <p className="text-sm font-semibold text-[var(--muted)]">Generating QR...</p>
                )}
                <p className="mt-3 break-all text-xs font-semibold text-[var(--muted)]">{project.arUrl}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className={selectedScene ? "grid h-[calc(100vh-4rem)] grid-cols-[300px_minmax(0,1fr)_360px]" : "grid h-[calc(100vh-4rem)] grid-cols-[300px_minmax(0,1fr)]"}>
        <aside className="overflow-y-auto border-r border-[var(--line)] bg-white p-4">
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            Project name
            <input
              value={project?.name || ""}
              onChange={(event) => updateProjectName(event.target.value)}
              className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-sm font-semibold normal-case tracking-normal text-[var(--ink)] shadow-inner"
            />
          </label>

          <label className="mt-4 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            Admin password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-sm font-semibold normal-case tracking-normal text-[var(--ink)] shadow-inner"
              autoComplete="current-password"
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
                      ? "rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-3"
                      : "rounded-lg border border-[var(--line)] bg-white p-3"
                  }
                >
                  <button
                    type="button"
                    className="focus-ring w-full rounded-md text-left"
                    onClick={() => setSelectedSceneId(scene.id)}
                  >
                    <span className="block truncate text-sm font-black text-[var(--ink)]">{scene.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                      {scene.id === project.activeSceneId ? "Active scene" : scene.modelPathname || "No GLB"}
                    </span>
                  </button>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className={scene.id === project.activeSceneId ? "focus-ring flex-1 rounded-lg bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white" : "button-secondary flex-1 px-3 py-2 text-xs"}
                      disabled={working || scene.id === project.activeSceneId}
                      onClick={() => setActiveScene(scene.id)}
                    >
                      {scene.id === project.activeSceneId ? "Active" : "Set active"}
                    </button>
                    <button
                      type="button"
                      className="button-secondary px-3 py-2 text-xs"
                      disabled={working}
                      onClick={() => removeScene(scene.id)}
                    >
                      Remove
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

          <button
            type="button"
            disabled={working || !project}
            className="focus-ring mt-4 w-full rounded-lg bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
            onClick={() => saveProject(project, "Project saved.")}
          >
            Save project
          </button>
        </aside>

        <section className="flex min-w-0 flex-col">
          <div className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-white px-4">
            <div className="flex rounded-lg border border-[var(--line)] bg-[var(--soft)] p-1">
              {(["translate", "rotate"] as TransformMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={
                    transformMode === mode
                      ? "rounded-md bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white"
                      : "rounded-md px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-white"
                  }
                  onClick={() => setTransformMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            {metrics ? (
              <p className="text-sm font-semibold text-[var(--muted)]">
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

        {selectedScene && project ? (
          <aside className="overflow-y-auto border-l border-[var(--line)] bg-white p-4">
            <SceneInspector
              busy={working}
              project={project}
              scene={selectedScene}
              replaceFile={replaceFile}
              uploadProgress={uploadProgress}
              uploadStage={uploadStage}
              onReplaceFile={setReplaceFile}
              onReplaceModel={replaceSceneModel}
              onSetActive={() => setActiveScene(selectedScene.id)}
              onSave={() => saveProject(project, "Scene saved.")}
              onSceneNameChange={(name) => updateScene(selectedScene.id, (scene) => ({ ...scene, name }))}
              onScaleModeChange={(scaleMode) => setScaleMode(selectedScene.id, scaleMode)}
              onNormalizedScaleChange={(value) => updateSceneNumber(selectedScene.id, "normalizedScale", value)}
              onArchitecturalScaleChange={(value) => updateSceneNumber(selectedScene.id, "architecturalScale", value)}
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
    </main>
  );
}

function SceneInspector({
  busy,
  project,
  scene,
  replaceFile,
  uploadProgress,
  uploadStage,
  onReplaceFile,
  onReplaceModel,
  onSetActive,
  onSave,
  onSceneNameChange,
  onScaleModeChange,
  onNormalizedScaleChange,
  onArchitecturalScaleChange,
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
  replaceFile: File | null;
  uploadProgress: number;
  uploadStage: UploadStage;
  onReplaceFile: (file: File | null) => void;
  onReplaceModel: (event: FormEvent) => void;
  onSetActive: () => void;
  onSave: () => void;
  onSceneNameChange: (name: string) => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  onNormalizedScaleChange: (value: string) => void;
  onArchitecturalScaleChange: (value: string) => void;
  onPositionChange: (axis: "x" | "y" | "z", value: string) => void;
  onRotationChange: (axis: "x" | "y" | "z", value: string) => void;
  onReset: () => void;
  onCenter: () => void;
  onFit: () => void;
  onRotate: (axis: "x" | "y" | "z") => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Scene inspector</p>
            <h2 className="mt-1 text-xl font-black text-[var(--ink)]">{scene.name}</h2>
          </div>
          <button
            type="button"
            className={scene.id === project.activeSceneId ? "focus-ring rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white" : "button-secondary"}
            disabled={busy || scene.id === project.activeSceneId}
            onClick={onSetActive}
          >
            {scene.id === project.activeSceneId ? "Active" : "Set active"}
          </button>
        </div>

        <label className="mt-4 block text-sm font-semibold text-[var(--ink)]">
          Scene name
          <input
            value={scene.name}
            onChange={(event) => onSceneNameChange(event.target.value)}
            className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)] shadow-inner"
          />
        </label>
      </section>

      <form onSubmit={onReplaceModel} className="rounded-xl border border-[var(--line)] bg-[var(--soft)] p-3">
        <h3 className="text-sm font-black text-[var(--ink)]">
          {scene.modelUrl ? "Replace GLB" : "Upload GLB"}
        </h3>
        <p className="mt-2 break-all text-xs leading-5 text-[var(--muted)]">
          {scene.modelPathname || "No model uploaded for this scene."}
        </p>
        <input
          type="file"
          accept=".glb,model/gltf-binary,application/octet-stream"
          onChange={(event) => onReplaceFile(event.target.files?.[0] || null)}
          className="focus-ring mt-3 w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-3 py-3 text-xs text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
        />
        <button
          type="submit"
          disabled={busy || !replaceFile}
          className="focus-ring mt-3 w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
        >
          {uploadStage === "uploading" ? `Uploading ${uploadProgress}%` : "Upload GLB"}
        </button>
      </form>

      <section className="rounded-xl border border-[var(--line)] p-3">
        <h3 className="text-sm font-black text-[var(--ink)]">Position (mm)</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              value={scene.placement.position[axis]}
              onChange={(value) => onPositionChange(axis, value)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] p-3">
        <h3 className="text-sm font-black text-[var(--ink)]">Rotation (degrees)</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              value={scene.placement.rotation[axis]}
              onChange={(value) => onRotationChange(axis, value)}
            />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <button key={axis} type="button" className="button-secondary px-2" onClick={() => onRotate(axis)}>
              +90 {axis.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] p-3">
        <h3 className="text-sm font-black text-[var(--ink)]">Scale</h3>
        <label className="mt-3 block text-sm font-semibold text-[var(--ink)]">
          Scale mode
          <select
            value={scene.scaleMode}
            onChange={(event) => onScaleModeChange(event.target.value as ScaleMode)}
            className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)]"
          >
            <option value="fit">Fit to playground</option>
            <option value="architectural">Architectural scale</option>
          </select>
        </label>
        {scene.scaleMode === "fit" ? (
          <NumberField
            label="Normalized fit scale"
            value={scene.normalizedScale}
            onChange={onNormalizedScaleChange}
          />
        ) : (
          <>
            <label className="mt-3 block text-sm font-semibold text-[var(--ink)]">
              Architectural preset
              <select
                value={SCALE_PRESETS.includes(scene.architecturalScale) ? String(scene.architecturalScale) : "custom"}
                onChange={(event) => {
                  if (event.target.value !== "custom") onArchitecturalScaleChange(event.target.value);
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
            <NumberField
              label="Custom architectural scale"
              value={scene.architecturalScale}
              onChange={onArchitecturalScaleChange}
            />
          </>
        )}
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          Fit mode computes scale from the GLB X/Z footprint and marker size. Architectural
          mode treats GLB units as meters and displays them at the selected drawing scale.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <button type="button" className="button-secondary" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="button-secondary" onClick={onCenter}>
          Center
        </button>
        <button type="button" className="button-secondary" onClick={onFit}>
          Fit playground
        </button>
        <button
          type="button"
          disabled={busy}
          className="focus-ring rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
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
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-3 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={formatNumber(value)}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)] shadow-inner"
      />
    </label>
  );
}

function defaultMarkerForRender() {
  return {
    styleId: "technical-grid",
    imageUrl: "/markers/playground.png",
    patternUrl: "/markers/playground.patt",
    widthMm: 1000,
    heightMm: 700,
    coordinateSystem: {
      origin: "center of marker/playground",
      xAxis: "left/right on marker",
      yAxis: "vertical height above marker",
      zAxis: "forward/back on marker",
      units: "meters" as const
    }
  };
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
