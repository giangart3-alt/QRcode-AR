export const MASTERPLAN_TARGET_VERSION = "per-marker-ar-masterplan-v1";
export const MASTERPLAN_TARGET_IMAGE_URL = "/targets/masterplan-marker-frame.png";
export const MASTERPLAN_TARGET_PREVIEW_URL = MASTERPLAN_TARGET_IMAGE_URL;
export const MASTERPLAN_TARGET_MIND_URL = "/targets/masterplan-marker-frame.mind";
export const MASTERPLAN_TARGET_MANIFEST_URL = "/targets/masterplan-target-manifest.json";
export const MASTERPLAN_TARGET_PIXEL_WIDTH = 2048;
export const MASTERPLAN_TARGET_PIXEL_HEIGHT = 1345;
export const DEFAULT_TARGET_WIDTH_MM = 844.5;
export const DEFAULT_TARGET_HEIGHT_MM = 554.5;

export const LEGACY_MASTERPLAN_TARGET_IMAGE_URL = MASTERPLAN_TARGET_IMAGE_URL;
export const LEGACY_MASTERPLAN_TARGET_PREVIEW_URL = MASTERPLAN_TARGET_PREVIEW_URL;
export const LEGACY_MASTERPLAN_TARGET_MIND_URL = MASTERPLAN_TARGET_MIND_URL;
export const LEGACY_MASTERPLAN_TARGET_VERSION = MASTERPLAN_TARGET_VERSION;
export const LEGACY_MASTERPLAN_TARGET_PIXEL_WIDTH = MASTERPLAN_TARGET_PIXEL_WIDTH;
export const LEGACY_MASTERPLAN_TARGET_PIXEL_HEIGHT = MASTERPLAN_TARGET_PIXEL_HEIGHT;
export const LEGACY_MASTERPLAN_TARGET_WIDTH_MM = DEFAULT_TARGET_WIDTH_MM;
export const LEGACY_MASTERPLAN_TARGET_HEIGHT_MM = DEFAULT_TARGET_HEIGHT_MM;
export const LEGACY_MASTERPLAN_TARGET_MANIFEST_URL = MASTERPLAN_TARGET_MANIFEST_URL;

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
  format: "single-target";
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

export const MASTERPLAN_MARKER: MarkerSheetMarker = {
  id: "Masterplan",
  targetIndex: 0,
  assetPng: "masterplan-marker-frame.png",
  assetSvg: "",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  widthMm: DEFAULT_TARGET_WIDTH_MM,
  heightMm: DEFAULT_TARGET_HEIGHT_MM,
  rotationDeg: 0,
  role: "single-target-masterplan",
  pattern: "full-masterplan-image"
};

export const MASTERPLAN_MARKER_SHEET: MarkerSheetSettings = {
  sheetId: "per-marker-ar-masterplan",
  version: MASTERPLAN_TARGET_VERSION,
  format: "single-target",
  orientation: "landscape",
  manifestUrl: MASTERPLAN_TARGET_MANIFEST_URL,
  maxTrack: 1,
  contentArea: {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  },
  markers: [MASTERPLAN_MARKER]
};

export const LEGACY_MASTERPLAN_MARKER_SHEET = MASTERPLAN_MARKER_SHEET;

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
  const resetTargetGeometry = isArchivedTargetInput(input);
  const widthMm = positiveNumber(
    resetTargetGeometry ? undefined : input?.widthMm,
    DEFAULT_TARGET_WIDTH_MM
  );
  const heightMm = positiveNumber(
    resetTargetGeometry ? undefined : input?.heightMm,
    DEFAULT_TARGET_HEIGHT_MM
  );

  return {
    trackingMode: "mindar-image",
    targetIndex: 0,
    targetVersion: MASTERPLAN_TARGET_VERSION,
    imageUrl: MASTERPLAN_TARGET_IMAGE_URL,
    previewUrl: MASTERPLAN_TARGET_PREVIEW_URL,
    mindUrl: MASTERPLAN_TARGET_MIND_URL,
    pixelWidth: MASTERPLAN_TARGET_PIXEL_WIDTH,
    pixelHeight: MASTERPLAN_TARGET_PIXEL_HEIGHT,
    widthMm,
    heightMm,
    correctionMode: normalizeCorrectionMode(input?.correctionMode),
    coordinateSystem: {
      origin: "center of the single masterplan MindAR target",
      xAxis: "right on the printed target",
      yAxis: "up on the printed target",
      zAxis: "normal above the printed target",
      units: "millimeters"
    },
    markerSheet: createMasterplanMarkerSheet(widthMm, heightMm)
  };
}

export function createLegacyMasterplanTarget(
  input?: Partial<ImageTargetSettings>
): ImageTargetSettings {
  return createDefaultTarget(input);
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

function createMasterplanMarkerSheet(widthMm: number, heightMm: number): MarkerSheetSettings {
  return {
    ...MASTERPLAN_MARKER_SHEET,
    markers: [
      {
        ...MASTERPLAN_MARKER,
        widthMm,
        heightMm
      }
    ]
  };
}

function isArchivedTargetInput(input: Partial<ImageTargetSettings> | undefined) {
  if (!input) return false;

  const markerCount = Array.isArray(input.markerSheet?.markers)
    ? input.markerSheet.markers.length
    : 0;

  return (
    (typeof input.targetVersion === "string" && input.targetVersion !== MASTERPLAN_TARGET_VERSION) ||
    (typeof input.imageUrl === "string" && input.imageUrl !== MASTERPLAN_TARGET_IMAGE_URL) ||
    (typeof input.previewUrl === "string" && input.previewUrl !== MASTERPLAN_TARGET_PREVIEW_URL) ||
    (typeof input.mindUrl === "string" && input.mindUrl !== MASTERPLAN_TARGET_MIND_URL) ||
    markerCount > 1 ||
    (typeof input.markerSheet?.sheetId === "string" &&
      input.markerSheet.sheetId !== MASTERPLAN_MARKER_SHEET.sheetId)
  );
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
