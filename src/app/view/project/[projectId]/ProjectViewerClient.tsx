"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SceneThreeViewport } from "@/components/SceneThreeViewport";
import type { ProjectMetadata } from "@/lib/projects";
import type { SceneScaleMetrics } from "@/lib/scene-transform";

export function ProjectViewerClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [status, setStatus] = useState("Loading project...");
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<SceneScaleMetrics | null>(null);

  const activeScene = useMemo(() => {
    if (!project) return null;
    return (
      project.scenes.find((scene) => scene.id === project.activeSceneId) ||
      project.scenes[0] ||
      null
    );
  }, [project]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (cancelled) return;

      if (!response.ok || !result.project) {
        setError(result.error || "Project not found.");
        setStatus("Project not found.");
        return;
      }

      setProject(result.project);
      setStatus("Project loaded.");
    }

    loadProject().catch((caught) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : "Unable to load project.");
      setStatus("Unable to load project.");
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const sceneError = !project
    ? ""
    : !activeScene
      ? "No active scene has been created yet."
      : !activeScene.modelUrl
        ? "The active scene does not have a GLB model yet."
        : "";

  return (
    <main className="h-screen overflow-hidden bg-[var(--ink)] text-[var(--panel)]">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-white/10 bg-black/35 px-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black">{project?.name || "Project viewer"}</h1>
          <p className="truncate text-xs font-semibold text-white/60">{status}</p>
        </div>
        {project ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link className="focus-ring rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--accent-dark)]" href={project.arUrl}>
              Open AR
            </Link>
            <Link className="focus-ring rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15" href={project.markerUrl}>
              Open marker
            </Link>
          </div>
        ) : null}
      </header>

      <div className="grid h-[calc(100vh-4rem)] grid-cols-[minmax(0,1fr)_320px]">
        <SceneThreeViewport
          scene={activeScene}
          marker={project?.marker || defaultMarkerForRender()}
          className="h-full"
          onStatusChange={setStatus}
          onMetricsChange={setMetrics}
        />

        <aside className="overflow-y-auto border-l border-white/10 bg-black/30 p-5">
          {error || sceneError ? (
            <p className="rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-4 text-sm font-semibold text-[var(--ink)]">
              {error || sceneError}
            </p>
          ) : null}

          {project ? (
            <section className="mt-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--soft)]">Read-only project viewer</p>
              <h2 className="mt-3 text-3xl font-black">{activeScene?.name || "No active scene"}</h2>
              <div className="mt-5 grid gap-3 text-sm">
                <Info label="Marker" value={`${project.marker.widthMm} x ${project.marker.heightMm} mm`} />
                <Info label="Scale mode" value={activeScene?.scaleMode || "None"} />
                <Info label="Architectural scale" value={activeScene ? `1:${activeScene.architecturalScale}` : "None"} />
                <Info label="Normalized scale" value={activeScene ? String(activeScene.normalizedScale) : "None"} />
                {metrics ? (
                  <>
                    <Info label="Model footprint" value={`${formatNumber(metrics.modelWidthM)}m x ${formatNumber(metrics.modelDepthM)}m`} />
                    <Info label="Displayed scale" value={formatNumber(metrics.displayedScale)} />
                  </>
                ) : null}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/8 p-3">
      <dt className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-white">{value}</dd>
    </div>
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

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
