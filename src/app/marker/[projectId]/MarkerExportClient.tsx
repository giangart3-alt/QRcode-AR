"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { getMarkerBoardImageUrl, type MarkerSettings } from "@/lib/placement";
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
  const [presetLabel, setPresetLabel] = useState("A1");
  const [customMm, setCustomMm] = useState({ width: 1000, height: 700 });
  const [customPx, setCustomPx] = useState({ width: 1920, height: 1080 });
  const [pngStatus, setPngStatus] = useState("");
  const boardImageUrl = useMemo(() => getMarkerBoardImageUrl(marker), [marker]);

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
    () => buildMarkerSvg({ projectName, marker, arUrl, qrDataUrl, exportSize }),
    [arUrl, exportSize, marker, projectName, qrDataUrl]
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

      context.fillStyle = "#fff7ed";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#1c1917";
      context.font = `${Math.max(18, Math.round(canvas.width * 0.025))}px Arial`;
      context.fillText(projectName, Math.round(canvas.width * 0.04), Math.round(canvas.height * 0.08));

      const markerImage = await loadImage(boardImageUrl);
      const qrImage = await loadImage(qrDataUrl);
      const gap = canvas.width * 0.035;
      const qrSize = Math.min(canvas.width * 0.18, canvas.height * 0.28);
      const markerX = canvas.width * 0.04;
      const markerY = canvas.height * 0.14;
      const markerW = canvas.width - markerX * 2 - qrSize - gap;
      const markerH = Math.min(canvas.height * 0.72, markerW * (marker.heightMm / marker.widthMm));
      const qrX = markerX + markerW + gap;

      context.drawImage(markerImage, markerX, markerY, markerW, markerH);
      context.fillStyle = "#ffffff";
      context.fillRect(qrX - 10, markerY - 10, qrSize + 20, qrSize + 20);
      context.drawImage(qrImage, qrX, markerY, qrSize, qrSize);

      context.fillStyle = "#1c1917";
      context.font = `${Math.max(12, Math.round(canvas.width * 0.012))}px Arial`;
      context.fillText("Print at 100% scale", qrX, markerY + qrSize + 34);
      context.fillText("AR tracking marker: default-ar-tracker", qrX, markerY + qrSize + 60);

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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={boardImageUrl}
              alt={`${projectName} marker playground`}
              className="h-auto w-full rounded-lg border border-[var(--line)] print:rounded-none"
            />
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
            <a className="button-secondary" href={svgHref} download={`${safeFileName(projectName)}-marker.svg`}>
              Download SVG
            </a>
            <button type="button" className="button-secondary" onClick={downloadPng}>
              Download PNG
            </button>
            <a className="button-secondary" href={marker.trackingMarkerImageUrl} download={`${safeFileName(projectName)}-tracking-marker.svg`}>
              Tracking SVG
            </a>
            <a className="button-secondary" href={marker.trackingMarkerPngUrl} download={`${safeFileName(projectName)}-tracking-marker.png`}>
              Tracking PNG
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
  marker,
  arUrl,
  qrDataUrl,
  exportSize
}: {
  projectName: string;
  marker: MarkerSettings;
  arUrl: string;
  qrDataUrl: string;
  exportSize: ExportPreset;
}) {
  const unit = exportSize.unit;
  const width = exportSize.width;
  const height = exportSize.height;
  const margin = width * 0.04;
  const gap = width * 0.035;
  const qrSize = Math.min(width * 0.18, height * 0.28);
  const markerX = margin;
  const markerY = height * 0.14;
  const markerWidth = width - margin * 2 - qrSize - gap;
  const markerHeight = Math.min(height * 0.72, markerWidth * (marker.heightMm / marker.widthMm));
  const qrX = markerX + markerWidth + gap;
  const boardImageUrl = getMarkerBoardImageUrl(marker);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}${unit}" height="${height}${unit}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fff7ed"/>
  <text x="${margin}" y="${height * 0.08}" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(14, width * 0.025)}" font-weight="800">${escapeXml(projectName)}</text>
  <image href="${escapeXml(boardImageUrl)}" x="${markerX}" y="${markerY}" width="${markerWidth}" height="${markerHeight}" preserveAspectRatio="xMidYMid meet"/>
  <rect x="${qrX - 3}" y="${markerY - 3}" width="${qrSize + 6}" height="${qrSize + 6}" fill="#ffffff" stroke="#fed7aa"/>
  <image href="${qrDataUrl}" x="${qrX}" y="${markerY}" width="${qrSize}" height="${qrSize}"/>
  <text x="${qrX}" y="${markerY + qrSize + height * 0.045}" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(8, width * 0.012)}" font-weight="800">Print at 100% scale</text>
  <text x="${qrX}" y="${markerY + qrSize + height * 0.075}" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(6, width * 0.008)}">AR tracking marker: ${escapeXml(marker.trackingMarkerId)}</text>
  <text x="${qrX}" y="${markerY + qrSize + height * 0.102}" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(6, width * 0.008)}">Board: ${marker.widthMm}mm x ${marker.heightMm}mm - Tracker: ${marker.trackingMarkerSizeOnBoardMm}mm</text>
  <text x="${qrX}" y="${markerY + qrSize + height * 0.13}" fill="#1c1917" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(6, width * 0.007)}">${escapeXml(arUrl)}</text>
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
