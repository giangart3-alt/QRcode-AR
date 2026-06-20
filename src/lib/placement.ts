export const MARKER_SHEET_A0_ID = "marker-sheet-a0-v1";
export const MARKER_SHEET_A0_VERSION = "1.0.0";
export const MARKER_SHEET_A0_TARGET_VERSION = `${MARKER_SHEET_A0_ID}@${MARKER_SHEET_A0_VERSION}`;
export const MARKER_SHEET_A0_IMAGE_URL = `/tracking-sheets/${MARKER_SHEET_A0_ID}/layout-preview-a0.png`;
export const MARKER_SHEET_A0_PREVIEW_URL = MARKER_SHEET_A0_IMAGE_URL;
export const MARKER_SHEET_A0_MIND_URL = `/tracking-sheets/${MARKER_SHEET_A0_ID}/${MARKER_SHEET_A0_ID}.mind`;
export const MARKER_SHEET_A0_MANIFEST_URL = `/tracking-sheets/${MARKER_SHEET_A0_ID}/tracking-sheet-manifest.json`;
export const MARKER_SHEET_A0_PIXEL_WIDTH = 3567;
export const MARKER_SHEET_A0_PIXEL_HEIGHT = 2523;
export const DEFAULT_TARGET_WIDTH_MM = 1189;
export const DEFAULT_TARGET_HEIGHT_MM = 841;

export const LEGACY_MASTERPLAN_TARGET_IMAGE_URL = "/targets/masterplan-marker-frame.png";
export const LEGACY_MASTERPLAN_TARGET_PREVIEW_URL = "/targets/masterplan-marker-frame.png";
export const LEGACY_MASTERPLAN_TARGET_MIND_URL = "/targets/masterplan-marker-frame.mind";
export const LEGACY_MASTERPLAN_TARGET_VERSION = "marker-frame-masterplan-v1";

export const MASTERPLAN_TARGET_VERSION = MARKER_SHEET_A0_TARGET_VERSION;
export const MASTERPLAN_TARGET_IMAGE_URL = MARKER_SHEET_A0_IMAGE_URL;
export const MASTERPLAN_TARGET_PREVIEW_URL = MARKER_SHEET_A0_PREVIEW_URL;
export const MASTERPLAN_TARGET_MIND_URL = MARKER_SHEET_A0_MIND_URL;
export const MASTERPLAN_TARGET_PIXEL_WIDTH = MARKER_SHEET_A0_PIXEL_WIDTH;
export const MASTERPLAN_TARGET_PIXEL_HEIGHT = MARKER_SHEET_A0_PIXEL_HEIGHT;

export const MODEL_CORRECTION_MODES = [
  "NONE",
  "X_PLUS_90",
  "X_MINUS_90",
  "Y_PLUS_90",
  "Y_MINUS_90",
  "Z_PLUS_90",
  "Z_MINUS_90"
] as const;

export type ModelCorrectionMode = (typeof MODEL_CORRECTION_MODES)[number];

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
};

export type MarkerSheetMarker = {
  id: string;
  targetIndex: number;
  assetPng: string;
  assetSvg: string;
  x: number;
  y: number;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  role: string;
  pattern?: string;
};

export type MarkerSheetSettings = {
  sheetId: string;
  version: string;
  format: "A0";
  orientation: "landscape";
  manifestUrl: string;
  maxTrack: number;
  contentArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  markers: MarkerSheetMarker[];
};

export type ImageTargetSettings = {
  trackingMode: "mindar-image";
  targetIndex: number;
  targetVersion: string;
  imageUrl: string;
  previewUrl: string;
  mindUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  widthMm: number;
  heightMm: number;
  correctionMode: ModelCorrectionMode;
  coordinateSystem: {
    origin: string;
    xAxis: string;
    yAxis: string;
    zAxis: string;
    units: "millimeters";
  };
  markerSheet: MarkerSheetSettings;
};

