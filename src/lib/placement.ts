export const MARKER_IMAGE_URL = "/markers/playground.png";
export const MARKER_PATTERN_URL = "/markers/playground.patt";
export const DEFAULT_MARKER_WIDTH_MM = 1000;
export const DEFAULT_MARKER_HEIGHT_MM = 700;

export type PlacementMetadata = {
  markerImage: string;
  markerWidthMm: number;
  markerHeightMm: number;
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

export function createDefaultPlacement(
  scale = 1,
  verticalOffset = 0
): PlacementMetadata {
  return {
    markerImage: MARKER_IMAGE_URL,
    markerWidthMm: DEFAULT_MARKER_WIDTH_MM,
    markerHeightMm: DEFAULT_MARKER_HEIGHT_MM,
    position: {
      x: 0,
      y: verticalOffset,
      z: 0
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0
    },
    scale
  };
}

export function normalizePlacement(
  placement: Partial<PlacementMetadata> | null | undefined,
  fallbackScale = 1,
  fallbackVerticalOffset = 0
): PlacementMetadata {
  const fallback = createDefaultPlacement(fallbackScale, fallbackVerticalOffset);

  return {
    markerImage: placement?.markerImage || fallback.markerImage,
    markerWidthMm: positiveNumber(placement?.markerWidthMm, fallback.markerWidthMm),
    markerHeightMm: positiveNumber(placement?.markerHeightMm, fallback.markerHeightMm),
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
    scale: positiveNumber(placement?.scale, fallback.scale)
  };
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
