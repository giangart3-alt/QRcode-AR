export const MARKER_IMAGE_URL = "/markers/playground.png";
export const MARKER_PATTERN_URL = "/markers/playground.patt";
export const DEFAULT_MARKER_WIDTH_MM = 1000;
export const DEFAULT_MARKER_HEIGHT_MM = 700;
export const DEFAULT_MARKER_STYLE_ID = "technical-grid";

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
  imageUrl: string;
  patternUrl: string;
  widthMm: number;
  heightMm: number;
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

export function createDefaultMarker(): MarkerSettings {
  return {
    styleId: DEFAULT_MARKER_STYLE_ID,
    imageUrl: MARKER_IMAGE_URL,
    patternUrl: MARKER_PATTERN_URL,
    widthMm: DEFAULT_MARKER_WIDTH_MM,
    heightMm: DEFAULT_MARKER_HEIGHT_MM,
    coordinateSystem: {
      origin: "center of marker/playground",
      xAxis: "left/right on marker",
      yAxis: "vertical height above marker",
      zAxis: "forward/back on marker",
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

  return {
    styleId: marker?.styleId || fallback.styleId,
    imageUrl: marker?.imageUrl || fallback.imageUrl,
    patternUrl: marker?.patternUrl || fallback.patternUrl,
    widthMm: positiveNumber(
      marker?.widthMm ?? (marker as { markerWidthMm?: number } | null | undefined)?.markerWidthMm,
      fallback.widthMm
    ),
    heightMm: positiveNumber(
      marker?.heightMm ?? (marker as { markerHeightMm?: number } | null | undefined)?.markerHeightMm,
      fallback.heightMm
    ),
    coordinateSystem: {
      origin: marker?.coordinateSystem?.origin || fallback.coordinateSystem.origin,
      xAxis: marker?.coordinateSystem?.xAxis || fallback.coordinateSystem.xAxis,
      yAxis: marker?.coordinateSystem?.yAxis || fallback.coordinateSystem.yAxis,
      zAxis: marker?.coordinateSystem?.zAxis || fallback.coordinateSystem.zAxis,
      units: "meters" as const
    }
  } satisfies MarkerSettings;
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
