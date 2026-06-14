export const LEGACY_PLAYGROUND_IMAGE_URL = "/markers/playground.png";
export const DEFAULT_TRACKING_MARKER_ID = "default-ar-tracker";
export const TRACKING_MARKER_IMAGE_URL = "/markers/default-ar-tracker/default-ar-tracker.svg";
export const TRACKING_MARKER_PNG_URL = "/markers/default-ar-tracker/default-ar-tracker.png";
export const TRACKING_MARKER_PATTERN_URL = "/markers/default-ar-tracker/default-ar-tracker.patt";
export const MARKER_IMAGE_URL = LEGACY_PLAYGROUND_IMAGE_URL;
export const MARKER_PATTERN_URL = TRACKING_MARKER_PATTERN_URL;
export const DEFAULT_MARKER_WIDTH_MM = 1000;
export const DEFAULT_MARKER_HEIGHT_MM = 700;
export const DEFAULT_MARKER_STYLE_ID = "technical-grid";
export const DEFAULT_SCREEN_PHYSICAL_WIDTH_MM = 600;

export type MarkerStyleId = "technical-grid" | "checker" | "minimal";
export type MarkerOutputMode = "print" | "screen";
export type TrackingMarkerType = "pattern";

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
  boardStyle: MarkerStyleId;
  outputMode: MarkerOutputMode;
  presetLabel: string;
  imageUrl: string;
  boardImageUrl: string;
  patternUrl: string;
  widthMm: number;
  heightMm: number;
  trackingMarkerId: string;
  trackingMarkerType: TrackingMarkerType;
  trackingMarkerImageUrl: string;
  trackingMarkerPngUrl: string;
  trackingMarkerPatternUrl: string;
  trackingMarkerPositionOnBoard: {
    xMm: number;
    yMm: number;
  };
  trackingMarkerSizeOnBoardMm: number;
  qrPlacement: {
    corner: "right";
    sizeRatio: number;
  };
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
  const boardStyle = normalizeMarkerStyleId(input?.boardStyle || input?.styleId);
  const outputMode = input?.outputMode === "screen" ? "screen" : "print";
  const normalizedScreen = normalizeScreenSettings(input?.screen);
  const screen = outputMode === "screen" ? normalizedScreen : null;
  const widthMm = outputMode === "screen"
    ? normalizedScreen.physicalWidthMm
    : positiveNumber(input?.widthMm, DEFAULT_MARKER_WIDTH_MM);
  const heightMm = outputMode === "screen"
    ? normalizedScreen.physicalHeightMm
    : positiveNumber(input?.heightMm, DEFAULT_MARKER_HEIGHT_MM);
  const trackingMarkerSizeOnBoardMm = normalizeTrackingMarkerSize(
    input?.trackingMarkerSizeOnBoardMm,
    widthMm,
    heightMm
  );
  const trackingMarkerPositionOnBoard = normalizeTrackingMarkerPosition(
    input?.trackingMarkerPositionOnBoard
  );
  const boardImageUrl = boardImageUrlForStyle(
    boardStyle,
    widthMm,
    heightMm,
    trackingMarkerSizeOnBoardMm,
    trackingMarkerPositionOnBoard
  );

  return {
    styleId: boardStyle,
    boardStyle,
    outputMode,
    presetLabel: input?.presetLabel || (outputMode === "screen" ? "Full HD" : "Custom mm"),
    imageUrl: boardImageUrl,
    boardImageUrl,
    patternUrl: TRACKING_MARKER_PATTERN_URL,
    widthMm,
    heightMm,
    trackingMarkerId: DEFAULT_TRACKING_MARKER_ID,
    trackingMarkerType: "pattern",
    trackingMarkerImageUrl: TRACKING_MARKER_IMAGE_URL,
    trackingMarkerPngUrl: TRACKING_MARKER_PNG_URL,
    trackingMarkerPatternUrl: TRACKING_MARKER_PATTERN_URL,
    trackingMarkerPositionOnBoard,
    trackingMarkerSizeOnBoardMm,
    qrPlacement: normalizeQrPlacement(input?.qrPlacement),
    screen,
    coordinateSystem: {
      origin: "center of board/playground",
      xAxis: "left/right on board",
      yAxis: "forward/back on board",
      zAxis: "vertical height above board",
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
  const boardStyle = normalizeMarkerStyleId(marker?.boardStyle || marker?.styleId);
  const outputMode = marker?.outputMode === "screen" ? "screen" : "print";
  const normalizedScreen = normalizeScreenSettings(marker?.screen);
  const screen = outputMode === "screen" ? normalizedScreen : null;
  const widthMm = outputMode === "screen"
    ? normalizedScreen.physicalWidthMm
    : positiveNumber(
        marker?.widthMm ?? (marker as { markerWidthMm?: number } | null | undefined)?.markerWidthMm,
        fallback.widthMm
      );
  const heightMm = outputMode === "screen"
    ? normalizedScreen.physicalHeightMm
    : positiveNumber(
        marker?.heightMm ?? (marker as { markerHeightMm?: number } | null | undefined)?.markerHeightMm,
        fallback.heightMm
      );
  const trackingMarkerSizeOnBoardMm = normalizeTrackingMarkerSize(
    marker?.trackingMarkerSizeOnBoardMm,
    widthMm,
    heightMm
  );
  const trackingMarkerPositionOnBoard = normalizeTrackingMarkerPosition(
    marker?.trackingMarkerPositionOnBoard
  );
  const boardImageUrl = boardImageUrlForStyle(
    boardStyle,
    widthMm,
    heightMm,
    trackingMarkerSizeOnBoardMm,
    trackingMarkerPositionOnBoard
  );

  return {
    styleId: boardStyle,
    boardStyle,
    outputMode,
    presetLabel: marker?.presetLabel || fallback.presetLabel,
    imageUrl: boardImageUrl,
    boardImageUrl,
    patternUrl: TRACKING_MARKER_PATTERN_URL,
    widthMm,
    heightMm,
    trackingMarkerId: DEFAULT_TRACKING_MARKER_ID,
    trackingMarkerType: "pattern",
    trackingMarkerImageUrl: TRACKING_MARKER_IMAGE_URL,
    trackingMarkerPngUrl: TRACKING_MARKER_PNG_URL,
    trackingMarkerPatternUrl: TRACKING_MARKER_PATTERN_URL,
    trackingMarkerPositionOnBoard,
    trackingMarkerSizeOnBoardMm,
    qrPlacement: normalizeQrPlacement(marker?.qrPlacement),
    screen,
    coordinateSystem: {
      origin: marker?.coordinateSystem?.origin || "center of board/playground",
      xAxis: "left/right on board",
      yAxis: "forward/back on board",
      zAxis: "vertical height above board",
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
  return boardImageUrlForStyle(styleId, DEFAULT_MARKER_WIDTH_MM, DEFAULT_MARKER_HEIGHT_MM);
}

export function getMarkerBoardImageUrl(marker: Pick<MarkerSettings, "boardImageUrl" | "imageUrl" | "boardStyle" | "widthMm" | "heightMm" | "trackingMarkerSizeOnBoardMm" | "trackingMarkerPositionOnBoard">) {
  return marker.boardImageUrl || marker.imageUrl || boardImageUrlForStyle(
    marker.boardStyle,
    marker.widthMm,
    marker.heightMm,
    marker.trackingMarkerSizeOnBoardMm,
    marker.trackingMarkerPositionOnBoard
  );
}

export function getTrackingMarkerPatternUrl(marker: Pick<MarkerSettings, "trackingMarkerPatternUrl" | "patternUrl">) {
  return marker.trackingMarkerPatternUrl || marker.patternUrl || TRACKING_MARKER_PATTERN_URL;
}

export function boardImageUrlForStyle(
  styleId: string,
  widthMm: number,
  heightMm: number,
  trackingMarkerSizeOnBoardMm = defaultTrackingMarkerSize(widthMm, heightMm),
  trackingMarkerPositionOnBoard = { xMm: 0, yMm: 0 }
) {
  return svgDataUrl(
    buildBoardSvg({
      boardStyle: normalizeMarkerStyleId(styleId),
      widthMm,
      heightMm,
      trackingMarkerSizeOnBoardMm,
      trackingMarkerPositionOnBoard
    })
  );
}

export function buildBoardSvg({
  boardStyle,
  widthMm,
  heightMm,
  trackingMarkerSizeOnBoardMm,
  trackingMarkerPositionOnBoard
}: {
  boardStyle: MarkerStyleId;
  widthMm: number;
  heightMm: number;
  trackingMarkerSizeOnBoardMm: number;
  trackingMarkerPositionOnBoard: { xMm: number; yMm: number };
}) {
  const width = Math.max(widthMm, 1);
  const height = Math.max(heightMm, 1);
  const padding = Math.max(Math.min(width, height) * 0.035, 10);
  const trackingSize = Math.min(
    positiveNumber(trackingMarkerSizeOnBoardMm, defaultTrackingMarkerSize(width, height)),
    Math.min(width, height) - padding * 2
  );
  const trackingX = width / 2 + trackingMarkerPositionOnBoard.xMm - trackingSize / 2;
  const trackingY = height / 2 - trackingMarkerPositionOnBoard.yMm - trackingSize / 2;
  const labelFontSize = Math.max(Math.min(width, height) * 0.025, 10);
  const labelY = Math.min(height - padding, trackingY + trackingSize + labelFontSize * 1.7);
  const boardPattern = buildBoardPattern(boardStyle, width, height, padding);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${roundSvg(width)}mm" height="${roundSvg(height)}mm" viewBox="0 0 ${roundSvg(width)} ${roundSvg(height)}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${boardPattern}
  <g transform="translate(${roundSvg(trackingX)} ${roundSvg(trackingY)}) scale(${roundSvg(trackingSize / 256)})">
    ${trackingMarkerGeometry()}
  </g>
  <text x="${roundSvg(width / 2)}" y="${roundSvg(labelY)}" text-anchor="middle" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-size="${roundSvg(labelFontSize)}" font-weight="800">AR tracking marker</text>
  <text x="${roundSvg(width - padding)}" y="${roundSvg(height - padding)}" text-anchor="end" fill="#4b5563" font-family="Arial, Helvetica, sans-serif" font-size="${roundSvg(Math.max(labelFontSize * 0.64, 7))}" font-weight="700">Board/playground texture</text>
</svg>`;
}

export function trackingMarkerSvgMarkup() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${trackingMarkerGeometry()}</svg>`;
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

function normalizeMarkerStyleId(value: unknown): MarkerStyleId {
  return value === "checker" || value === "minimal" ? value : DEFAULT_MARKER_STYLE_ID;
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

function normalizeTrackingMarkerSize(value: unknown, widthMm: number, heightMm: number) {
  return positiveNumber(value, defaultTrackingMarkerSize(widthMm, heightMm));
}

function defaultTrackingMarkerSize(widthMm: number, heightMm: number) {
  const shortSide = Math.max(Math.min(widthMm, heightMm), 1);
  const reliableMinimum = Math.min(shortSide * 0.62, 70);
  return Math.round(Math.min(Math.max(shortSide * 0.36, reliableMinimum), shortSide * 0.62));
}

function normalizeTrackingMarkerPosition(
  position: MarkerSettings["trackingMarkerPositionOnBoard"] | null | undefined
) {
  return {
    xMm: finiteNumber(position?.xMm, 0),
    yMm: finiteNumber(position?.yMm, 0)
  };
}

function normalizeQrPlacement(placement: MarkerSettings["qrPlacement"] | null | undefined) {
  return {
    corner: "right" as const,
    sizeRatio: positiveNumber(placement?.sizeRatio, 0.18)
  };
}

function buildBoardPattern(styleId: MarkerStyleId, width: number, height: number, padding: number) {
  if (styleId === "checker") {
    return buildCheckerBoard(width, height, padding);
  }

  if (styleId === "minimal") {
    return buildMinimalBoard(width, height, padding);
  }

  return buildTechnicalBoard(width, height, padding);
}

function buildTechnicalBoard(width: number, height: number, padding: number) {
  const verticalLines = Array.from({ length: 11 }, (_, index) => {
    const x = (width * index) / 10;
    const weight = index === 5 ? 1.8 : 0.7;
    return `<line x1="${roundSvg(x)}" y1="${roundSvg(padding)}" x2="${roundSvg(x)}" y2="${roundSvg(height - padding)}" stroke="#cbd5e1" stroke-width="${weight}"/>`;
  }).join("");
  const horizontalLines = Array.from({ length: 9 }, (_, index) => {
    const y = (height * index) / 8;
    const weight = index === 4 ? 1.8 : 0.7;
    return `<line x1="${roundSvg(padding)}" y1="${roundSvg(y)}" x2="${roundSvg(width - padding)}" y2="${roundSvg(y)}" stroke="#cbd5e1" stroke-width="${weight}"/>`;
  }).join("");
  const centerSize = Math.min(width, height) * 0.075;

  return `<rect x="${roundSvg(padding)}" y="${roundSvg(padding)}" width="${roundSvg(width - padding * 2)}" height="${roundSvg(height - padding * 2)}" fill="#f8fafc" stroke="#111827" stroke-width="${roundSvg(Math.max(padding * 0.18, 4))}"/>
  ${verticalLines}
  ${horizontalLines}
  <line x1="${roundSvg(width / 2 - centerSize)}" y1="${roundSvg(height / 2)}" x2="${roundSvg(width / 2 + centerSize)}" y2="${roundSvg(height / 2)}" stroke="#ef4444" stroke-width="${roundSvg(Math.max(padding * 0.1, 2))}"/>
  <line x1="${roundSvg(width / 2)}" y1="${roundSvg(height / 2 - centerSize)}" x2="${roundSvg(width / 2)}" y2="${roundSvg(height / 2 + centerSize)}" stroke="#22c55e" stroke-width="${roundSvg(Math.max(padding * 0.1, 2))}"/>`;
}

function buildCheckerBoard(width: number, height: number, padding: number) {
  const columns = 16;
  const rows = Math.max(8, Math.round(columns * (height / width)));
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const cells = Array.from({ length: rows }).map((_, y) =>
    Array.from({ length: columns }).map((__, x) =>
      (x + y) % 2 === 0
        ? `<rect x="${roundSvg(padding + (innerWidth * x) / columns)}" y="${roundSvg(padding + (innerHeight * y) / rows)}" width="${roundSvg(innerWidth / columns)}" height="${roundSvg(innerHeight / rows)}" fill="#111827"/>`
        : ""
    ).join("")
  ).join("");

  return `<rect x="${roundSvg(padding)}" y="${roundSvg(padding)}" width="${roundSvg(innerWidth)}" height="${roundSvg(innerHeight)}" fill="#ffffff" stroke="#111827" stroke-width="${roundSvg(Math.max(padding * 0.18, 4))}"/>
  <g opacity="0.9">${cells}</g>
  <rect x="${roundSvg(width * 0.38)}" y="${roundSvg(height * 0.32)}" width="${roundSvg(width * 0.24)}" height="${roundSvg(height * 0.36)}" fill="#ffffff" opacity="0.92"/>`;
}

function buildMinimalBoard(width: number, height: number, padding: number) {
  return `<rect x="${roundSvg(padding)}" y="${roundSvg(padding)}" width="${roundSvg(width - padding * 2)}" height="${roundSvg(height - padding * 2)}" fill="#ffffff" stroke="#111827" stroke-width="${roundSvg(Math.max(padding * 0.2, 5))}"/>
  <rect x="${roundSvg(padding * 1.8)}" y="${roundSvg(padding * 1.8)}" width="${roundSvg(width - padding * 3.6)}" height="${roundSvg(height - padding * 3.6)}" fill="none" stroke="#111827" stroke-width="${roundSvg(Math.max(padding * 0.06, 1.5))}"/>
  <line x1="${roundSvg(width / 2)}" y1="${roundSvg(padding * 2)}" x2="${roundSvg(width / 2)}" y2="${roundSvg(height - padding * 2)}" stroke="#e5e7eb" stroke-width="${roundSvg(Math.max(padding * 0.06, 1.5))}"/>
  <line x1="${roundSvg(padding * 2)}" y1="${roundSvg(height / 2)}" x2="${roundSvg(width - padding * 2)}" y2="${roundSvg(height / 2)}" stroke="#e5e7eb" stroke-width="${roundSvg(Math.max(padding * 0.06, 1.5))}"/>`;
}

function trackingMarkerGeometry() {
  return `<rect width="256" height="256" fill="#ffffff"/>
  <rect width="256" height="256" fill="#000000"/>
  <rect x="32" y="32" width="192" height="192" fill="#ffffff"/>
  <rect x="52" y="52" width="58" height="58" fill="#000000"/>
  <rect x="136" y="52" width="68" height="34" fill="#000000"/>
  <rect x="148" y="86" width="34" height="94" fill="#000000"/>
  <rect x="72" y="144" width="96" height="34" fill="#000000"/>
  <rect x="184" y="164" width="24" height="44" fill="#000000"/>`;
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function roundSvg(value: number) {
  return String(Math.round(value * 1000) / 1000);
}
