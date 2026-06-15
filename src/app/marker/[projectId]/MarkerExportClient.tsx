"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import {
  HIRO_MARKER_IMAGE_URL,
  getMarkerBoardGeometry,
  type MarkerSettings
} from "@/lib/placement";
import { PrintButton } from "../PrintButton";

export function MarkerExportClient({
  projectName,
  marker,
  arUrl,
  qrDataUrl,
  error
}: {
  projectName: string;
  marker: MarkerSettings;
  arUrl: string;
  qrDataUrl: string;
  error: string;
}) {
  const [pngStatus, setPngStatus] = useState("");

  const svgMarkup = useMemo(
    () => buildMarkerSvg({ projectName, marker }),
    [marker, projectName]
  );
  const svgHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

  async function downloadPng() {
    setPngStatus("Preparing PNG...");

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1600;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas export is unavailable in this browser.");
      }

      const markerImage = await loadImage(HIRO_MARKER_IMAGE_URL);
      context.drawImage(markerImage, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error("Unable to create PNG."));
        }, "image/png");
      });
      const href = URL.createObjectURL(blob);
      triggerDownload(href, `${safeFileName(projectName)}-marker.png`);
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      setPngStatus("PNG downloaded.");
    } catch (caught) {
      setPngStatus(caught instanceof Error ? caught.message : "PNG export failed.");
    }
  }

  return (
    <main className="min-h-screen bg-[var(--panel)] px-5 py-6 text-[var(--ink)]">
      <div className="no-print mx-auto mb-8 flex max-w-6xl items-center justify-between border-b border-[var(--line)] pb-5">
        <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[var(--soft)]" href="/">
          Home
        </Link>
        <PrintButton />
      </div>

      <section className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <div className="grid gap-4 rounded-lg border border-[var(--line)] bg-white p-4 md:grid-cols-[minmax(0,1fr)_180px] print:border-0">
            <div className="grid min-h-[55vh] content-center gap-6 rounded-lg border border-[var(--line)] bg-white p-6 text-center print:rounded-none print:border-0">
              <p className="text-lg font-black text-[var(--ink)]">{projectName}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgHref} alt={`${projectName} marker board`} className="mx-auto max-h-[60vh] max-w-full" />
              <p className="text-sm font-bold text-[var(--ink)]">Track the large black marker. Keep the whole black border visible.</p>
            </div>
            <div className="grid content-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt={`QR code for ${projectName} AR project`} className="w-full rounded-md border border-[var(--line)] bg-white p-2" />
              <p className="text-sm font-black text-[var(--ink)]">{projectName}</p>
              <p className="break-all text-xs font-semibold text-[var(--muted)]">{arUrl}</p>
            </div>
          </div>
        </div>

        <aside className="no-print rounded-xl border border-[var(--line)] bg-[var(--background)] p-5">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Project marker</p>
          <h1 className="mt-3 text-4xl font-black">{projectName}</h1>
          <div className="mt-5 space-y-4 text-base leading-7 text-[var(--muted)]">
            <p>
              Physical size: <strong>{marker.widthMm}mm x {marker.heightMm}mm</strong>.
              Print at <strong>100% scale</strong>.
            </p>
            <p>
              AR tracking marker: <strong>{marker.trackingMarkerId}</strong>,{" "}
              <strong>{marker.trackingMarkerSizeOnBoardMm}mm</strong> square.
            </p>
            <p>
              QR target: <strong>{arUrl}</strong>
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <CopyButton value={arUrl} label="Copy AR link" />
            <Link className="button-secondary" href="/ar/test">
              Open AR test
            </Link>
            <a className="button-secondary" href={svgHref} download={`${safeFileName(projectName)}-marker.svg`}>
              Download SVG
            </a>
            <button type="button" className="button-secondary" onClick={downloadPng}>
              Download PNG
            </button>
            <a className="button-secondary" href={HIRO_MARKER_IMAGE_URL} download={`${safeFileName(projectName)}-hiro-marker.png`}>
              HIRO marker PNG
            </a>
          </div>
          {pngStatus ? <p className="mt-3 text-sm font-semibold text-[var(--muted)]">{pngStatus}</p> : null}

          <section className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
            <h2 className="text-sm font-black text-[var(--ink)]">Fixed marker export</h2>
            <p className="mt-3 text-sm font-semibold text-[var(--muted)]">
              200mm x 200mm HIRO marker. Print the SVG at 100% scale.
            </p>
          </section>

          {error ? (
            <p className="mt-5 rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-3 font-semibold text-[var(--ink)]">
              {error}
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function buildMarkerSvg({
  projectName,
  marker
}: {
  projectName: string;
  marker: MarkerSettings;
}) {
  const geometry = getMarkerBoardGeometry(marker);
  const width = geometry.widthMm;
  const height = geometry.heightMm;
  void projectName;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <image href="${escapeXml(HIRO_MARKER_IMAGE_URL)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("PNG export could not load one of the marker images."));
    image.src = src;
  });
}

function triggerDownload(href: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
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
