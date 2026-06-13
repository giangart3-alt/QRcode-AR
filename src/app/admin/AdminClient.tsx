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

type UploadStage = "idle" | "preparing" | "uploading" | "saving";

type UploadRouteResponse = {
  error?: string;
};

const MAX_GLB_SIZE_BYTES = 500 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

export function AdminClient() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [name, setName] = useState("");
  const [scale, setScale] = useState("1");
  const [verticalOffset, setVerticalOffset] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const working = busy || uploadStage !== "idle";
  const uploadLabel = getUploadLabel(uploadStage, progress);

  const fileSize = useMemo(() => {
    if (!file) return "";
    return `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  }, [file]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

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

    window.sessionStorage.setItem("adminPassword", password);
    setUnlocked(true);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setUploadStage("preparing");
    setError("");
    setSuccess("");
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

      if (file.size > MAX_GLB_SIZE_BYTES) {
        throw new Error("Choose a GLB file that is 500 MB or smaller.");
      }

      const parsedScale = parseDecimalInput(scale, "Scale");
      if (parsedScale.value <= 0) {
        throw new Error("Scale must be greater than 0.");
      }

      const parsedVerticalOffset = parseDecimalInput(verticalOffset, "Vertical offset");
      setScale(parsedScale.normalized);
      setVerticalOffset(parsedVerticalOffset.normalized);

      const pendingName = name.trim() || file.name.replace(/\.glb$/i, "");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const pathname = `models/${crypto.randomUUID()}-${safeName}`;
      const multipart = file.size >= MULTIPART_THRESHOLD_BYTES;
      const clientPayload = JSON.stringify({ password });

      setUploadStage("uploading");
      let blob;
      try {
        blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          clientPayload,
          multipart,
          contentType: getGlbContentType(file.type),
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
      } catch (uploadError) {
        throw await resolveBlobUploadError(uploadError, pathname, clientPayload, multipart);
      }

      setUploadStage("saving");
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          name: pendingName,
          scale: parsedScale.value,
          verticalOffset: parsedVerticalOffset.value,
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
      window.sessionStorage.setItem("adminPassword", password);
      setSuccess("Project created. The AR page, fallback viewer, placement editor, and QR code are ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create project.");
    } finally {
      setBusy(false);
      setUploadStage("idle");
    }
  }

  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between border-b border-[var(--line)] pb-5">
          <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)]" href="/">
            Home
          </Link>
          <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)]" href="/marker">
            Marker
          </Link>
        </div>

        <h1 className="text-4xl font-black tracking-tight text-[var(--ink)]">Admin</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
          Upload one GLB at a time. The file goes straight from this browser to Vercel Blob;
          the app only saves a small JSON project record after upload finishes.
        </p>

        {!unlocked ? (
          <form onSubmit={unlock} className="mt-8 max-w-md rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-sm">
            <label className="block text-sm font-semibold" htmlFor="password">
              Admin password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={busy}
              className="focus-ring mt-4 rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Checking..." : "Unlock"}
            </button>
          </form>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
            <form noValidate onSubmit={createProject} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-sm">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="block text-sm font-semibold md:col-span-2">
                  Project/model name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                    placeholder="Gallery sculpture"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Scale
                  <input
                    type="text"
                    inputMode="decimal"
                    value={scale}
                    onChange={(event) => setScale(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Vertical offset
                  <input
                    type="text"
                    inputMode="decimal"
                    value={verticalOffset}
                    onChange={(event) => setVerticalOffset(event.target.value)}
                    className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                  />
                </label>
                <label className="block text-sm font-semibold md:col-span-2">
                  GLB model
                  <input
                    type="file"
                    accept=".glb,model/gltf-binary,application/octet-stream"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    className="focus-ring mt-2 w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-3 py-5 text-[var(--ink)] file:mr-4 file:rounded-md file:border-0 file:bg-[var(--ink)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                </label>
              </div>

              {file ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Selected: <strong>{file.name}</strong> ({fileSize})
                </p>
              ) : null}

              {uploadStage !== "idle" || progress > 0 ? (
                <div className="mt-5 rounded-lg border border-[var(--line)] bg-white p-4">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                    <span>{uploadLabel}</span>
                    <span className="tabular-nums text-[var(--muted)]">{progress}%</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--soft)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={working}
                className="focus-ring mt-6 rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? "Working..." : "Create project"}
              </button>
            </form>

            <aside className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black text-[var(--ink)]">Project links</h2>
              {!project ? (
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  Upload a GLB to generate the public AR URL, fallback viewer URL, and QR code.
                </p>
              ) : (
                <div className="mt-4 space-y-5">
                  {qrDataUrl ? (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--soft)] p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrDataUrl} alt="QR code for AR page" className="mx-auto w-64 rounded-md border border-[var(--line)] bg-white" />
                    </div>
                  ) : null}
                  <LinkRow label="AR URL" value={project.arUrl} />
                  <LinkRow label="Viewer URL" value={project.viewUrl} />
                  <LinkRow label="Editor URL" value={project.editorUrl} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Link
                      href={project.editorUrl}
                      className="focus-ring rounded-lg bg-[var(--accent)] px-4 py-3 text-center font-semibold text-white transition hover:bg-[var(--accent-dark)]"
                    >
                      Open placement editor
                    </Link>
                    <Link
                      href={project.arUrl}
                      className="focus-ring rounded-lg bg-[var(--ink)] px-4 py-3 text-center font-semibold text-white transition hover:bg-black"
                    >
                      Open AR page
                    </Link>
                    <Link
                      href={project.viewUrl}
                      className="button-secondary text-center"
                    >
                      Open viewer
                    </Link>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            {success}
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

async function readJson<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function parseDecimalInput(rawValue: string, label: string) {
  const normalized = rawValue.trim().replace(",", ".");

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  const value = Number(normalized);

  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a valid number. Use 1.5 or 1,5.`);
  }

  return {
    value,
    normalized
  };
}

function getGlbContentType(fileType: string) {
  if (fileType === "model/gltf-binary" || fileType === "application/octet-stream") {
    return fileType;
  }

  return "model/gltf-binary";
}

function getUploadLabel(stage: UploadStage, progress: number) {
  if (stage === "idle" && progress >= 100) return "Upload complete.";
  if (stage === "preparing") return "Preparing secure Blob upload...";
  if (stage === "uploading") return progress >= 100 ? "Upload complete." : "Uploading GLB to Blob...";
  if (stage === "saving") return "Saving project metadata...";
  return "Upload ready.";
}
