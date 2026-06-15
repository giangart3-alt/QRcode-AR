export const MASTERPLAN_TARGET_IMAGE_URL = "/targets/masterplan-preview.jpg";
export const MASTERPLAN_TARGET_PREVIEW_URL = "/targets/masterplan-preview.jpg";
export const MASTERPLAN_TARGET_MIND_URL = "/targets/masterplan.mind";
export const MASTERPLAN_TARGET_PIXEL_WIDTH = 2048;
export const MASTERPLAN_TARGET_PIXEL_HEIGHT = 1700;
export const DEFAULT_TARGET_WIDTH_MM = 841;
export const DEFAULT_TARGET_HEIGHT_MM = Math.round(
  DEFAULT_TARGET_WIDTH_MM * (MASTERPLAN_TARGET_PIXEL_HEIGHT / MASTERPLAN_TARGET_PIXEL_WIDTH)
);

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

export type ImageTargetSettings = {
  trackingMode: "mindar-image";
  targetIndex: 0;
  imageUrl: string;
  previewUrl: string;
  mindUrl: string;
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
  const widthMm = positiveNumber(input?.widthMm, DEFAULT_TARGET_WIDTH_MM);
  const heightMm = positiveNumber(
    input?.heightMm,
    Math.round(widthMm * (MASTERPLAN_TARGET_PIXEL_HEIGHT / MASTERPLAN_TARGET_PIXEL_WIDTH))
  );

  return {
    trackingMode: "mindar-image",
    targetIndex: 0,
    imageUrl: MASTERPLAN_TARGET_IMAGE_URL,
    previewUrl: MASTERPLAN_TARGET_PREVIEW_URL,
    mindUrl: MASTERPLAN_TARGET_MIND_URL,
    widthMm,
    heightMm,
    correctionMode: normalizeCorrectionMode(input?.correctionMode),
    coordinateSystem: {
      origin: "center of the masterplan image target",
      xAxis: "horizontal on the image",
      yAxis: "vertical on the image",
      zAxis: "height above the image",
      units: "millimeters"
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
