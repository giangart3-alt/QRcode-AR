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

type ExportPreset = {
  label: string;
  width: number;
  height: number;
  unit: "mm" | "px";
};

const EXPORT_PRESETS: ExportPreset[] = [
  { label: "A4", width: 297, height: 210, unit: "mm" },
  { label: "A3", width: 420, height: 297, unit: "mm" },
  { label: "A2", width: 594, height: 420, unit: "mm" },
  { label: "A1", width: 841, height: 594, unit: "mm" },
  { label: "A0", width: 1189, height: 841, unit: "mm" },
  { label: "2A0", width: 1682, height: 1189, unit: "mm" },
  { label: "4A0", width: 2378, height: 1682, unit: "mm" },
  { label: "16:9", width: 1600, height: 900, unit: "px" },
  { label: "16:10", width: 1600, height: 1000, unit: "px" },
  { label: "Full HD", width: 1920, height: 1080, unit: "px" },
  { label: "4K", width: 3840, height: 2160, unit: "px" },
  { label: "8K", width: 7680, height: 4320, unit: "px" }
];

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
  const [presetLabel, setPresetLabel] = useState("Custom mm");
  const [customMm, setCustomMm] = useState({ width: marker.widthMm, height: marker.heightMm });
  const [customPx, setCustomPx] = useState({ width: 1920, height: 1080 });
  const [pngStatus, setPngStatus] = useState("");

  const exportSize = useMemo(() => {
    if (presetLabel === "Custom mm") {
      return { label: "Custom mm", ...customMm, unit: "mm" as const };
    }

    if (presetLabel === "Custom px") {
      return { label: "Custom px", ...customPx, unit: "px" as const };
    }

    return EXPORT_PRESETS.find((preset) => preset.label === presetLabel) || EXPORT_PRESETS[3];
  }, [customMm, customPx, presetLabel]);

  const svgMarkup = useMemo(
    () => buildMarkerSvg({ projectName, marker }),
    [marker, projectName]
  );
  const svgHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

  async function downloadPng() {
    setPngStatus("Preparing PNG...");

    try {
      const scale = exportSize.unit === "px" ? 1 : 4;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(exportSize.width * scale);
      canvas.height = Math.round(exportSize.height * scale);
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas export is unavailable in this browser.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#111827";
      context.lineWidth = Math.max(2, Math.round(canvas.width * 0.002));
      context.strokeRect(context.lineWidth / 2, context.lineWidth / 2, canvas.width - context.lineWidth, canvas.height - context.lineWidth);

      const markerImage = await loadImage(HIRO_MARKER_IMAGE_URL);
      const layout = getHiroBoardLayout(canvas.width, canvas.height, marker);

      context.fillStyle = "#1c1917";
      context.textAlign = "center";
      context.font = `800 ${layout.titleFontSize}px Arial`;
      context.fillText(projectName, canvas.width / 2, layout.titleY);
      context.drawImage(markerImage, layout.markerX, layout.markerY, layout.markerSize, layout.markerSize);
      context.fillStyle = "#1c1917";
      context.font = `700 ${layout.noteFontSize}px Arial`;
      context.fillText("Track the large black marker. Keep the whole black border visible.", canvas.width / 2, layout.noteY);

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
            <h2 className="text-sm font-black text-[var(--ink)]">Export preset</h2>
            <select
              value={presetLabel}
              onChange={(event) => setPresetLabel(event.target.value)}
              className="focus-ring mt-3 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)]"
            >
              {EXPORT_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {preset.label}
                </option>
              ))}
              <option value="Custom mm">Custom mm</option>
              <option value="Custom px">Custom px</option>
            </select>

            {presetLabel === "Custom mm" ? (
              <SizeInputs unit="mm" size={customMm} onChange={setCustomMm} />
            ) : null}
            {presetLabel === "Custom px" ? (
              <SizeInputs unit="px" size={customPx} onChange={setCustomPx} />
            ) : null}

            <p className="mt-3 text-sm font-semibold text-[var(--muted)]">
              {exportSize.width} x {exportSize.height} {exportSize.unit}
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

function SizeInputs({
  unit,
  size,
  onChange
}: {
  unit: "mm" | "px";
  size: { width: number; height: number };
  onChange: (size: { width: number; height: number }) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        Width {unit}
        <input
          type="number"
          min="1"
          value={size.width}
          onChange={(event) => onChange({ ...size, width: Number(event.target.value) || size.width })}
          className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
        />
      </label>
      <label className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        Height {unit}
        <input
          type="number"
          min="1"
          value={size.height}
          onChange={(event) => onChange({ ...size, height: Number(event.target.value) || size.height })}
          className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
        />
      </label>
    </div>
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
  const layout = getHiroBoardLayout(width, height, marker);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#111827" stroke-width="${Math.max(1, Math.min(width, height) * 0.002)}"/>
  <text x="${width / 2}" y="${layout.titleY}" text-anchor="middle" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${layout.titleFontSize}" font-weight="800">${escapeXml(projectName)}</text>
  <image href="${escapeXml(HIRO_MARKER_IMAGE_URL)}" x="${layout.markerX}" y="${layout.markerY}" width="${layout.markerSize}" height="${layout.markerSize}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${width / 2}" y="${layout.noteY}" text-anchor="middle" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${layout.noteFontSize}" font-weight="700">Track the large black marker. Keep the whole black border visible.</text>
</svg>`;
}

function getHiroBoardLayout(width: number, height: number, marker: MarkerSettings) {
  const geometry = getMarkerBoardGeometry(marker);
  const scale = Math.min(width / geometry.widthMm, height / geometry.heightMm);
  const boardWidth = geometry.widthMm * scale;
  const boardHeight = geometry.heightMm * scale;
  const boardX = (width - boardWidth) / 2;
  const boardY = (height - boardHeight) / 2;
  const markerSize = geometry.trackingMarkerRectMm.sizeMm * scale;
  const shortSide = Math.min(boardWidth, boardHeight);
  const margin = Math.max(shortSide * 0.06, 16);
  const titleFontSize = Math.max(shortSide * 0.04, 12);
  const noteFontSize = Math.max(shortSide * 0.022, 7);

  return {
    titleFontSize,
    noteFontSize,
    titleY: boardY + margin + titleFontSize,
    noteY: boardY + boardHeight - margin,
    markerSize,
    markerX: boardX + geometry.trackingMarkerRectMm.xMm * scale,
    markerY: boardY + geometry.trackingMarkerRectMm.yMm * scale
  };
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