export const MARKER_SHEET_A0_MARKERS: MarkerSheetMarker[] = [
  {
    id: "M00_TopLeft",
    targetIndex: 0,
    assetPng: "markers/M00_TopLeft.png",
    assetSvg: "markers/M00_TopLeft.svg",
    x: 0.05,
    y: 0.06,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 0,
    role: "top-left",
    pattern: "asymmetric-nested-square"
  },
  {
    id: "M01_Top",
    targetIndex: 1,
    assetPng: "markers/M01_Top.png",
    assetSvg: "markers/M01_Top.svg",
    x: 0.464634,
    y: 0.06,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 0,
    role: "top-center",
    pattern: "offset-diamond"
  },
  {
    id: "M02_TopRight",
    targetIndex: 2,
    assetPng: "markers/M02_TopRight.png",
    assetSvg: "markers/M02_TopRight.svg",
    x: 0.879268,
    y: 0.06,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 0,
    role: "top-right",
    pattern: "diagonal-split"
  },
  {
    id: "M03_Left",
    targetIndex: 3,
    assetPng: "markers/M03_Left.png",
    assetSvg: "markers/M03_Left.svg",
    x: 0.05,
    y: 0.45,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: -90,
    role: "left-center",
    pattern: "bullseye-notch"
  },
  {
    id: "M04_Right",
    targetIndex: 4,
    assetPng: "markers/M04_Right.png",
    assetSvg: "markers/M04_Right.svg",
    x: 0.879268,
    y: 0.45,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 90,
    role: "right-center",
    pattern: "blocky-modules"
  },
  {
    id: "M05_BottomLeft",
    targetIndex: 5,
    assetPng: "markers/M05_BottomLeft.png",
    assetSvg: "markers/M05_BottomLeft.svg",
    x: 0.05,
    y: 0.84,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 180,
    role: "bottom-left",
    pattern: "crosshair-corners"
  },
  {
    id: "M06_Bottom",
    targetIndex: 6,
    assetPng: "markers/M06_Bottom.png",
    assetSvg: "markers/M06_Bottom.svg",
    x: 0.464634,
    y: 0.84,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 180,
    role: "bottom-center",
    pattern: "staircase"
  },
  {
    id: "M07_BottomRight",
    targetIndex: 7,
    assetPng: "markers/M07_BottomRight.png",
    assetSvg: "markers/M07_BottomRight.svg",
    x: 0.879268,
    y: 0.84,
    width: 0.070732,
    height: 0.1,
    widthMm: 84.1,
    heightMm: 84.1,
    rotationDeg: 180,
    role: "bottom-right",
    pattern: "quadrant-cutout"
  }
];

export const MARKER_SHEET_A0: MarkerSheetSettings = {
  sheetId: MARKER_SHEET_A0_ID,
  version: MARKER_SHEET_A0_VERSION,
  format: "A0",
  orientation: "landscape",
  manifestUrl: MARKER_SHEET_A0_MANIFEST_URL,
  maxTrack: 2,
  contentArea: {
    x: 0.18,
    y: 0.17,
    width: 0.64,
    height: 0.66
  },
  markers: MARKER_SHEET_A0_MARKERS
};

export type ImageTargetGeometry = {
  widthMm: number;
  heightMm: number;
  widthM: number;
  heightM: number;
  aspectRatio: number;
  normalizedHeight: number;
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

export function createDefaultTarget(input?: Partial<ImageTargetSettings>): ImageTargetSettings {
  const legacyTarget = isLegacyTargetInput(input);
  const widthMm = positiveNumber(legacyTarget ? undefined : input?.widthMm, DEFAULT_TARGET_WIDTH_MM);
  const heightMm = positiveNumber(
    legacyTarget ? undefined : input?.heightMm,
    DEFAULT_TARGET_HEIGHT_MM
  );
  const markerSheet = normalizeMarkerSheet(legacyTarget ? undefined : input?.markerSheet);

  return {
    trackingMode: "mindar-image",
    targetIndex: nonNegativeInteger(legacyTarget ? undefined : input?.targetIndex, 0),
    targetVersion: normalizeTargetVersion(input?.targetVersion),
    imageUrl: normalizeTargetUrl(input?.imageUrl, MARKER_SHEET_A0_IMAGE_URL),
    previewUrl: normalizeTargetUrl(input?.previewUrl, MARKER_SHEET_A0_PREVIEW_URL),
    mindUrl: normalizeTargetUrl(input?.mindUrl, MARKER_SHEET_A0_MIND_URL),
    pixelWidth: positiveNumber(legacyTarget ? undefined : input?.pixelWidth, MARKER_SHEET_A0_PIXEL_WIDTH),
    pixelHeight: positiveNumber(legacyTarget ? undefined : input?.pixelHeight, MARKER_SHEET_A0_PIXEL_HEIGHT),
    widthMm,
    heightMm,
    correctionMode: normalizeCorrectionMode(input?.correctionMode),
    coordinateSystem: {
      origin: "center of the A0 marker sheet reconstructed from local markers",
      xAxis: "right on the printed sheet",
      yAxis: "up on the printed sheet",
      zAxis: "normal above the printed sheet",
      units: "millimeters"
    },
    markerSheet
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
      x: normalizeDegrees(finiteNumber(placement?.rotation?.x, fallback.rotation.x)),
      y: normalizeDegrees(finiteNumber(placement?.rotation?.y, fallback.rotation.y)),
      z: normalizeDegrees(finiteNumber(placement?.rotation?.z, fallback.rotation.z))
    },
    scale: positiveNumber(placement?.scale, fallback.scale)
  };
}

export function normalizeTarget(target: Partial<ImageTargetSettings> | null | undefined) {
  return createDefaultTarget(target || undefined);
}

export function getImageTargetGeometry(
  target: Pick<ImageTargetSettings, "widthMm" | "heightMm">
): ImageTargetGeometry {
  const widthMm = positiveNumber(target.widthMm, DEFAULT_TARGET_WIDTH_MM);
  const heightMm = positiveNumber(target.heightMm, DEFAULT_TARGET_HEIGHT_MM);
  const widthM = mmToMeters(widthMm);
  const heightM = mmToMeters(heightMm);

  return {
    widthMm,
    heightMm,
    widthM,
    heightM,
    aspectRatio: widthMm / heightMm,
    normalizedHeight: heightMm / widthMm
  };
}

