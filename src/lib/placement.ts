export const MARKER_IMAGE_URL = "/markers/playground.png";
export const MARKER_PATTERN_URL = "/markers/playground.patt";
export const DEFAULT_MARKER_WIDTH_MM = 1000;
export const DEFAULT_MARKER_HEIGHT_MM = 700;
export const DEFAULT_MARKER_STYLE_ID = "technical-grid";
export const DEFAULT_SCREEN_PHYSICAL_WIDTH_MM = 600;

export type MarkerStyleId = "technical-grid" | "checker" | "minimal";
export type MarkerOutputMode = "print" | "screen";

export const MARKER_STYLES: Array<{ id: MarkerStyleId; label: string }> = [
  { id: "technical-grid", label: "Technical grid" },
  { id: "checker", label: "Black/white checker" },
  { id: "minimal", label: "Minimal high-contrast" }
];

export type PlacementMetadata = {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    x: number;
    y: number;
    z: number;
  };
  scale: number;
  markerImage?: string;
  markerWidthMm?: number;
  markerHeightMm?: number;
};

export type MarkerSettings = {
  styleId: string;
  outputMode: MarkerOutputMode;
  presetLabel: string;
  imageUrl: string;
  patternUrl: string;
  widthMm: number;
  heightMm: number;
  screen: {
    widthPx: number;
    heightPx: number;
    physicalWidthMm: number;
    physicalHeightMm: number;
  } | null;
  coordinateSystem: {
    origin: string;
    xAxis: string;
    yAxis: string;
    zAxis: string;
    units: "meters";
  };
};

export function createDefaultPlacement(
  scale = 1,
  verticalOffset = 0
): PlacementMetadata {
  return {
    position: {
      x: 0,
      y: 0,
      z: verticalOffset
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0
    },
    scale
  };
}

export function createDefaultMarker(): MarkerSettings {
  return createMarkerSettings();
}

export function createMarkerSettings(input?: Partial<MarkerSettings>): MarkerSettings {
  const styleId = normalizeMarkerStyleId(input?.styleId);
  const outputMode = input?.outputMode === "screen" ? "screen" : "print";
  const normalizedScreen = normalizeScreenSettings(input?.screen);
  const screen = outputMode === "screen" ? normalizedScreen : null;
  const widthMm = outputMode === "screen"
    ? normalizedScreen.physicalWidthMm
    : positiveNumber(input?.widthMm, DEFAULT_MARKER_WIDTH_MM);
  const heightMm = outputMode === "screen"
    ? normalizedScreen.physicalHeightMm
    : positiveNumber(input?.heightMm, DEFAULT_MARKER_HEIGHT_MM);

  return {
    styleId,
    outputMode,
    presetLabel: input?.presetLabel || (outputMode === "screen" ? "Full HD" : "Custom mm"),
    imageUrl: markerImageUrlForStyle(styleId),
    patternUrl: MARKER_PATTERN_URL,
    widthMm,
    heightMm,
    screen,
    coordinateSystem: {
      origin: "center of marker/playground",
      xAxis: "left/right on marker",
      yAxis: "forward/back on marker",
      zAxis: "vertical height above marker",
      units: "meters"
    }
  };
}

export function normalizePlacement(
  placement: Partial<PlacementMetadata> | null | undefined,
  fallbackScale = 1,
  fallbackVerticalOffset = 0
): PlacementMetadata {
  const fallback = createDefaultPlacement(fallbackScale, fallbackVerticalOffset);

  return {
    position: {
      x: finiteNumber(placement?.position?.x, fallback.position.x),
      y: finiteNumber(placement?.position?.y, fallback.position.y),
      z: finiteNumber(placement?.position?.z, fallback.position.z)
    },
    rotation: {
      x: finiteNumber(placement?.rotation?.x, fallback.rotation.x),
      y: finiteNumber(placement?.rotation?.y, fallback.rotation.y),
      z: finiteNumber(placement?.rotation?.z, fallback.rotation.z)
    },
    scale: positiveNumber(placement?.scale, fallback.scale),
    markerImage: placement?.markerImage,
    markerWidthMm: placement?.markerWidthMm,
    markerHeightMm: placement?.markerHeightMm
  };
}

