"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState } from "react";
import type { ProjectMetadata } from "@/lib/projects";

export function ViewerClient({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (cancelled) return;

      if (!response.ok || !result.project) {
        setError(result.error || "Model not found.");
        return;
      }

      setProject(result.project);
    }

    load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load model.")
    );

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="min-h-screen bg-[var(--ink)] text-[var(--panel)]">
      <Script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js" />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5">
        <nav className="no-print flex items-center justify-between">
          <Link className="focus-ring rounded-md px-3 py-2 text-sm font-semibold hover:bg-white/10" href="/">
            Home
          </Link>
          {project ? (
            <Link className="focus-ring rounded-md bg-white px-3 py-2 text-sm font-semibold text-black" href={project.arUrl}>
              Open AR
            </Link>
          ) : null}
        </nav>

        {error ? (
          <section className="my-auto rounded-md border border-[var(--accent)] bg-[var(--soft)] p-5 text-[var(--ink)]">
            {error}
          </section>
        ) : null}

        {project ? (
          <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[1fr_320px]">
            {project.modelUrl ? (
              <model-viewer
                src={project.modelUrl}
                ar
                ar-modes="webxr scene-viewer quick-look"
                camera-controls
                auto-rotate
                shadow-intensity="0.8"
                exposure="1"
                draco-decoder-location="https://www.gstatic.com/draco/v1/decoders/"
                alt={project.name}
                style={{ width: "100%", minHeight: "72vh", background: "var(--background)", borderRadius: 8 }}
              />
            ) : (
              <div className="grid min-h-[72vh] place-items-center rounded-lg bg-[var(--background)] p-6 text-center text-[var(--ink)]">
                <div>
                  <h2 className="text-2xl font-black">No GLB on the active scene yet</h2>
                  <p className="mt-3 max-w-md text-sm leading-6">
                    Add a real model scene from the upload flow, or keep this placeholder
                    while building the project structure.
                  </p>
                </div>
              </div>
            )}
            <aside className="self-start rounded-md border border-white/10 bg-white/8 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--soft)]">Fallback viewer</p>
              <h1 className="mt-3 text-3xl font-black">{project.name}</h1>
              <p className="mt-4 text-sm leading-6 text-white/70">
                Use orbit controls to inspect the model. If your phone supports WebXR,
                Scene Viewer, or Quick Look, the AR button will appear inside the viewer.
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-white/8 p-3">
                  <dt className="font-semibold text-white/55">Marker</dt>
                  <dd className="mt-1 font-bold text-white">
                    {project.marker.widthMm} x {project.marker.heightMm} mm
                  </dd>
                </div>
                <div className="rounded-md bg-white/8 p-3">
                  <dt className="font-semibold text-white/55">Scale</dt>
                  <dd className="mt-1 font-bold text-white">{project.placement.scale}</dd>
                </div>
              </dl>
              <div className="mt-5 grid gap-2">
                <Link
                  className="focus-ring rounded-md bg-[var(--accent)] px-4 py-3 text-center font-semibold text-[var(--ink)]"
                  href={project.arUrl}
                >
                  Try marker AR
                </Link>
                <Link
                  className="focus-ring rounded-md border border-white/20 bg-white/10 px-4 py-3 text-center font-semibold text-white hover:bg-white/15"
                  href={project.urls.dashboardUrl}
                >
                  Open project workspace
                </Link>
                <Link
                  className="focus-ring rounded-md border border-white/20 bg-white/10 px-4 py-3 text-center font-semibold text-white hover:bg-white/15"
                  href={project.markerUrl}
                >
                  Open marker
                </Link>
              </div>
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  );
}
