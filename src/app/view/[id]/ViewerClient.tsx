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
    <main className="min-h-screen bg-[#10100d] text-white">
      <Script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js" />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5">
        <nav className="no-print flex items-center justify-between">
          <Link className="focus-ring rounded-md px-3 py-2 text-sm font-semibold hover:bg-white/10" href="/">
            Home
          </Link>
          {project ? (
            <Link className="focus-ring rounded-md bg-white px-3 py-2 text-sm font-semibold text-black" href={`/ar/${project.id}`}>
              Open AR
            </Link>
          ) : null}
        </nav>

        {error ? (
          <section className="my-auto rounded-md border border-red-400/40 bg-red-950/40 p-5 text-red-100">
            {error}
          </section>
        ) : null}

        {project ? (
          <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[1fr_320px]">
            <model-viewer
              src={project.modelUrl}
              ar
              ar-modes="webxr scene-viewer quick-look"
              camera-controls
              auto-rotate
              shadow-intensity="0.8"
              exposure="1"
              alt={project.name}
              style={{ width: "100%", minHeight: "72vh", background: "#e9e3d5", borderRadius: 8 }}
            />
            <aside className="self-start rounded-md border border-white/10 bg-white/8 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-200">Fallback viewer</p>
              <h1 className="mt-3 text-3xl font-black">{project.name}</h1>
              <p className="mt-4 text-sm leading-6 text-white/70">
                Use orbit controls to inspect the model. If your phone supports WebXR,
                Scene Viewer, or Quick Look, the AR button will appear inside the viewer.
              </p>
              <Link
                className="focus-ring mt-5 inline-block rounded-md bg-teal-500 px-4 py-3 font-semibold text-black"
                href={`/ar/${project.id}`}
              >
                Try marker AR
              </Link>
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  );
}
