"use client";

import { upload } from "@vercel/blob/client";
import QRCode from "qrcode";
import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import type { ProjectMetadata } from "@/lib/projects";

type UploadProgress = {
  loaded?: number;
  total?: number;
  percentage?: number;
};

export function AdminClient() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [name, setName] = useState("");
  const [scale, setScale] = useState("1");
  const [verticalOffset, setVerticalOffset] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const fileSize = useMemo(() => {
    if (!file) return "";
    return `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  }, [file]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const response = await fetch("/api/admin/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    setBusy(false);

    if (!response.ok || !result.ok) {
      setError(result.error || "Unable to unlock admin.");
      return;
    }

    setUnlocked(true);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setProject(null);
    setQrDataUrl("");
    setProgress(0);

    try {
      if (!file) {
        throw new Error("Choose a .glb file.");
      }

      if (!file.name.toLowerCase().endsWith(".glb")) {
        throw new Error("Only .glb files are allowed.");
      }

      const pendingName = name.trim() || file.name.replace(/\.glb$/i, "");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const pathname = `models/${crypto.randomUUID()}-${safeName}`;

      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        clientPayload: JSON.stringify({ password }),
        onUploadProgress: (event: UploadProgress) => {
          if (typeof event.percentage === "number") {
            setProgress(Math.round(event.percentage));
            return;
          }

          if (event.loaded && event.total) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      });

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          name: pendingName,
          scale: Number(scale),
          verticalOffset: Number(verticalOffset),
          modelUrl: blob.url,
          modelPathname: blob.pathname,
          modelSize: file.size
        })
      });

      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Uploaded the GLB, but metadata could not be saved.");
      }

      setProject(result.project);
      setQrDataUrl(await QRCode.toDataURL(result.project.arUrl, { margin: 1, width: 320 }));
      setProgress(100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-5 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between border-b border-[var(--line)] pb-5">
          <Link className="focus-ring rounded-md px-3 py-2 text-sm font-semibold hover:bg-white" href="/">
            Home
          </Link>
          <Link className="focus-ring rounded-md px-3 py-2 text-sm font-semibold hover:bg-white" href="/marker">
            Marker
          </Link>
        </div>

        <h1 className="text-4xl font-black tracking-tight">Admin</h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Upload one GLB at a time. The file goes straight from this browser to Vercel Blob;
          the app only saves a small JSON project record after upload finishes.
        </p>

        {!unlocked ? (
          <form onSubmit={unlock} className="mt-8 max-w-md rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
            <label className="block text-sm font-semibold" htmlFor="password">
              Admin password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="focus-ring mt-2 w-full rounded-md border border-[var(--line)] bg-white px-3 py-3"
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={busy}
              className="focus-ring mt-4 rounded-md bg-[var(--ink)] px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Checking..." : "Unlock"}
            </button>
          </form>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
            <form onSubmit={createProject} className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="block text-sm font-semibold md:col-span-2">
                  Project/model name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-md border border-[var(--line)] bg-white px-3 py-3"
                    placeholder="Gallery sculpture"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Scale
                  <input
                    type="number"
                    step="0.05"
                    min="0.01"
                    value={scale}
                    onChange={(event) => setScale(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-md border border-[var(--line)] bg-white px-3 py-3"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Vertical offset
                  <input
                    type="number"
                    step="0.01"
                    value={verticalOffset}
                    onChange={(event) => setVerticalOffset(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-md border border-[var(--line)] bg-white px-3 py-3"
                  />
                </label>
                <label className="block text-sm font-semibold md:col-span-2">
                  GLB model
                  <input
                    type="file"
                    accept=".glb,model/gltf-binary"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    className="focus-ring mt-2 w-full rounded-md border border-dashed border-[var(--line)] bg-white px-3 py-5"
                  />
                </label>
              </div>

              {file ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Selected: <strong>{file.name}</strong> ({fileSize})
                </p>
              ) : null}

              {busy || progress > 0 ? (
                <div className="mt-5">
                  <div className="h-3 overflow-hidden rounded-full bg-[#e6dfd0]">
                    <div className="h-full bg-[var(--accent)]" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{progress}% uploaded</p>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="focus-ring mt-6 rounded-md bg-[var(--accent)] px-4 py-3 font-semibold text-white hover:bg-[var(--accent-dark)] disabled:opacity-60"
              >
                {busy ? "Creating..." : "Create project"}
              </button>
            </form>

            <aside className="rounded-md border border-[var(--line)] bg-white p-5">
              <h2 className="text-xl font-black">Project links</h2>
              {!project ? (
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  Upload a GLB to generate the public AR URL, fallback viewer URL, and QR code.
                </p>
              ) : (
                <div className="mt-4 space-y-5">
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="QR code for AR page" className="w-64 rounded-md border border-[var(--line)]" />
                  ) : null}
                  <LinkRow label="AR URL" value={project.arUrl} />
                  <LinkRow label="Viewer URL" value={project.viewUrl} />
                  <Link
                    href={project.arUrl}
                    className="focus-ring inline-block rounded-md bg-[var(--ink)] px-4 py-3 font-semibold text-white"
                  >
                    Open AR page
                  </Link>
                </div>
              )}
            </aside>
          </div>
        )}

        {error ? (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function LinkRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-all text-sm">{value}</p>
      <div className="mt-2">
        <CopyButton value={value} />
      </div>
    </div>
  );
}