export function correctionRotationRadians(mode: ModelCorrectionMode) {
  switch (mode) {
    case "X_PLUS_90":
      return { x: Math.PI / 2, y: 0, z: 0 };
    case "X_MINUS_90":
      return { x: -Math.PI / 2, y: 0, z: 0 };
    case "Y_PLUS_90":
      return { x: 0, y: Math.PI / 2, z: 0 };
    case "Y_MINUS_90":
      return { x: 0, y: -Math.PI / 2, z: 0 };
    case "Z_PLUS_90":
      return { x: 0, y: 0, z: Math.PI / 2 };
    case "Z_MINUS_90":
      return { x: 0, y: 0, z: -Math.PI / 2 };
    case "NONE":
    default:
      return { x: 0, y: 0, z: 0 };
  }
}

export function normalizeCorrectionMode(value: unknown): ModelCorrectionMode {
  return MODEL_CORRECTION_MODES.includes(value as ModelCorrectionMode)
    ? (value as ModelCorrectionMode)
    : "NONE";
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

export function normalizeDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return Math.abs(normalized) < 0.000001 ? 0 : normalized;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeTargetVersion(value: unknown) {
  const version = stringOr(value, MARKER_SHEET_A0_TARGET_VERSION);
  return version === LEGACY_MASTERPLAN_TARGET_VERSION ? MARKER_SHEET_A0_TARGET_VERSION : version;
}

function isLegacyTargetInput(input: Partial<ImageTargetSettings> | undefined) {
  return (
    input?.targetVersion === LEGACY_MASTERPLAN_TARGET_VERSION ||
    input?.imageUrl === LEGACY_MASTERPLAN_TARGET_IMAGE_URL ||
    input?.previewUrl === LEGACY_MASTERPLAN_TARGET_PREVIEW_URL ||
    input?.mindUrl === LEGACY_MASTERPLAN_TARGET_MIND_URL
  );
}

function normalizeTargetUrl(value: unknown, fallback: string) {
  const url = stringOr(value, fallback);
  if (
    url === LEGACY_MASTERPLAN_TARGET_IMAGE_URL ||
    url === LEGACY_MASTERPLAN_TARGET_PREVIEW_URL ||
    url === LEGACY_MASTERPLAN_TARGET_MIND_URL
  ) {
    return fallback;
  }
  return url;
}

function normalizeMarkerSheet(value: unknown): MarkerSheetSettings {
  const input = isRecord(value) ? value : {};
  const markers = Array.isArray(input.markers)
    ? input.markers.map(normalizeMarkerSheetMarker).filter((marker): marker is MarkerSheetMarker => Boolean(marker))
    : MARKER_SHEET_A0_MARKERS;

  return {
    sheetId: stringOr(input.sheetId, MARKER_SHEET_A0.sheetId),
    version: stringOr(input.version, MARKER_SHEET_A0.version),
    format: "A0",
    orientation: "landscape",
    manifestUrl: stringOr(input.manifestUrl, MARKER_SHEET_A0.manifestUrl),
    maxTrack: positiveNumber(input.maxTrack, MARKER_SHEET_A0.maxTrack),
    contentArea: isRecord(input.contentArea)
      ? {
          x: finiteNumber(input.contentArea.x, MARKER_SHEET_A0.contentArea.x),
          y: finiteNumber(input.contentArea.y, MARKER_SHEET_A0.contentArea.y),
          width: positiveNumber(input.contentArea.width, MARKER_SHEET_A0.contentArea.width),
          height: positiveNumber(input.contentArea.height, MARKER_SHEET_A0.contentArea.height)
        }
      : MARKER_SHEET_A0.contentArea,
    markers: markers.length ? markers : MARKER_SHEET_A0_MARKERS
  };
}

function normalizeMarkerSheetMarker(value: unknown): MarkerSheetMarker | null {
  if (!isRecord(value)) return null;
  const targetIndex = nonNegativeInteger(value.targetIndex, -1);
  if (targetIndex < 0) return null;

  return {
    id: stringOr(value.id, `M${targetIndex}`),
    targetIndex,
    assetPng: stringOr(value.assetPng, ""),
    assetSvg: stringOr(value.assetSvg, ""),
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    width: positiveNumber(value.width, MARKER_SHEET_A0_MARKERS[0]?.width || 0.070732),
    height: positiveNumber(value.height, MARKER_SHEET_A0_MARKERS[0]?.height || 0.1),
    widthMm: positiveNumber(value.widthMm, MARKER_SHEET_A0_MARKERS[0]?.widthMm || 84.1),
    heightMm: positiveNumber(value.heightMm, MARKER_SHEET_A0_MARKERS[0]?.heightMm || 84.1),
    rotationDeg: finiteNumber(value.rotationDeg, 0),
    role: stringOr(value.role, ""),
    pattern: typeof value.pattern === "string" ? value.pattern : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
