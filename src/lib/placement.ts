export const LEGACY_PLAYGROUND_IMAGE_URL = "/markers/hiro/hiro.png";
export const HIRO_MARKER_ID = "hiro";
export const HIRO_MARKER_IMAGE_URL = "/markers/hiro/hiro.png";
export const HIRO_MARKER_PATTERN_URL = "/markers/hiro/hiro.patt";
export const DEFAULT_TRACKING_MARKER_ID = HIRO_MARKER_ID;
export const TRACKING_MARKER_IMAGE_URL = HIRO_MARKER_IMAGE_URL;
export const TRACKING_MARKER_PNG_URL = HIRO_MARKER_IMAGE_URL;
export const TRACKING_MARKER_PATTERN_URL = HIRO_MARKER_PATTERN_URL;
export const MARKER_IMAGE_URL = HIRO_MARKER_IMAGE_URL;
export const MARKER_PATTERN_URL = TRACKING_MARKER_PATTERN_URL;
export const DEFAULT_MARKER_SIZE_MM = 200;
export const DEFAULT_MARKER_WIDTH_MM = DEFAULT_MARKER_SIZE_MM;
export const DEFAULT_MARKER_HEIGHT_MM = DEFAULT_MARKER_SIZE_MM;
export const DEFAULT_MARKER_STYLE_ID = "hiro";
export const DEFAULT_SCREEN_PHYSICAL_WIDTH_MM = 600;

export type MarkerStyleId = "hiro";
export type MarkerOutputMode = "print" | "screen";
export type TrackingMarkerType = "pattern";

export const MARKER_STYLES: Array<{ id: MarkerStyleId; label: string }> = [
  { id: "hiro", label: "HIRO marker" }
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

export type MarkerBoardGeometry = {
  widthMm: number;
  heightMm: number;
  widthM: number;
  heightM: number;
  trackingMarkerSizeMm: number;
  trackingMarkerSizeM: number;
  trackingMarkerCenterMm: {
    xMm: number;
    yMm: number;
  };
  boardOffsetFromTrackingCenterMm: {
    xMm: number;
    yMm: number;
  };
  boardOffsetFromTrackingCenterM: {
    xM: number;
    yM: number;
  };
  trackingMarkerRectMm: {
    xMm: number;
    yMm: number;
    sizeMm: number;
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
  void input;
  const boardStyle = DEFAULT_MARKER_STYLE_ID;
  const outputMode = "print";
  const screen = null;
  const widthMm = DEFAULT_MARKER_SIZE_MM;
  const heightMm = DEFAULT_MARKER_SIZE_MM;
  const trackingMarkerSizeOnBoardMm = DEFAULT_MARKER_SIZE_MM;
  const trackingMarkerPositionOnBoard = { xMm: 0, yMm: 0 };
  const boardImageUrl = HIRO_MARKER_IMAGE_URL;

  return {
    styleId: boardStyle,
    boardStyle,
    outputMode,
    presetLabel: "HIRO 200mm",
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
    qrPlacement: normalizeQrPlacement(null),
    screen,
    coordinateSystem: {
      origin: "center of HIRO marker",
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
  void marker;
  return createDefaultMarker();
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
  void styleId;
  return boardImageUrlForStyle(styleId, DEFAULT_MARKER_WIDTH_MM, DEFAULT_MARKER_HEIGHT_MM);
}

export function getMarkerBoardImageUrl(marker: Pick<MarkerSettings, "boardImageUrl" | "imageUrl" | "boardStyle" | "widthMm" | "heightMm" | "trackingMarkerSizeOnBoardMm" | "trackingMarkerPositionOnBoard">) {
  void marker.boardImageUrl;
  void marker.imageUrl;
  void marker.boardStyle;
  void marker.widthMm;
  void marker.heightMm;
  void marker.trackingMarkerSizeOnBoardMm;
  void marker.trackingMarkerPositionOnBoard;

  return HIRO_MARKER_IMAGE_URL;
}

export function getTrackingMarkerPatternUrl(marker: Pick<MarkerSettings, "trackingMarkerPatternUrl" | "patternUrl">) {
  void marker;
  return HIRO_MARKER_PATTERN_URL;
}

export function boardImageUrlForStyle(
  styleId: string,
  widthMm: number,
  heightMm: number,
  trackingMarkerSizeOnBoardMm = defaultTrackingMarkerSize(widthMm, heightMm),
  trackingMarkerPositionOnBoard = { xMm: 0, yMm: 0 }
) {
  void styleId;
  void widthMm;
  void heightMm;
  void trackingMarkerSizeOnBoardMm;
  void trackingMarkerPositionOnBoard;
  return HIRO_MARKER_IMAGE_URL;
}

export function markerBoardImageDataUrlForStyle(
  styleId: string,
  widthMm: number,
  heightMm: number,
  trackingMarkerSizeOnBoardMm = defaultTrackingMarkerSize(widthMm, heightMm),
  trackingMarkerPositionOnBoard = { xMm: 0, yMm: 0 }
) {
  void styleId;
  void widthMm;
  void heightMm;
  void trackingMarkerSizeOnBoardMm;
  void trackingMarkerPositionOnBoard;

  return HIRO_MARKER_IMAGE_URL;
}

export function getMarkerBoardGeometry(
  marker: Pick<
    MarkerSettings,
    "widthMm" | "heightMm" | "trackingMarkerSizeOnBoardMm" | "trackingMarkerPositionOnBoard"
  >
): MarkerBoardGeometry {
  void marker;
  const widthMm = DEFAULT_MARKER_SIZE_MM;
  const heightMm = DEFAULT_MARKER_SIZE_MM;
  const trackingMarkerSizeMm = DEFAULT_MARKER_SIZE_MM;
  const trackingMarkerCenterMm = { xMm: 0, yMm: 0 };

  return {
    widthMm,
    heightMm,
    widthM: mmToMeters(widthMm),
    heightM: mmToMeters(heightMm),
    trackingMarkerSizeMm,
    trackingMarkerSizeM: mmToMeters(trackingMarkerSizeMm),
    trackingMarkerCenterMm,
    boardOffsetFromTrackingCenterMm: {
      xMm: -trackingMarkerCenterMm.xMm,
      yMm: -trackingMarkerCenterMm.yMm
    },
    boardOffsetFromTrackingCenterM: {
      xM: mmToMeters(-trackingMarkerCenterMm.xMm),
      yM: mmToMeters(-trackingMarkerCenterMm.yMm)
    },
    trackingMarkerRectMm: {
      xMm: widthMm / 2 + trackingMarkerCenterMm.xMm - trackingMarkerSizeMm / 2,
      yMm: heightMm / 2 - trackingMarkerCenterMm.yMm - trackingMarkerSizeMm / 2,
      sizeMm: trackingMarkerSizeMm
    }
  };
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
  void boardStyle;
  void widthMm;
  void heightMm;
  void trackingMarkerSizeOnBoardMm;
  void trackingMarkerPositionOnBoard;
  const size = DEFAULT_MARKER_SIZE_MM;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}">
  <image href="${HIRO_MARKER_IMAGE_URL}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>
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

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function defaultTrackingMarkerSize(widthMm: number, heightMm: number) {
  void widthMm;
  void heightMm;
  return DEFAULT_MARKER_SIZE_MM;
}

function normalizeQrPlacement(placement: MarkerSettings["qrPlacement"] | null | undefined) {
  return {
    corner: "right" as const,
    sizeRatio: positiveNumber(placement?.sizeRatio, 0.18)
  };
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