export function normalizeMarker(marker: Partial<MarkerSettings> | null | undefined) {
  const fallback = createDefaultMarker();
  const styleId = normalizeMarkerStyleId(marker?.styleId);
  const outputMode = marker?.outputMode === "screen" ? "screen" : "print";
  const normalizedScreen = normalizeScreenSettings(marker?.screen);
  const screen = outputMode === "screen" ? normalizedScreen : null;

  return {
    styleId,
    outputMode,
    presetLabel: marker?.presetLabel || fallback.presetLabel,
    imageUrl: markerImageUrlForStyle(styleId),
    patternUrl: marker?.patternUrl || fallback.patternUrl,
    widthMm: outputMode === "screen"
      ? normalizedScreen.physicalWidthMm
      : positiveNumber(
          marker?.widthMm ?? (marker as { markerWidthMm?: number } | null | undefined)?.markerWidthMm,
          fallback.widthMm
        ),
    heightMm: outputMode === "screen"
      ? normalizedScreen.physicalHeightMm
      : positiveNumber(
          marker?.heightMm ?? (marker as { markerHeightMm?: number } | null | undefined)?.markerHeightMm,
          fallback.heightMm
        ),
    screen,
    coordinateSystem: {
      origin: marker?.coordinateSystem?.origin || fallback.coordinateSystem.origin,
      xAxis: "left/right on marker",
      yAxis: "forward/back on marker",
      zAxis: "vertical height above marker",
      units: "meters" as const
    }
  } satisfies MarkerSettings;
}

export function screenPhysicalSizeFromPixels(
  widthPx: number,
  heightPx: number,
  physicalWidthMm = DEFAULT_SCREEN_PHYSICAL_WIDTH_MM
) {
  const width = positiveNumber(widthPx, 1920);
  const height = positiveNumber(heightPx, 1080);
  const physicalWidth = positiveNumber(physicalWidthMm, DEFAULT_SCREEN_PHYSICAL_WIDTH_MM);

  return {
    widthMm: Math.round(physicalWidth),
    heightMm: Math.round(physicalWidth * (height / width))
  };
}

export function markerImageUrlForStyle(styleId: string) {
  if (styleId === "checker") return CHECKER_MARKER_IMAGE_URL;
  if (styleId === "minimal") return MINIMAL_MARKER_IMAGE_URL;
  return MARKER_IMAGE_URL;
}

function normalizeMarkerStyleId(value: unknown): MarkerStyleId {
  return value === "checker" || value === "minimal" ? value : DEFAULT_MARKER_STYLE_ID;
}

export function mmToMeters(value: number) {
  return value / 1000;
}

export function metersToMm(value: number) {
  return value * 1000;
}

export function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeScreenSettings(screen: Partial<NonNullable<MarkerSettings["screen"]>> | null | undefined) {
  const widthPx = positiveNumber(screen?.widthPx, 1920);
  const heightPx = positiveNumber(screen?.heightPx, 1080);
  const physical = screenPhysicalSizeFromPixels(
    widthPx,
    heightPx,
    positiveNumber(screen?.physicalWidthMm, DEFAULT_SCREEN_PHYSICAL_WIDTH_MM)
  );

  return {
    widthPx,
    heightPx,
    physicalWidthMm: positiveNumber(screen?.physicalWidthMm, physical.widthMm),
    physicalHeightMm: positiveNumber(screen?.physicalHeightMm, physical.heightMm)
  };
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const CHECKER_MARKER_IMAGE_URL = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700">
  <rect width="1000" height="700" fill="#fff"/>
  <rect x="24" y="24" width="952" height="652" fill="#fff" stroke="#1c1917" stroke-width="16"/>
  <g>
    ${Array.from({ length: 14 }).map((_, y) =>
      Array.from({ length: 20 }).map((__, x) =>
        (x + y) % 2 === 0
          ? `<rect x="${40 + x * 46}" y="${40 + y * 44}" width="46" height="44" fill="#1c1917"/>`
          : ""
      ).join("")
    ).join("")}
  </g>
  <rect x="420" y="270" width="160" height="160" fill="#fff" stroke="#1c1917" stroke-width="10"/>
  <path d="M500 285v130M435 350h130" stroke="#1c1917" stroke-width="10"/>
</svg>`);

const MINIMAL_MARKER_IMAGE_URL = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700">
  <rect width="1000" height="700" fill="#fff"/>
  <rect x="24" y="24" width="952" height="652" fill="#fff" stroke="#1c1917" stroke-width="20"/>
  <rect x="78" y="78" width="844" height="544" fill="none" stroke="#1c1917" stroke-width="6"/>
  <path d="M500 95v510M95 350h810" stroke="#1c1917" stroke-width="12"/>
  <circle cx="500" cy="350" r="74" fill="#fff" stroke="#1c1917" stroke-width="14"/>
  <circle cx="500" cy="350" r="18" fill="#1c1917"/>
</svg>`);
