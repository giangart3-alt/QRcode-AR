"use client";

import Link from "next/link";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { applyMindARBoardSpaceRoot } from "@/lib/coordinates";
import {
  MASTERPLAN_TARGET_IMAGE_URL,
  MASTERPLAN_TARGET_MIND_URL,
  MASTERPLAN_TARGET_PIXEL_HEIGHT,
  MASTERPLAN_TARGET_PIXEL_WIDTH,
  MASTERPLAN_TARGET_VERSION,
  getImageTargetGeometry,
  type ImageTargetSettings,
  type MarkerSheetMarker,
  type PlacementMetadata,
  type ModelCorrectionMode
} from "@/lib/placement";
import {
  applyRuntimeSceneTransform,
  configureModelCorrectionHierarchy,
  computeSceneTransformForRuntime,
  type ModelBoundsInfo,
  type ModelCorrectionMetrics
} from "@/lib/scene-transform";
import { collectModelPerformanceStats } from "@/lib/model-stats";
import type { ProjectMetadata, SceneMetadata } from "@/lib/projects";
import { loadGltfModel } from "@/lib/three-gltf";

type MindARUpdate = {
  type: string;
  targetIndex?: number;
  worldMatrix?: number[] | null;
};

type MindARController = {
  inputWidth: number;
  inputHeight: number;
  addImageTargets(src: string): Promise<{ dimensions: Array<[number, number]> }>;
  dummyRun(video: HTMLVideoElement): Promise<void>;
  processVideo(video: HTMLVideoElement): void;
  stopProcessVideo(): void;
  getProjectionMatrix(): number[];
};

type MindARImageRuntime = {
  Controller: new (options: {
    inputWidth: number;
    inputHeight: number;
    maxTrack?: number;
    filterMinCF?: number | null;
    filterBeta?: number | null;
    warmupTolerance?: number | null;
    missTolerance?: number | null;
    onUpdate?: (data: MindARUpdate) => void;
  }) => MindARController;
};

const MINDAR_IMAGE_RUNTIME_URL = "/vendor/mind-ar/mindar-image.prod.js";
const AR_STABILITY_STORAGE_KEY = "qrcode-ar:stability-mode";
const AR_TRACKING_MODE_STORAGE_KEY = "qrcode-ar:tracking-mode";

type ARStabilityMode = "realtime" | "balanced" | "stable" | "presentation-lock";
type ARTrackingMode = "auto" | "mindar-image" | "webxr-world" | "arkit-ios";
type TrackingProviderId = "mindar-image" | "webxr-world" | "arkit-ios" | "commercial-placeholder";

type ARStabilityConfig = {
  label: string;
  positionDeadzoneWorldUnits: number;
  rotationDeadzoneRad: number;
  scaleDeadzone: number;
  minAlphaAt60Fps: number;
  maxAlphaAt60Fps: number;
  positionCatchupWorldUnits: number;
  rotationCatchupRad: number;
  scaleCatchup: number;
  pixelRatioMax: number;
  shortHoldMs: number;
  extendedHoldMs: number;
  lockAcquireStableMs: number;
  lockAcquirePositionThresholdNormalized: number;
  lockReleaseStableMs: number;
  lockReleasePositionThresholdNormalized: number;
  lockReleaseRotationRad: number;
  lockReleaseScale: number;
  relockBlendMs: number;
};

type TrackingProviderSupport = {
  supported: boolean;
  status: "supported" | "unsupported" | "future" | "experimental";
  reason: string;
  details?: Record<string, unknown>;
};

type TrackingProviderSupportMap = Record<TrackingProviderId, TrackingProviderSupport>;

type DeviceProfile = {
  userAgent: string;
  platform: string;
  isAndroid: boolean;
  isIOS: boolean;
  isMobile: boolean;
  browser: string;
  iOSUsesWebKit: boolean;
};

type TrackingPoseUpdate = {
  matrix: THREE.Matrix4;
  timestampMs: number;
  targetIndex: number;
  markerId: string;
  markerRole: string;
  visibleMarkerCount: number;
  poseSource: MultiMarkerPoseSource;
};

type TrackingState = {
  providerId: TrackingProviderId;
  label: string;
  initialized: boolean;
  running: boolean;
  targetVisible: boolean;
  activeTargetIndex: number;
  activeMarkerId: string;
  activeMarkerRole: string;
  visibleMarkerCount: number;
  poseSource: MultiMarkerPoseSource | "";
  status: string;
  foundCount: number;
  lostCount: number;
  lastFoundAtMs: number;
  lastLostAtMs: number;
  fallbackReason: string;
};

type TrackingCameraCalibration = {
  projectionMatrix: number[];
  inputWidth: number;
  inputHeight: number;
} | null;

type TrackingProviderContext = {
  video: HTMLVideoElement;
  target: ImageTargetSettings;
};

type MultiMarkerPoseSource = "single-marker" | "fused-markers";

type VisibleMarkerPose = {
  marker: MarkerSheetMarker;
  markerMatrix: THREE.Matrix4;
  sheetMatrix: THREE.Matrix4;
  updatedAtMs: number;
  targetDimensions: [number, number];
};

type TrackingProvider = {
  readonly id: TrackingProviderId;
  readonly label: string;
  isSupported(): Promise<TrackingProviderSupport>;
  init(context: TrackingProviderContext): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
  getTrackingState(): TrackingState;
  getCameraCalibration(): TrackingCameraCalibration;
  onPoseUpdate(callback: (pose: TrackingPoseUpdate) => void): () => void;
  onTargetFound(callback: () => void): () => void;
  onTargetLost(callback: () => void): () => void;
  getDebugState(): Record<string, unknown>;
};

const DEFAULT_STABILITY_MODE: ARStabilityMode = "balanced";
const DEFAULT_TRACKING_MODE: ARTrackingMode = "auto";

const AR_STABILITY_MODES: ARStabilityMode[] = ["realtime", "balanced", "stable", "presentation-lock"];
const AR_TRACKING_MODES: ARTrackingMode[] = ["auto", "mindar-image", "webxr-world", "arkit-ios"];
const LOCK_CANDIDATE_ALPHA_AT_60_FPS = 0.18;
const LOCK_MIN_STABLE_SAMPLES = 8;

const AR_STABILITY_CONFIGS: Record<ARStabilityMode, ARStabilityConfig> = {
  realtime: {
    label: "Realtime",
    positionDeadzoneWorldUnits: 0.0003,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.08),
    scaleDeadzone: 0.0006,
    minAlphaAt60Fps: 0.65,
    maxAlphaAt60Fps: 0.98,
    positionCatchupWorldUnits: 0.025,
    rotationCatchupRad: THREE.MathUtils.degToRad(5),
    scaleCatchup: 0.02,
    pixelRatioMax: 2,
    shortHoldMs: 0,
    extendedHoldMs: 0,
    lockAcquireStableMs: 0,
    lockAcquirePositionThresholdNormalized: 0.02,
    lockReleaseStableMs: 0,
    lockReleasePositionThresholdNormalized: 0.04,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(4),
    lockReleaseScale: 0.02,
    relockBlendMs: 0
  },
  balanced: {
    label: "Balanced",
    positionDeadzoneWorldUnits: 0.0012,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.25),
    scaleDeadzone: 0.0015,
    minAlphaAt60Fps: 0.18,
    maxAlphaAt60Fps: 0.76,
    positionCatchupWorldUnits: 0.035,
    rotationCatchupRad: THREE.MathUtils.degToRad(7),
    scaleCatchup: 0.03,
    pixelRatioMax: 2,
    shortHoldMs: 0,
    extendedHoldMs: 0,
    lockAcquireStableMs: 0,
    lockAcquirePositionThresholdNormalized: 0.03,
    lockReleaseStableMs: 0,
    lockReleasePositionThresholdNormalized: 0.06,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(6),
    lockReleaseScale: 0.03,
    relockBlendMs: 0
  },
  stable: {
    label: "Stable",
    positionDeadzoneWorldUnits: 0.0025,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.55),
    scaleDeadzone: 0.0025,
    minAlphaAt60Fps: 0.08,
    maxAlphaAt60Fps: 0.55,
    positionCatchupWorldUnits: 0.05,
    rotationCatchupRad: THREE.MathUtils.degToRad(10),
    scaleCatchup: 0.04,
    pixelRatioMax: 1.5,
    shortHoldMs: 0,
    extendedHoldMs: 0,
    lockAcquireStableMs: 0,
    lockAcquirePositionThresholdNormalized: 0.04,
    lockReleaseStableMs: 0,
    lockReleasePositionThresholdNormalized: 0.08,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(8),
    lockReleaseScale: 0.04,
    relockBlendMs: 0
  },
  "presentation-lock": {
    label: "Presentation Lock",
    positionDeadzoneWorldUnits: 0.003,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.65),
    scaleDeadzone: 0.003,
    minAlphaAt60Fps: 0.06,
    maxAlphaAt60Fps: 0.42,
    positionCatchupWorldUnits: 0.055,
    rotationCatchupRad: THREE.MathUtils.degToRad(10),
    scaleCatchup: 0.045,
    pixelRatioMax: 1.5,
    shortHoldMs: 3000,
    extendedHoldMs: 8000,
    lockAcquireStableMs: 700,
    lockAcquirePositionThresholdNormalized: 0.08,
    lockReleaseStableMs: 500,
    lockReleasePositionThresholdNormalized: 0.18,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(8),
    lockReleaseScale: 0.045,
    relockBlendMs: 750
  }
};

const TRACKING_MODE_LABELS: Record<ARTrackingMode, string> = {
  auto: "Auto",
  "mindar-image": "MindAR Image",
  "webxr-world": "WebXR World",
  "arkit-ios": "Future iOS ARKit"
};

const TRACKING_PROVIDER_LABELS: Record<TrackingProviderId, string> = {
  "mindar-image": "MindAR Image",
  "webxr-world": "WebXR World",
  "arkit-ios": "Future iOS ARKit",
  "commercial-placeholder": "8th Wall / Zappar Placeholder"
};

const DEFAULT_TRACKING_SUPPORT: TrackingProviderSupportMap = {
  "mindar-image": {
    supported: true,
    status: "supported",
    reason: "Universal web fallback using camera image tracking."
  },
  "webxr-world": {
    supported: false,
    status: "unsupported",
    reason: "WebXR support has not been checked yet."
  },
  "arkit-ios": {
    supported: false,
    status: "future",
    reason: "Reserved for a future native iOS App Clip / ARKit adapter."
  },
  "commercial-placeholder": {
    supported: false,
    status: "future",
    reason: "Reserved for future commercial providers such as 8th Wall or Zappar."
  }
};

type PublicStatus =
  | "camera loading"
  | "target searching"
  | "target found"
  | "target lost"
  | "target lost - holding position"
  | "target lost - move camera back to target"
  | "target re-aligning"
  | "loading model"
  | "model loaded"
  | "model error";

type VectorDebug = {
  x: number;
  y: number;
  z: number;
};

type TransformDebug = {
  position: VectorDebug;
  rotation: VectorDebug;
  scale: VectorDebug;
};

type BoundsDebug = {
  min: VectorDebug;
  max: VectorDebug;
  size: VectorDebug;
  valid: boolean;
};

type ResizeDebugState = {
  canvasResizeCount: number;
  rendererSetSizeCount: number;
  arSceneRemountCount: number;
  lastResizeReason: string;
  lastRendererSize: {
    width: number;
    height: number;
  };
};

type RuntimeStatus = {
  trackingMode: string;
  selectedTrackingMode: ARTrackingMode;
  activeTrackingProvider: TrackingProviderId | "";
  activeTrackingProviderLabel: string;
  trackingProviderFallbackReason: string;
  trackingSupport: TrackingProviderSupportMap;
  deviceProfile: DeviceProfile | null;
  projectLoading: boolean;
  projectLoaded: boolean;
  cameraActive: boolean;
  mindARInitialized: boolean;
  targetFound: boolean;
  targetLost: boolean;
  targetIndex: number;
  trackingSheetId: string;
  trackingSheetVersion: string;
  trackingSheetFormat: string;
  activeMarkerId: string;
  activeMarkerRole: string;
  visibleMarkerCount: number;
  poseSource: MultiMarkerPoseSource | "";
  imageTargetLoaded: boolean;
  imageTargetVersion: string;
  imageTargetSrc: string;
  imageTargetImage: string;
  imageTargetPixelSize: {
    width: number;
    height: number;
    aspectRatio: number;
  };
  activeProjectId: string;
  activeSceneId: string;
  activeSceneName: string;
  modelLoading: boolean;
  modelLoaded: boolean;
  modelError: string;
  modelAttachedToTarget: boolean;
  modelUrl: string;
  modelPathname: string;
  modelLocalTransform: TransformDebug | null;
  modelWorldTransform: TransformDebug | null;
  desktopViewportTransform: TransformDebug | null;
  canonicalPlacement: PlacementMetadata | null;
  editorAppliedTransform: TransformDebug | null;
  mindARAppliedTransform: TransformDebug | null;
  correctionRootTransform: TransformDebug | null;
  scaleRootTransform: TransformDebug | null;
  rawBounds: BoundsDebug | null;
  correctedBounds: BoundsDebug | null;
  boundsBeforeCorrection: BoundsDebug | null;
  boundsAfterCorrection: BoundsDebug | null;
  longestDimensionAxisAfterTransforms: string;
  currentCorrectionMode: ModelCorrectionMode;
  targetPhysicalSize: {
    widthMm: number;
    heightMm: number;
    widthM: number;
    heightM: number;
    aspectRatio: number;
    normalizedHeight: number;
  };
  lastKnownGoodSheetPoseAgeMs: number;
  runtimeScale: {
    baseFitScale: number;
    displayedScale: number;
    mindARScale: number;
    boundsValid: boolean;
    scaleFallbackReason: string;
  } | null;
  lastError: string;
};

const INITIAL_TARGET_SIZE = targetSizeDebug({
  widthMm: 841,
  heightMm: 698
});

const INITIAL_STATUS: RuntimeStatus = {
  trackingMode: "MindAR Image",
  selectedTrackingMode: DEFAULT_TRACKING_MODE,
  activeTrackingProvider: "",
  activeTrackingProviderLabel: "",
  trackingProviderFallbackReason: "",
  trackingSupport: DEFAULT_TRACKING_SUPPORT,
  deviceProfile: null,
  projectLoading: true,
  projectLoaded: false,
  cameraActive: false,
  mindARInitialized: false,
  targetFound: false,
  targetLost: false,
  targetIndex: 0,
  trackingSheetId: "",
  trackingSheetVersion: "",
  trackingSheetFormat: "",
  activeMarkerId: "",
  activeMarkerRole: "",
  visibleMarkerCount: 0,
  poseSource: "",
  imageTargetLoaded: false,
  imageTargetVersion: MASTERPLAN_TARGET_VERSION,
  imageTargetSrc: MASTERPLAN_TARGET_MIND_URL,
  imageTargetImage: MASTERPLAN_TARGET_IMAGE_URL,
  imageTargetPixelSize: targetPixelSizeDebug({
    pixelWidth: MASTERPLAN_TARGET_PIXEL_WIDTH,
    pixelHeight: MASTERPLAN_TARGET_PIXEL_HEIGHT
  }),
  activeProjectId: "",
  activeSceneId: "",
  activeSceneName: "",
  modelLoading: false,
  modelLoaded: false,
  modelError: "",
  modelAttachedToTarget: false,
  modelUrl: "",
  modelPathname: "",
  modelLocalTransform: null,
  modelWorldTransform: null,
  desktopViewportTransform: null,
  canonicalPlacement: null,
  editorAppliedTransform: null,
  mindARAppliedTransform: null,
  correctionRootTransform: null,
  scaleRootTransform: null,
  rawBounds: null,
  correctedBounds: null,
  boundsBeforeCorrection: null,
  boundsAfterCorrection: null,
  longestDimensionAxisAfterTransforms: "",
  currentCorrectionMode: "NONE",
  targetPhysicalSize: INITIAL_TARGET_SIZE,
  lastKnownGoodSheetPoseAgeMs: 0,
  runtimeScale: null,
  lastError: ""
};

const INVISIBLE_MATRIX = new THREE.Matrix4().set(
  0, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 1
);

export function ARClient({ id, debug = false }: { id: string; debug?: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const arSceneRemountCountRef = useRef(0);
  const liveDebugRef = useRef<Record<string, unknown>>({});
  const debugEnabledRef = useRef(debug);
  const [stabilityMode, setStabilityMode] = useState<ARStabilityMode>(readInitialStabilityMode);
  const stabilityModeRef = useRef<ARStabilityMode>(stabilityMode);
  const [trackingMode, setTrackingMode] = useState<ARTrackingMode>(readInitialTrackingMode);
  const trackingModeRef = useRef<ARTrackingMode>(trackingMode);
  const [trackingSupport, setTrackingSupport] = useState<TrackingProviderSupportMap>(DEFAULT_TRACKING_SUPPORT);
  const trackingSupportRef = useRef<TrackingProviderSupportMap>(DEFAULT_TRACKING_SUPPORT);
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [publicStatus, setPublicStatus] = useState<PublicStatus>("camera loading");
  const [runtimeResetKey, setRuntimeResetKey] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(INITIAL_STATUS);
  const [liveDebugSnapshot, setLiveDebugSnapshot] = useState<Record<string, unknown>>({});
  const [debugCopyStatus, setDebugCopyStatus] = useState("");
  const [advancedControlsVisible, setAdvancedControlsVisible] = useState(false);

  const patchRuntimeStatus = useCallback((next: Partial<RuntimeStatus>) => {
    setRuntimeStatus((current) => ({ ...current, ...next }));
  }, []);

  const applyStabilityMode = useCallback((nextMode: ARStabilityMode, persist: boolean) => {
    stabilityModeRef.current = nextMode;
    setStabilityMode(nextMode);

    if (persist) {
      try {
        window.localStorage.setItem(AR_STABILITY_STORAGE_KEY, nextMode);
      } catch {
        // The selected mode still applies for this page even if storage is unavailable.
      }
    }

    if (rendererRef.current) {
      applyRendererPixelRatio(rendererRef.current, nextMode);
    }

    liveDebugRef.current = {
      ...liveDebugRef.current,
      stabilityMode: nextMode,
      stabilityModeLabel: getStabilityConfig(nextMode).label
    };
  }, []);

  const applyTrackingMode = useCallback((nextMode: ARTrackingMode, persist: boolean) => {
    trackingModeRef.current = nextMode;
    setTrackingMode(nextMode);

    if (persist) {
      try {
        window.localStorage.setItem(AR_TRACKING_MODE_STORAGE_KEY, nextMode);
      } catch {
        // The selected mode still applies for this page even if storage is unavailable.
      }
    }

    liveDebugRef.current = {
      ...liveDebugRef.current,
      selectedTrackingMode: nextMode,
      selectedTrackingModeLabel: TRACKING_MODE_LABELS[nextMode]
    };
    setRuntimeResetKey((value) => value + 1);
  }, []);

  useEffect(() => {
    debugEnabledRef.current = debug;
  }, [debug]);

  useEffect(() => {
    let cancelled = false;

    detectTrackingProviderSupport().then((support) => {
      if (cancelled) return;
      trackingSupportRef.current = support;
      setTrackingSupport(support);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const handleStabilityModeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextMode = parseStabilityMode(event.target.value) || DEFAULT_STABILITY_MODE;
    applyStabilityMode(nextMode, true);
  }, [applyStabilityMode]);

  const handleTrackingModeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextMode = parseTrackingMode(event.target.value) || DEFAULT_TRACKING_MODE;
    applyTrackingMode(nextMode, true);
  }, [applyTrackingMode]);

  const copyDebugReport = useCallback(async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      viewport: viewportDebug(),
      deviceProfile: detectDeviceProfile(),
      selectedTrackingMode: trackingMode,
      selectedTrackingModeLabel: TRACKING_MODE_LABELS[trackingMode],
      trackingSupport,
      stabilityMode,
      stabilityModeLabel: getStabilityConfig(stabilityMode).label,
      publicStatus,
      activeProjectId: project?.id || id,
      activeTarget: project ? targetDebug(project.target) : null,
      savedStatus: runtimeStatus,
      live: liveDebugRef.current
    };

    try {
      await writeClipboard(JSON.stringify(report, null, 2));
      setDebugCopyStatus("Debug copied");
    } catch {
      setDebugCopyStatus("Copy failed");
    }

    window.setTimeout(() => setDebugCopyStatus(""), 2200);
  }, [id, project, publicStatus, runtimeStatus, stabilityMode, trackingMode, trackingSupport]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setPublicStatus("camera loading");
      patchRuntimeStatus({
        ...INITIAL_STATUS,
        projectLoading: true,
        activeProjectId: id,
        selectedTrackingMode: trackingModeRef.current,
        trackingSupport: trackingSupportRef.current,
        deviceProfile: typeof window === "undefined" ? null : detectDeviceProfile()
      });

      const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (cancelled) return;

      if (!response.ok || !result.project) {
        const errorMessage = result.error || "Project not found.";
        setPublicStatus("model error");
        patchRuntimeStatus({
          projectLoading: false,
          projectLoaded: false,
          modelError: errorMessage,
          lastError: errorMessage
        });
        return;
      }

      const selectedScene = getActiveSceneForClient(result.project);
      setProject(result.project);
      patchRuntimeStatus({
        projectLoading: false,
        projectLoaded: true,
        activeProjectId: result.project.id,
        activeSceneId: selectedScene?.id || "",
        activeSceneName: selectedScene?.name || "",
        modelUrl: selectedScene?.modelUrl || "",
        modelPathname: selectedScene?.modelPathname || "",
        trackingSheetId: result.project.target.markerSheet.sheetId,
        trackingSheetVersion: result.project.target.markerSheet.version,
        trackingSheetFormat: result.project.target.markerSheet.format,
        imageTargetVersion: result.project.target.targetVersion,
        imageTargetSrc: result.project.target.mindUrl,
        imageTargetImage: result.project.target.imageUrl,
        imageTargetPixelSize: targetPixelSizeDebug(result.project.target),
        currentCorrectionMode: result.project.target.correctionMode,
        targetPhysicalSize: targetSizeDebug(result.project.target),
        lastError: "",
        modelError: ""
      });
    }

    loadProject().catch((caught) => {
      if (cancelled) return;
      const errorMessage = caught instanceof Error ? caught.message : "Unable to load project.";
      setPublicStatus("model error");
      patchRuntimeStatus({
        projectLoading: false,
        projectLoaded: false,
        modelError: errorMessage,
        lastError: errorMessage
      });
    });

    return () => {
      cancelled = true;
    };
  }, [id, patchRuntimeStatus]);

  useEffect(() => {
    if (!project || !mountRef.current) return;

    cleanupRef.current?.();
    const currentProject = project;
    const activeScene = getActiveSceneForClient(currentProject);
    const target = currentProject.target;
    let stopped = false;
    let animationFrame = 0;
    let trackingProvider: TrackingProvider | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let video: HTMLVideoElement | null = null;
    let activeModel: THREE.Object3D | null = null;
    let activeCorrectionMetrics: ModelCorrectionMetrics | null = null;
    let targetVisible = false;
    let lastPublicStatus: PublicStatus | "" = "";
    arSceneRemountCountRef.current += 1;
    const resizeDebug: ResizeDebugState = {
      canvasResizeCount: 0,
      rendererSetSizeCount: 0,
      arSceneRemountCount: arSceneRemountCountRef.current,
      lastResizeReason: "runtime-start",
      lastRendererSize: {
        width: 0,
        height: 0
      }
    };

    const updatePublicStatus = (nextStatus: PublicStatus) => {
      if (lastPublicStatus === nextStatus) return;
      lastPublicStatus = nextStatus;
      setPublicStatus(nextStatus);
    };

    async function start() {
      updatePublicStatus("camera loading");
      const deviceProfile = detectDeviceProfile();
      patchRuntimeStatus({
        cameraActive: false,
        mindARInitialized: false,
        selectedTrackingMode: trackingModeRef.current,
        activeTrackingProvider: "",
        activeTrackingProviderLabel: "",
        trackingProviderFallbackReason: "",
        trackingSupport: trackingSupportRef.current,
        deviceProfile,
        targetFound: false,
        targetLost: false,
        targetIndex: 0,
        activeMarkerId: "",
        activeMarkerRole: "",
        visibleMarkerCount: 0,
        poseSource: "",
        imageTargetLoaded: false,
        trackingSheetId: target.markerSheet.sheetId,
        trackingSheetVersion: target.markerSheet.version,
        trackingSheetFormat: target.markerSheet.format,
        imageTargetVersion: target.targetVersion,
        imageTargetSrc: target.mindUrl,
        imageTargetImage: target.imageUrl,
        imageTargetPixelSize: targetPixelSizeDebug(target),
        currentCorrectionMode: target.correctionMode,
        targetPhysicalSize: targetSizeDebug(target),
        activeProjectId: currentProject.id,
        activeSceneId: activeScene?.id || "",
        activeSceneName: activeScene?.name || "",
        modelLoading: false,
        modelLoaded: false,
        modelError: "",
        modelAttachedToTarget: false,
        modelUrl: activeScene?.modelUrl || "",
        modelPathname: activeScene?.modelPathname || "",
        modelLocalTransform: null,
        modelWorldTransform: null,
        desktopViewportTransform: null,
        canonicalPlacement: null,
        editorAppliedTransform: null,
        mindARAppliedTransform: null,
        correctionRootTransform: null,
        scaleRootTransform: null,
        rawBounds: null,
        correctedBounds: null,
        boundsBeforeCorrection: null,
        boundsAfterCorrection: null,
        longestDimensionAxisAfterTransforms: "",
        runtimeScale: null,
        lastKnownGoodSheetPoseAgeMs: 0,
        lastError: ""
      });

      if (!navigator.mediaDevices?.getUserMedia) {
        fail("Camera API is unavailable in this browser.", "camera");
        return;
      }

      if (!activeScene) {
        fail("No active scene has been created yet.", "model");
        return;
      }

      if (!activeScene.modelUrl) {
        fail("Active scene does not have a GLB model yet.", "model");
        return;
      }
      const activeSceneForRuntime = activeScene;

      try {
        await ensureStaticAsset(target.mindUrl, ".mind missing");
        await ensureStaticAsset(target.imageUrl, "target image missing");
        await ensureStaticAsset(target.markerSheet.manifestUrl, "tracking manifest missing");
        patchRuntimeStatus({ imageTargetLoaded: true });
      } catch (caught) {
        fail(caught instanceof Error ? caught.message : "Image target asset is missing.", "target");
        return;
      }

      const mount = mountRef.current;
      if (!mount || stopped) return;

      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        rendererRef.current = renderer;
        renderer.getContext();
        applyRendererPixelRatio(renderer, stabilityModeRef.current);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        Object.assign(renderer.domElement.style, {
          position: "fixed",
          inset: "0",
          width: "100vw",
          height: "100vh",
          zIndex: "1",
          pointerEvents: "none",
          display: "block"
        });
        mount.appendChild(renderer.domElement);

        const arVideo = await startVideo(mount);
        video = arVideo;
        patchRuntimeStatus({ cameraActive: true });

        const threeScene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        threeScene.add(camera);

        const targetAnchor = new THREE.Group();
        targetAnchor.matrixAutoUpdate = false;
        targetAnchor.visible = false;
        threeScene.add(targetAnchor);

        const stabilizedRoot = new THREE.Group();
        stabilizedRoot.matrixAutoUpdate = false;
        stabilizedRoot.visible = false;
        targetAnchor.add(stabilizedRoot);

        stabilizedRoot.add(new THREE.AmbientLight(0xffffff, 2));
        const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd7dee8, 3);
        stabilizedRoot.add(hemisphere);
        const directional = new THREE.DirectionalLight(0xffffff, 3);
        directional.position.set(0.6, 1.4, 0.8);
        stabilizedRoot.add(directional);

        const boardReferenceGroup = new THREE.Group();
        const desktopViewportTransformGroup = new THREE.Group();
        const modelCorrectionGroup = new THREE.Group();
        const scaleRoot = new THREE.Group();
        applyMindARBoardSpaceRoot(boardReferenceGroup, getImageTargetGeometry(target).widthM);
        stabilizedRoot.add(boardReferenceGroup);
        boardReferenceGroup.add(desktopViewportTransformGroup);

        const debugCube = createDebugCube();
        boardReferenceGroup.add(debugCube);

        const targetAxes = new THREE.AxesHelper(0.18);
        boardReferenceGroup.add(targetAxes);

        const poseStabilizer = new PoseStabilizer();
        const frameRateTracker = new FrameRateTracker();
        let lastDebugSnapshotAtMs = 0;

        const latestSupport = await detectTrackingProviderSupport();
        if (stopped) return;
        trackingSupportRef.current = latestSupport;
        setTrackingSupport(latestSupport);

        const providerStartup = await startTrackingProviderWithFallback({
          selectedMode: trackingModeRef.current,
          support: latestSupport,
          deviceProfile,
          context: {
            video,
            target
          }
        });
        if (stopped) return;
        trackingProvider = providerStartup.provider;

        const unsubscribePose = trackingProvider.onPoseUpdate(({
          matrix,
          timestampMs,
          targetIndex,
          markerId,
          markerRole,
          visibleMarkerCount,
          poseSource
        }) => {
          if (!video) return;
          if (!poseStabilizer.setRawMatrix(matrix, timestampMs)) return;
          targetAnchor.matrix.copy(matrix);
          targetAnchor.visible = true;
          targetAnchor.updateMatrixWorld(true);
          stabilizedRoot.visible = true;
          patchRuntimeStatus({
            targetFound: true,
            targetLost: false,
            targetIndex,
            activeMarkerId: markerId,
            activeMarkerRole: markerRole,
            visibleMarkerCount,
            poseSource
          });
        });
        const unsubscribeFound = trackingProvider.onTargetFound(() => {
          const now = performance.now();
          targetVisible = true;
          updatePublicStatus(
            poseStabilizer.isHoldingPoseAfterLoss(now, stabilityModeRef.current)
              ? "target re-aligning"
              : "target found"
          );
          patchRuntimeStatus({ targetFound: true, targetLost: false });
        });
        const unsubscribeLost = trackingProvider.onTargetLost(() => {
          const now = performance.now();
          const holdingPose = poseStabilizer.markTargetLost(now, stabilityModeRef.current);

          if (!holdingPose) {
            targetAnchor.matrix.copy(INVISIBLE_MATRIX);
            targetAnchor.visible = false;
            stabilizedRoot.visible = false;
          }

          if (targetVisible) {
            targetVisible = false;
            updatePublicStatus(
              holdingPose
                ? poseStabilizer.getLossPublicStatus(now, stabilityModeRef.current)
                : "target lost"
            );
            patchRuntimeStatus({
              targetFound: false,
              targetLost: true,
              visibleMarkerCount: 0,
              poseSource: ""
            });
          } else {
            updatePublicStatus("target searching");
          }
        });

        resizeTrackingView({
          video,
          renderer,
          camera,
          provider: trackingProvider,
          resizeDebug,
          reason: "startup"
        });
        window.addEventListener("resize", handleWindowResize);
        window.addEventListener("orientationchange", handleOrientationChange);

        patchRuntimeStatus({
          trackingMode: trackingProvider.label,
          selectedTrackingMode: trackingModeRef.current,
          activeTrackingProvider: trackingProvider.id,
          activeTrackingProviderLabel: trackingProvider.label,
          trackingProviderFallbackReason: providerStartup.fallbackReason,
          trackingSupport: latestSupport,
          deviceProfile,
          mindARInitialized: trackingProvider.id === "mindar-image"
        });
        updatePublicStatus("target searching");

        function resize(reason: string) {
          if (!mount || !video || !renderer || !trackingProvider) return;
          resizeTrackingView({
            video,
            renderer,
            camera,
            provider: trackingProvider,
            resizeDebug,
            reason
          });
        }

        function handleWindowResize() {
          resize("window-resize");
        }

        function handleOrientationChange() {
          resize("orientation-change");
        }

        async function loadActiveModel() {
          updatePublicStatus("loading model");
          patchRuntimeStatus({
            modelLoading: true,
            modelLoaded: false,
            modelError: "",
            lastError: ""
          });

          try {
            const gltf = await loadGltfModel(activeSceneForRuntime.modelUrl);
            if (stopped) return;

            const model = gltf.scene;
            activeModel = model;
            forceVisibleModel(model);

            activeCorrectionMetrics = configureModelCorrectionHierarchy({
              correctionRoot: modelCorrectionGroup,
              scaleRoot,
              model,
              correctionMode: target.correctionMode
            });
            const runtimeTransform = computeSceneTransformForRuntime(
              modelCorrectionGroup,
              activeSceneForRuntime,
              target,
              "ar"
            );
            if (modelCorrectionGroup.parent !== desktopViewportTransformGroup) {
              desktopViewportTransformGroup.add(modelCorrectionGroup);
            }
            applyRuntimeSceneTransform(desktopViewportTransformGroup, scaleRoot, runtimeTransform);
            model.updateMatrixWorld(true);
            modelCorrectionGroup.updateMatrixWorld(true);
            desktopViewportTransformGroup.updateMatrixWorld(true);
            const correctedWorldBounds = boundsDebug(modelCorrectionGroup);

            const scaleDebug = {
              baseFitScale: roundForDebug(runtimeTransform.metrics.baseFitScale),
              displayedScale: roundForDebug(runtimeTransform.metrics.displayedScale),
              mindARScale: roundForDebug(runtimeTransform.metrics.runtimeScale),
              boundsValid: runtimeTransform.metrics.boundsValid,
              scaleFallbackReason: runtimeTransform.metrics.scaleFallbackReason || ""
            };

            patchRuntimeStatus({
              activeSceneId: activeSceneForRuntime.id,
              activeSceneName: activeSceneForRuntime.name,
              modelUrl: activeSceneForRuntime.modelUrl,
              modelPathname: activeSceneForRuntime.modelPathname,
              modelLoading: false,
              modelLoaded: true,
              modelError: "",
              modelAttachedToTarget: true,
              canonicalPlacement: runtimeTransform.appPlacement,
              desktopViewportTransform: transformDebugFromRuntime(runtimeTransform.editorAppliedTransform),
              editorAppliedTransform: transformDebugFromRuntime(runtimeTransform.editorAppliedTransform),
              mindARAppliedTransform: transformDebugFromRuntime(runtimeTransform.mindARAppliedTransform),
              correctionRootTransform: objectLocalDebug(modelCorrectionGroup),
              scaleRootTransform: objectLocalDebug(scaleRoot),
              modelLocalTransform: objectLocalDebug(model),
              modelWorldTransform: objectWorldDebug(model),
              rawBounds: boundsDebug(model),
              correctedBounds: correctedWorldBounds,
              boundsBeforeCorrection: activeCorrectionMetrics
                ? boundsInfoDebug(activeCorrectionMetrics.boundsBeforeCorrection)
                : null,
              boundsAfterCorrection: activeCorrectionMetrics
                ? boundsInfoDebug(activeCorrectionMetrics.boundsAfterCorrection)
                : null,
              longestDimensionAxisAfterTransforms: longestAxisFromDebugBounds(correctedWorldBounds),
              runtimeScale: scaleDebug,
              lastError: runtimeTransform.metrics.scaleFallbackReason || ""
            });

            updatePublicStatus(targetVisible ? "target found" : "target searching");
          } catch (caught) {
            const errorMessage = caught instanceof Error ? caught.message : "model load failed";
            updatePublicStatus("model error");
            patchRuntimeStatus({
              modelLoading: false,
              modelLoaded: false,
              modelError: errorMessage,
              lastError: errorMessage
            });
          }
        }

        function animate(now = performance.now()) {
          if (stopped || !renderer) return;
          animationFrame = window.requestAnimationFrame(animate);
          frameRateTracker.tick(now);
          poseStabilizer.applyToRoot({
            targetAnchor,
            stabilizedRoot,
            mode: stabilityModeRef.current,
            now
          });
          const posePublicStatus = poseStabilizer.getPosePublicStatus(now, stabilityModeRef.current);
          if (posePublicStatus) {
            updatePublicStatus(posePublicStatus);
          }
          renderer.render(threeScene, camera);

          if (video && now - lastDebugSnapshotAtMs >= 250) {
            const snapshot = buildLiveDebugSnapshot({
              video,
              renderer,
              targetAnchor,
              stabilizedRoot,
              boardReferenceGroup,
              desktopViewportTransformGroup,
              modelCorrectionGroup,
              scaleRoot,
              target,
              activeModel,
              activeCorrectionMetrics,
              targetVisible,
              stabilityMode: stabilityModeRef.current,
              selectedTrackingMode: trackingModeRef.current,
              trackingProvider,
              trackingSupport: latestSupport,
              deviceProfile,
              poseStabilizer,
              frameRateTracker,
              resizeDebug,
              now
            });
            liveDebugRef.current = snapshot;
            if (debugEnabledRef.current) {
              setLiveDebugSnapshot(snapshot);
            }
            const stabilityDebug = snapshot.stability as Record<string, unknown>;
            patchRuntimeStatus({
              lastKnownGoodSheetPoseAgeMs:
                typeof stabilityDebug.lastKnownGoodPoseAgeMs === "number"
                  ? stabilityDebug.lastKnownGoodPoseAgeMs
                  : 0
            });
            lastDebugSnapshotAtMs = now;
          }
        }

        cleanupRef.current = () => {
          stopped = true;
          window.cancelAnimationFrame(animationFrame);
          window.removeEventListener("resize", handleWindowResize);
          window.removeEventListener("orientationchange", handleOrientationChange);
          unsubscribePose();
          unsubscribeFound();
          unsubscribeLost();
          trackingProvider?.stop();
          trackingProvider?.dispose();
          const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null;
          stream?.getTracks().forEach((track) => track.stop());
          video?.remove();
          disposeObject(targetAnchor);
          renderer?.dispose();
          if (rendererRef.current === renderer) {
            rendererRef.current = null;
          }
          renderer?.domElement.remove();
        };

        animate();
        void loadActiveModel();
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "Tracking provider init failed";
        fail(errorMessage.includes("Permission") ? "camera denied" : errorMessage, "mindar");
      }
    }

    function fail(message: string, kind: "camera" | "target" | "mindar" | "model") {
      const nextStatus: Partial<RuntimeStatus> = {
        modelLoading: false,
        modelLoaded: false,
        modelError: kind === "model" ? message : "",
        lastError: message
      };

      if (kind === "camera") {
        nextStatus.cameraActive = false;
      }

      if (kind === "mindar") {
        nextStatus.mindARInitialized = false;
      }

      updatePublicStatus("model error");
      patchRuntimeStatus(nextStatus);
    }

    start().catch((caught) => {
      const errorMessage = caught instanceof Error ? caught.message : "Tracking runtime error.";
      updatePublicStatus("model error");
      patchRuntimeStatus({
        modelLoading: false,
        modelLoaded: false,
        modelError: errorMessage,
        lastError: errorMessage
      });
    });

    return () => {
      stopped = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [project, runtimeResetKey, patchRuntimeStatus]);

  const showFallbackViewer = publicStatus === "model error" && Boolean(project?.viewUrl);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <div ref={mountRef} className="fixed inset-0 overflow-hidden [contain:layout_size_paint]" />

      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <p className="flex h-8 w-[min(20rem,calc(100vw-1.5rem))] shrink-0 items-center rounded bg-black/60 px-2.5 text-xs font-semibold uppercase tracking-[0.08em] backdrop-blur">
          <span className="truncate">
          {publicStatus}
          </span>
        </p>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          {advancedControlsVisible ? (
            <>
              <label className="flex items-center gap-1.5 rounded bg-black/60 px-2.5 py-1.5 text-xs font-semibold backdrop-blur">
                <span>Tracking:</span>
                <select
                  aria-label="AR tracking mode"
                  className="rounded bg-white px-1.5 py-1 text-xs font-semibold text-black disabled:bg-white/50"
                  value={trackingMode}
                  onChange={handleTrackingModeChange}
                >
                  <option value="auto">{TRACKING_MODE_LABELS.auto}</option>
                  <option value="mindar-image">{TRACKING_MODE_LABELS["mindar-image"]}</option>
                  <option value="webxr-world" disabled={!trackingSupport["webxr-world"].supported}>
                    {TRACKING_MODE_LABELS["webxr-world"]}
                    {trackingSupport["webxr-world"].supported ? "" : " (unsupported)"}
                  </option>
                  <option value="arkit-ios" disabled>
                    {TRACKING_MODE_LABELS["arkit-ios"]} (future)
                  </option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 rounded bg-black/60 px-2.5 py-1.5 text-xs font-semibold backdrop-blur">
                <span>Stability:</span>
                <select
                  aria-label="AR stability mode"
                  className="rounded bg-white px-1.5 py-1 text-xs font-semibold text-black"
                  value={stabilityMode}
                  onChange={handleStabilityModeChange}
                >
                  {AR_STABILITY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {getStabilityConfig(mode).label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <button
            type="button"
            className="focus-ring rounded bg-black/60 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/75"
            onClick={() => setAdvancedControlsVisible((visible) => !visible)}
          >
            {advancedControlsVisible ? "Hide controls" : "Controls"}
          </button>
          {debugCopyStatus ? (
            <span className="rounded bg-black/60 px-2.5 py-1.5 text-xs font-semibold backdrop-blur">
              {debugCopyStatus}
            </span>
          ) : null}
          <button
            type="button"
            className="focus-ring rounded bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-white/90"
            onClick={copyDebugReport}
          >
            Copy debug
          </button>
        </div>
      </div>

      {showFallbackViewer ? (
        <div className="fixed inset-x-0 bottom-0 z-10 p-3">
          <Link
            className="focus-ring inline-flex rounded bg-white px-3 py-2 text-sm font-semibold text-black"
            href={project?.viewUrl || "#"}
          >
            Open 3D viewer
          </Link>
        </div>
      ) : null}

      {debug ? (
        <div className="fixed inset-x-0 bottom-0 z-20 max-h-[60vh] overflow-auto bg-black/80 p-3 backdrop-blur">
          <div className="mb-3 flex flex-wrap gap-2">
            <Link className="focus-ring rounded bg-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/25" href="/">
              Home
            </Link>
            {project ? (
              <Link className="focus-ring rounded bg-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/25" href={project.viewUrl}>
                Open viewer
              </Link>
            ) : null}
            <button
              className="focus-ring rounded bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-white/90"
              onClick={() => setRuntimeResetKey((value) => value + 1)}
            >
              Retry camera/tracking
            </button>
          </div>
          <pre className="max-w-3xl overflow-auto rounded bg-black/70 p-3 text-xs leading-5 text-[var(--soft)]">
            {JSON.stringify(
              {
                selectedTrackingMode: TRACKING_MODE_LABELS[trackingMode],
                selectedTrackingModeKey: trackingMode,
                trackingSupport,
                stabilityMode: getStabilityConfig(stabilityMode).label,
                stabilityModeKey: stabilityMode,
                publicStatus,
                savedStatus: runtimeStatus,
                live: liveDebugSnapshot
              },
              null,
              2
            )}
          </pre>
        </div>
      ) : null}
    </main>
  );
}

function getActiveSceneForClient(project: ProjectMetadata): SceneMetadata | null {
  return (
    project.scenes.find((scene) => scene.id === project.activeSceneId) ||
    project.scenes[0] ||
    null
  );
}

async function startVideo(container: HTMLElement) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  Object.assign(video.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "0",
    objectFit: "cover",
    pointerEvents: "none"
  });
  container.appendChild(video);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
  } catch (caught) {
    video.remove();
    throw new Error(caught instanceof Error ? caught.message : "camera denied");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("camera error")), 15000);
    video.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timeout);
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        resolve();
      },
      { once: true }
    );
  });

  await video.play().catch(() => undefined);
  return video;
}

async function ensureStaticAsset(url: string, label: string) {
  const response = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label}: ${url}`);
  }
}

async function loadMindARImageRuntime() {
  const moduleUrl = new URL(MINDAR_IMAGE_RUNTIME_URL, window.location.href).href;
  return (await import(/* webpackIgnore: true */ moduleUrl)) as MindARImageRuntime;
}

abstract class BaseTrackingProvider implements TrackingProvider {
  protected initialized = false;
  protected running = false;
  protected targetVisible = false;
  protected activeTargetIndex = 0;
  protected activeMarkerId = "";
  protected activeMarkerRole = "";
  protected visibleMarkerCount = 0;
  protected poseSource: MultiMarkerPoseSource | "" = "";
  protected foundCount = 0;
  protected lostCount = 0;
  protected lastFoundAtMs = 0;
  protected lastLostAtMs = 0;
  protected status = "idle";
  protected fallbackReason = "";
  private poseCallbacks = new Set<(pose: TrackingPoseUpdate) => void>();
  private foundCallbacks = new Set<() => void>();
  private lostCallbacks = new Set<() => void>();

  abstract readonly id: TrackingProviderId;
  abstract readonly label: string;
  abstract isSupported(): Promise<TrackingProviderSupport>;
  abstract init(context: TrackingProviderContext): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract dispose(): void;

  getTrackingState(): TrackingState {
    return {
      providerId: this.id,
      label: this.label,
      initialized: this.initialized,
      running: this.running,
      targetVisible: this.targetVisible,
      activeTargetIndex: this.activeTargetIndex,
      activeMarkerId: this.activeMarkerId,
      activeMarkerRole: this.activeMarkerRole,
      visibleMarkerCount: this.visibleMarkerCount,
      poseSource: this.poseSource,
      status: this.status,
      foundCount: this.foundCount,
      lostCount: this.lostCount,
      lastFoundAtMs: this.lastFoundAtMs,
      lastLostAtMs: this.lastLostAtMs,
      fallbackReason: this.fallbackReason
    };
  }

  getCameraCalibration(): TrackingCameraCalibration {
    return null;
  }

  onPoseUpdate(callback: (pose: TrackingPoseUpdate) => void) {
    this.poseCallbacks.add(callback);
    return () => this.poseCallbacks.delete(callback);
  }

  onTargetFound(callback: () => void) {
    this.foundCallbacks.add(callback);
    return () => this.foundCallbacks.delete(callback);
  }

  onTargetLost(callback: () => void) {
    this.lostCallbacks.add(callback);
    return () => this.lostCallbacks.delete(callback);
  }

  getDebugState(): Record<string, unknown> {
    return this.getTrackingState();
  }

  protected emitPose(update: TrackingPoseUpdate) {
    this.activeTargetIndex = update.targetIndex;
    this.activeMarkerId = update.markerId;
    this.activeMarkerRole = update.markerRole;
    this.visibleMarkerCount = update.visibleMarkerCount;
    this.poseSource = update.poseSource;
    this.poseCallbacks.forEach((callback) => callback(update));
  }

  protected emitFound(now: number) {
    if (!this.targetVisible) {
      this.foundCount += 1;
      this.lastFoundAtMs = now;
      this.foundCallbacks.forEach((callback) => callback());
    }

    this.targetVisible = true;
  }

  protected emitLost(now: number) {
    if (this.targetVisible) {
      this.lostCount += 1;
      this.lastLostAtMs = now;
      this.lostCallbacks.forEach((callback) => callback());
    }

    this.targetVisible = false;
    this.visibleMarkerCount = 0;
    this.poseSource = "";
  }
}

class MindARImageTrackingProvider extends BaseTrackingProvider {
  readonly id = "mindar-image" as const;
  readonly label = TRACKING_PROVIDER_LABELS["mindar-image"];
  private controller: MindARController | null = null;
  private video: HTMLVideoElement | null = null;
  private target: ImageTargetSettings | null = null;
  private markerByTargetIndex = new Map<number, MarkerSheetMarker>();
  private postMatrixByTargetIndex = new Map<number, THREE.Matrix4>();
  private markerLocalSheetMatrixByTargetIndex = new Map<number, THREE.Matrix4>();
  private visibleMarkerPoses = new Map<number, VisibleMarkerPose>();
  private lastTargetDimensions: Array<[number, number]> = [];
  private lastSheetPoseDebug: Record<string, unknown> | null = null;

  async isSupported(): Promise<TrackingProviderSupport> {
    return DEFAULT_TRACKING_SUPPORT["mindar-image"];
  }

  async init({ video, target }: TrackingProviderContext) {
    this.video = video;
    this.target = target;
    this.status = "loading MindAR runtime";

    const mindarModule = await loadMindARImageRuntime();
    const ControllerClass = mindarModule.Controller;
    this.controller = new ControllerClass({
      inputWidth: video.videoWidth,
      inputHeight: video.videoHeight,
      maxTrack: Math.max(1, Math.min(target.markerSheet.maxTrack, target.markerSheet.markers.length)),
      warmupTolerance: 3,
      missTolerance: 8,
      filterMinCF: null,
      filterBeta: null,
      onUpdate: (data) => this.handleUpdate(data)
    });

    this.status = "loading image target";
    const { dimensions } = await this.controller.addImageTargets(target.mindUrl);
    this.lastTargetDimensions = dimensions;
    this.markerByTargetIndex.clear();
    this.postMatrixByTargetIndex.clear();
    this.markerLocalSheetMatrixByTargetIndex.clear();
    this.visibleMarkerPoses.clear();

    const markerFallbackDimensions: [number, number] = [1, 1];
    for (const marker of target.markerSheet.markers) {
      const targetDimensions = dimensions[marker.targetIndex] || markerFallbackDimensions;
      this.markerByTargetIndex.set(marker.targetIndex, marker);
      this.postMatrixByTargetIndex.set(
        marker.targetIndex,
        createPostMatrix(targetDimensions[0], targetDimensions[1])
      );
      this.markerLocalSheetMatrixByTargetIndex.set(
        marker.targetIndex,
        createMarkerLocalSheetMatrix(marker, target)
      );
    }

    this.status = "warming up";
    await this.controller.dummyRun(video);
    this.initialized = true;
    this.status = "initialized";
  }

  async start() {
    if (!this.controller || !this.video) {
      throw new Error("MindAR provider has not been initialized.");
    }

    this.controller.processVideo(this.video);
    this.running = true;
    this.status = "running";
  }

  stop() {
    this.controller?.stopProcessVideo();
    this.running = false;
    this.status = this.initialized ? "stopped" : "idle";
  }

  dispose() {
    this.stop();
    this.controller = null;
    this.video = null;
    this.target = null;
    this.markerByTargetIndex.clear();
    this.postMatrixByTargetIndex.clear();
    this.markerLocalSheetMatrixByTargetIndex.clear();
    this.visibleMarkerPoses.clear();
    this.initialized = false;
    this.targetVisible = false;
    this.visibleMarkerCount = 0;
    this.poseSource = "";
    this.status = "disposed";
  }

  getCameraCalibration(): TrackingCameraCalibration {
    if (!this.controller) return null;

    return {
      projectionMatrix: this.controller.getProjectionMatrix(),
      inputWidth: this.controller.inputWidth,
      inputHeight: this.controller.inputHeight
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      ...this.getTrackingState(),
      mindARStatus: this.status,
      targetVersion: this.target?.targetVersion || "",
      inputWidth: this.controller?.inputWidth || 0,
      inputHeight: this.controller?.inputHeight || 0,
      targetMindUrl: this.target?.mindUrl || "",
      targetImageUrl: this.target?.imageUrl || "",
      trackingSheet: this.target
        ? {
            sheetId: this.target.markerSheet.sheetId,
            version: this.target.markerSheet.version,
            format: this.target.markerSheet.format,
            markerCount: this.target.markerSheet.markers.length,
            maxTrack: this.target.markerSheet.maxTrack,
            manifestUrl: this.target.markerSheet.manifestUrl
          }
        : null,
      activeMarker: this.activeMarkerId
        ? {
            id: this.activeMarkerId,
            role: this.activeMarkerRole,
            targetIndex: this.activeTargetIndex
          }
        : null,
      visibleMarkerCount: this.visibleMarkerCount,
      poseSource: this.poseSource,
      lastSheetPose: this.lastSheetPoseDebug,
      targetPixelSize: this.target ? targetPixelSizeDebug(this.target) : null,
      targetPhysicalSize: this.target ? targetSizeDebug(this.target) : null,
      targetDimensions: this.lastTargetDimensions.map(([width, height], targetIndex) => ({
        targetIndex,
        width: roundForDebug(width),
        height: roundForDebug(height)
      }))
    };
  }

  private handleUpdate(data: MindARUpdate) {
    if (data.type !== "updateMatrix" || typeof data.targetIndex !== "number") return;
    const marker = this.markerByTargetIndex.get(data.targetIndex);
    const postMatrix = this.postMatrixByTargetIndex.get(data.targetIndex);
    const markerLocalSheetMatrix = this.markerLocalSheetMatrixByTargetIndex.get(data.targetIndex);
    if (!marker || !postMatrix || !markerLocalSheetMatrix) return;
    const now = performance.now();

    if (data.worldMatrix) {
      const markerMatrix = new THREE.Matrix4();
      markerMatrix.fromArray(data.worldMatrix);
      markerMatrix.multiply(postMatrix);
      if (!isUsableMatrix(markerMatrix)) return;

      const sheetMatrix = markerMatrix.clone().multiply(
        markerLocalSheetMatrix.clone().invert()
      );
      if (!isUsableMatrix(sheetMatrix)) return;

      const targetDimensions =
        this.lastTargetDimensions[data.targetIndex] ||
        ([1, 1] as [number, number]);
      this.visibleMarkerPoses.set(data.targetIndex, {
        marker,
        markerMatrix,
        sheetMatrix,
        updatedAtMs: now,
        targetDimensions
      });
      this.pruneStaleMarkerPoses(now);

      const fusedPose = this.computeSheetPose(now);
      if (!fusedPose) return;

      this.emitFound(now);
      this.lastSheetPoseDebug = {
        activeMarkerId: fusedPose.marker.id,
        activeTargetIndex: fusedPose.marker.targetIndex,
        activeMarkerRole: fusedPose.marker.role,
        visibleMarkerCount: fusedPose.visibleMarkerCount,
        poseSource: fusedPose.poseSource,
        markerSheetPosition: markerSheetPositionDebug(fusedPose.marker, this.target),
        sheetTransform: transformDebugFromMatrix(fusedPose.sheetMatrix)
      };
      this.emitPose({
        matrix: fusedPose.sheetMatrix,
        timestampMs: now,
        targetIndex: fusedPose.marker.targetIndex,
        markerId: fusedPose.marker.id,
        markerRole: fusedPose.marker.role,
        visibleMarkerCount: fusedPose.visibleMarkerCount,
        poseSource: fusedPose.poseSource
      });
      return;
    }

    this.visibleMarkerPoses.delete(data.targetIndex);
    this.pruneStaleMarkerPoses(now);
    this.visibleMarkerCount = this.visibleMarkerPoses.size;
    if (this.visibleMarkerPoses.size === 0) {
      this.emitLost(now);
    }
  }

  private pruneStaleMarkerPoses(now: number) {
    const staleAfterMs = 350;
    for (const [targetIndex, pose] of this.visibleMarkerPoses) {
      if (now - pose.updatedAtMs > staleAfterMs) {
        this.visibleMarkerPoses.delete(targetIndex);
      }
    }
  }

  private computeSheetPose(now: number) {
    this.pruneStaleMarkerPoses(now);
    const poses = [...this.visibleMarkerPoses.values()]
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    if (poses.length === 0) return null;

    const freshest = poses[0];
    if (poses.length === 1) {
      return {
        sheetMatrix: freshest.sheetMatrix.clone(),
        marker: freshest.marker,
        visibleMarkerCount: 1,
        poseSource: "single-marker" as const
      };
    }

    const fused = fuseSheetMatrices(poses.map((pose) => pose.sheetMatrix));
    return {
      sheetMatrix: fused,
      marker: freshest.marker,
      visibleMarkerCount: poses.length,
      poseSource: "fused-markers" as const
    };
  }
}

class WebXRWorldTrackingProvider extends BaseTrackingProvider {
  readonly id = "webxr-world" as const;
  readonly label = TRACKING_PROVIDER_LABELS["webxr-world"];
  private support: TrackingProviderSupport | null = null;

  async isSupported(): Promise<TrackingProviderSupport> {
    this.support = await detectWebXRSupport();
    return this.support;
  }

  async init() {
    const support = this.support || await this.isSupported();
    if (!support.supported) {
      throw new Error(support.reason);
    }

    this.initialized = true;
    this.status = "experimental guard";
  }

  async start() {
    const support = this.support || await this.isSupported();
    if (!support.supported) {
      throw new Error(support.reason);
    }

    this.fallbackReason =
      "WebXR immersive-ar is supported, but this experimental adapter is guarded until a world-placement calibration flow is added.";
    this.status = "guarded fallback";
    throw new Error(this.fallbackReason);
  }

  stop() {
    this.running = false;
    this.status = this.initialized ? "stopped" : "idle";
  }

  dispose() {
    this.stop();
    this.initialized = false;
    this.targetVisible = false;
    this.status = "disposed";
  }

  getDebugState(): Record<string, unknown> {
    return {
      ...this.getTrackingState(),
      webXRSupport: this.support,
      implementation: "guarded experimental provider; falls back to MindAR until world placement is implemented"
    };
  }
}

class FutureARKitProvider extends BaseTrackingProvider {
  readonly id = "arkit-ios" as const;
  readonly label = TRACKING_PROVIDER_LABELS["arkit-ios"];

  async isSupported(): Promise<TrackingProviderSupport> {
    return DEFAULT_TRACKING_SUPPORT["arkit-ios"];
  }

  async init() {
    throw new Error(DEFAULT_TRACKING_SUPPORT["arkit-ios"].reason);
  }

  async start() {
    throw new Error(DEFAULT_TRACKING_SUPPORT["arkit-ios"].reason);
  }

  stop() {
    this.running = false;
  }

  dispose() {
    this.initialized = false;
    this.targetVisible = false;
  }
}

class OptionalProviderPlaceholder extends BaseTrackingProvider {
  readonly id = "commercial-placeholder" as const;
  readonly label = TRACKING_PROVIDER_LABELS["commercial-placeholder"];

  async isSupported(): Promise<TrackingProviderSupport> {
    return DEFAULT_TRACKING_SUPPORT["commercial-placeholder"];
  }

  async init() {
    throw new Error(DEFAULT_TRACKING_SUPPORT["commercial-placeholder"].reason);
  }

  async start() {
    throw new Error(DEFAULT_TRACKING_SUPPORT["commercial-placeholder"].reason);
  }

  stop() {
    this.running = false;
  }

  dispose() {
    this.initialized = false;
    this.targetVisible = false;
  }
}

function createTrackingProvider(providerId: TrackingProviderId): TrackingProvider {
  if (providerId === "webxr-world") return new WebXRWorldTrackingProvider();
  if (providerId === "arkit-ios") return new FutureARKitProvider();
  if (providerId === "commercial-placeholder") return new OptionalProviderPlaceholder();
  return new MindARImageTrackingProvider();
}

function resolveTrackingProviderId({
  selectedMode,
  support,
  deviceProfile
}: {
  selectedMode: ARTrackingMode;
  support: TrackingProviderSupportMap;
  deviceProfile: DeviceProfile;
}) {
  if (selectedMode === "mindar-image") {
    return {
      providerId: "mindar-image" as const,
      fallbackReason: ""
    };
  }

  if (selectedMode === "webxr-world") {
    return support["webxr-world"].supported
      ? {
          providerId: "webxr-world" as const,
          fallbackReason: ""
        }
      : {
          providerId: "mindar-image" as const,
          fallbackReason: support["webxr-world"].reason
        };
  }

  if (selectedMode === "arkit-ios") {
    return {
      providerId: "mindar-image" as const,
      fallbackReason: DEFAULT_TRACKING_SUPPORT["arkit-ios"].reason
    };
  }

  if (deviceProfile.isAndroid && support["webxr-world"].supported) {
    return {
      providerId: "webxr-world" as const,
      fallbackReason: "Auto selected WebXR on Android because immersive-ar is supported."
    };
  }

  if (deviceProfile.isIOS) {
    return {
      providerId: "mindar-image" as const,
      fallbackReason: "Auto selected MindAR because iOS browsers use WebKit; Chrome on iPhone does not unlock WebXR/ARCore."
    };
  }

  return {
    providerId: "mindar-image" as const,
    fallbackReason: support["webxr-world"].supported
      ? "Auto kept MindAR as the universal image-target provider on this device."
      : support["webxr-world"].reason
  };
}

async function startTrackingProviderWithFallback({
  selectedMode,
  support,
  deviceProfile,
  context
}: {
  selectedMode: ARTrackingMode;
  support: TrackingProviderSupportMap;
  deviceProfile: DeviceProfile;
  context: TrackingProviderContext;
}) {
  const resolved = resolveTrackingProviderId({ selectedMode, support, deviceProfile });
  const firstProvider = createTrackingProvider(resolved.providerId);

  try {
    await firstProvider.init(context);
    await firstProvider.start();

    return {
      provider: firstProvider,
      fallbackReason: resolved.fallbackReason
    };
  } catch (caught) {
    firstProvider.dispose();

    if (resolved.providerId === "mindar-image") {
      throw caught;
    }

    const fallbackProvider = new MindARImageTrackingProvider();
    await fallbackProvider.init(context);
    await fallbackProvider.start();

    const caughtMessage = caught instanceof Error ? caught.message : "Selected provider failed.";
    return {
      provider: fallbackProvider,
      fallbackReason: `${resolved.fallbackReason ? `${resolved.fallbackReason} ` : ""}${caughtMessage} Falling back to MindAR Image.`
    };
  }
}

function parseStabilityMode(value: string | null): ARStabilityMode | null {
  if (!value) return null;
  return AR_STABILITY_MODES.includes(value as ARStabilityMode)
    ? (value as ARStabilityMode)
    : null;
}

function parseTrackingMode(value: string | null): ARTrackingMode | null {
  if (!value) return null;
  return AR_TRACKING_MODES.includes(value as ARTrackingMode)
    ? (value as ARTrackingMode)
    : null;
}

function readInitialStabilityMode(): ARStabilityMode {
  if (typeof window === "undefined") return DEFAULT_STABILITY_MODE;

  try {
    return parseStabilityMode(window.localStorage.getItem(AR_STABILITY_STORAGE_KEY)) || DEFAULT_STABILITY_MODE;
  } catch {
    return DEFAULT_STABILITY_MODE;
  }
}

function readInitialTrackingMode(): ARTrackingMode {
  if (typeof window === "undefined") return DEFAULT_TRACKING_MODE;

  try {
    return parseTrackingMode(window.localStorage.getItem(AR_TRACKING_MODE_STORAGE_KEY)) || DEFAULT_TRACKING_MODE;
  } catch {
    return DEFAULT_TRACKING_MODE;
  }
}

function getStabilityConfig(mode: ARStabilityMode) {
  return AR_STABILITY_CONFIGS[mode] || AR_STABILITY_CONFIGS[DEFAULT_STABILITY_MODE];
}

function applyRendererPixelRatio(renderer: THREE.WebGLRenderer, mode: ARStabilityMode) {
  const config = getStabilityConfig(mode);
  const deviceRatio = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const pixelRatio = Math.max(1, Math.min(deviceRatio, config.pixelRatioMax));
  renderer.setPixelRatio(pixelRatio);
  return pixelRatio;
}

function detectDeviceProfile(): DeviceProfile {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIPadOSDesktopMode =
    platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || isIPadOSDesktopMode;
  const isAndroid = /Android/i.test(userAgent);
  const browser = browserNameFromUserAgent(userAgent, isIOS);

  return {
    userAgent,
    platform,
    isAndroid,
    isIOS,
    isMobile: isAndroid || isIOS || /Mobile/i.test(userAgent),
    browser,
    iOSUsesWebKit: isIOS
  };
}

function browserNameFromUserAgent(userAgent: string, isIOS: boolean) {
  if (isIOS && /CriOS/i.test(userAgent)) return "Chrome on iOS (WebKit)";
  if (isIOS && /FxiOS/i.test(userAgent)) return "Firefox on iOS (WebKit)";
  if (isIOS && /Safari/i.test(userAgent)) return "Safari on iOS (WebKit)";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Unknown";
}

async function detectTrackingProviderSupport(): Promise<TrackingProviderSupportMap> {
  const support: TrackingProviderSupportMap = {
    ...DEFAULT_TRACKING_SUPPORT,
    "webxr-world": await detectWebXRSupport()
  };

  return support;
}

async function detectWebXRSupport(): Promise<TrackingProviderSupport> {
  const deviceProfile = detectDeviceProfile();
  const xr = (navigator as Navigator & {
    xr?: {
      isSessionSupported?: (mode: string) => Promise<boolean>;
    };
  }).xr;

  if (deviceProfile.isIOS) {
    return {
      supported: false,
      status: "unsupported",
      reason: "WebXR/ARCore is not available through iOS WebKit browsers; Chrome on iPhone uses the same WebKit limitation.",
      details: {
        browser: deviceProfile.browser,
        iOSUsesWebKit: deviceProfile.iOSUsesWebKit
      }
    };
  }

  if (!xr?.isSessionSupported) {
    return {
      supported: false,
      status: "unsupported",
      reason: "navigator.xr or immersive-ar support check is unavailable.",
      details: {
        browser: deviceProfile.browser,
        isAndroid: deviceProfile.isAndroid
      }
    };
  }

  try {
    const supported = await xr.isSessionSupported("immersive-ar");
    return {
      supported,
      status: supported ? "experimental" : "unsupported",
      reason: supported
        ? "immersive-ar is supported. The WebXR provider is guarded until world-placement calibration is implemented."
        : "immersive-ar is not supported in this browser/device.",
      details: {
        browser: deviceProfile.browser,
        isAndroid: deviceProfile.isAndroid
      }
    };
  } catch (caught) {
    return {
      supported: false,
      status: "unsupported",
      reason: caught instanceof Error ? caught.message : "WebXR support check failed.",
      details: {
        browser: deviceProfile.browser,
        isAndroid: deviceProfile.isAndroid
      }
    };
  }
}

class FrameRateTracker {
  private lastFrameAtMs = 0;
  private frameTimeEstimateMs = 0;
  private fpsEstimate = 0;

  tick(now: number) {
    if (!this.lastFrameAtMs) {
      this.lastFrameAtMs = now;
      return;
    }

    const frameTimeMs = THREE.MathUtils.clamp(now - this.lastFrameAtMs, 1, 1000);
    this.lastFrameAtMs = now;
    this.frameTimeEstimateMs = this.frameTimeEstimateMs
      ? THREE.MathUtils.lerp(this.frameTimeEstimateMs, frameTimeMs, 0.12)
      : frameTimeMs;
    this.fpsEstimate = this.frameTimeEstimateMs > 0 ? 1000 / this.frameTimeEstimateMs : 0;
  }

  debug() {
    return {
      fpsEstimate: roundForDebug(this.fpsEstimate),
      frameTimeEstimateMs: roundForDebug(this.frameTimeEstimateMs)
    };
  }
}

class PoseStabilizer {
  private rawMatrix = new THREE.Matrix4();
  private smoothedMatrix = new THREE.Matrix4();
  private stabilizedLocalMatrix = new THREE.Matrix4();
  private rawWorldInverse = new THREE.Matrix4();
  private rawPosition = new THREE.Vector3();
  private rawQuaternion = new THREE.Quaternion();
  private rawScale = new THREE.Vector3(1, 1, 1);
  private smoothedPosition = new THREE.Vector3();
  private smoothedQuaternion = new THREE.Quaternion();
  private smoothedScale = new THREE.Vector3(1, 1, 1);
  private targetVisible = false;
  private hasRawPose = false;
  private hasSmoothedPose = false;
  private lastUpdateAtMs = 0;
  private lastRawAtMs = 0;
  private lastFoundAtMs = 0;
  private lastLostAtMs = 0;
  private hasLastKnownGoodPose = false;
  private lastKnownGoodAtMs = 0;
  private lastKnownGoodPosition = new THREE.Vector3();
  private lastKnownGoodQuaternion = new THREE.Quaternion();
  private lastKnownGoodScale = new THREE.Vector3(1, 1, 1);
  private targetFoundEvents = 0;
  private targetLostEvents = 0;
  private positionJitterDeltaWorldUnits = 0;
  private positionJitterDeltaNormalized = 0;
  private rotationJitterDeltaRad = 0;
  private scaleJitterDelta = 0;
  private rawToSmoothedPositionDeltaWorldUnits = 0;
  private rawToSmoothedPositionDeltaNormalized = 0;
  private rawToSmoothedRotationDeltaRad = 0;
  private rawToSmoothedScaleDelta = 0;
  private positionNormalizationWorldUnits = 1;
  private smoothingAlpha = 0;
  private positionAlpha = 0;
  private rotationAlpha = 0;
  private scaleAlpha = 0;
  private poseLocked = false;
  private holdingPoseAfterLossActive = false;
  private stableSinceMs = 0;
  private stableSampleCount = 0;
  private releaseCandidateSinceMs = 0;
  private relockStartedAtMs = 0;
  private lockedPosition = new THREE.Vector3();
  private lockedQuaternion = new THREE.Quaternion();
  private lockedScale = new THREE.Vector3(1, 1, 1);
  private lockCandidatePosition = new THREE.Vector3();
  private lockCandidateQuaternion = new THREE.Quaternion();
  private lockCandidateScale = new THREE.Vector3(1, 1, 1);
  private hasLockCandidatePose = false;
  private lastLockCandidateAtMs = 0;
  private lockStateReason = "not-acquired";

  setRawMatrix(matrix: THREE.Matrix4, now: number) {
    if (!isUsableMatrix(matrix)) return false;

    const nextPosition = new THREE.Vector3();
    const nextQuaternion = new THREE.Quaternion();
    const nextScale = new THREE.Vector3();
    matrix.decompose(nextPosition, nextQuaternion, nextScale);

    if (!isFiniteVector(nextPosition) || !isFiniteQuaternion(nextQuaternion) || !isFiniteVector(nextScale)) {
      return false;
    }
    nextQuaternion.normalize();

    if (this.hasRawPose) {
      this.positionJitterDeltaWorldUnits = this.rawPosition.distanceTo(nextPosition);
      this.rotationJitterDeltaRad = quaternionAngularDeltaRad(this.rawQuaternion, nextQuaternion);
      this.scaleJitterDelta = scaleDelta(this.rawScale, nextScale);
    } else {
      this.positionJitterDeltaWorldUnits = 0;
      this.rotationJitterDeltaRad = 0;
      this.scaleJitterDelta = 0;
    }

    const wasHoldingPose = this.holdingPoseAfterLossActive;

    if (!this.targetVisible) {
      this.targetFoundEvents += 1;
      this.lastFoundAtMs = now;
      if (!wasHoldingPose) {
        this.hasSmoothedPose = false;
        this.resetPresentationLockState("target-found-without-held-pose", true);
        this.relockStartedAtMs = 0;
      } else {
        this.poseLocked = false;
        this.relockStartedAtMs = now;
        this.resetLockAcquisition("relocking-from-held-pose");
      }
      this.lastUpdateAtMs = 0;
    }

    this.holdingPoseAfterLossActive = false;
    this.targetVisible = true;
    this.hasRawPose = true;
    this.lastRawAtMs = now;
    this.rawMatrix.copy(matrix);
    this.rawPosition.copy(nextPosition);
    this.rawQuaternion.copy(nextQuaternion);
    this.rawScale.copy(nextScale);
    this.updatePositionNormalizationFactor();
    this.positionJitterDeltaNormalized = this.normalizePositionDelta(this.positionJitterDeltaWorldUnits);

    if (!this.hasSmoothedPose) {
      this.smoothedPosition.copy(this.rawPosition);
      this.smoothedQuaternion.copy(this.rawQuaternion);
      this.smoothedScale.copy(this.rawScale);
      this.smoothedMatrix.copy(this.rawMatrix);
      this.hasSmoothedPose = true;
      this.smoothingAlpha = 1;
      this.positionAlpha = 1;
      this.rotationAlpha = 1;
      this.scaleAlpha = 1;
      this.updateRawToSmoothedDeltas();
      this.rememberLastKnownGoodPose(now);
    }

    return true;
  }

  markTargetLost(now: number, mode: ARStabilityMode) {
    const config = getStabilityConfig(mode);
    if (this.targetVisible) {
      this.targetLostEvents += 1;
      this.lastLostAtMs = now;
    }

    this.targetVisible = false;
    this.holdingPoseAfterLossActive = false;
    this.lastUpdateAtMs = 0;
    this.smoothingAlpha = 0;
    this.positionAlpha = 0;
    this.rotationAlpha = 0;
    this.scaleAlpha = 0;
    this.relockStartedAtMs = 0;

    const shouldHoldPose =
      mode === "presentation-lock" &&
      config.extendedHoldMs > 0 &&
      (this.hasLastKnownGoodPose || this.hasSmoothedPose);
    if (shouldHoldPose) {
      if (this.hasLastKnownGoodPose) {
        this.lockedPosition.copy(this.lastKnownGoodPosition);
        this.lockedQuaternion.copy(this.lastKnownGoodQuaternion);
        this.lockedScale.copy(this.lastKnownGoodScale);
      } else {
        this.lockedPosition.copy(this.smoothedPosition);
        this.lockedQuaternion.copy(this.smoothedQuaternion);
        this.lockedScale.copy(this.smoothedScale);
        this.hasLastKnownGoodPose = true;
        this.lastKnownGoodAtMs = now;
        this.lastKnownGoodPosition.copy(this.smoothedPosition);
        this.lastKnownGoodQuaternion.copy(this.smoothedQuaternion);
        this.lastKnownGoodScale.copy(this.smoothedScale);
      }
      this.smoothedPosition.copy(this.lockedPosition);
      this.smoothedQuaternion.copy(this.lockedQuaternion);
      this.smoothedScale.copy(this.lockedScale);
      this.smoothedMatrix.compose(
        this.smoothedPosition,
        this.smoothedQuaternion,
        this.smoothedScale
      );
      this.hasSmoothedPose = true;
      this.poseLocked = true;
      this.holdingPoseAfterLossActive = true;
      this.resetLockAcquisition("holding-last-known-pose");
      this.lockStateReason = "holding-last-known-pose";
      return true;
    }

    this.hasSmoothedPose = false;
    this.resetPresentationLockState("target-lost-no-hold", true);
    return false;
  }

  isHoldingPoseAfterLoss(now: number, mode: ARStabilityMode) {
    void now;
    return (
      mode === "presentation-lock" &&
      this.holdingPoseAfterLossActive &&
      !this.targetVisible &&
      this.hasSmoothedPose &&
      this.hasLastKnownGoodPose &&
      this.lastLostAtMs > 0
    );
  }

  getLossPublicStatus(now: number, mode: ARStabilityMode): PublicStatus {
    const config = getStabilityConfig(mode);
    if (!this.isHoldingPoseAfterLoss(now, mode)) {
      return "target lost";
    }

    return this.holdPoseAgeMs(now) >= config.extendedHoldMs
      ? "target lost - move camera back to target"
      : "target lost - holding position";
  }

  getPosePublicStatus(now: number, mode: ARStabilityMode): PublicStatus | null {
    const config = getStabilityConfig(mode);

    if (this.targetVisible) {
      return this.isRelocking(now, config) ? "target re-aligning" : "target found";
    }

    if (this.isHoldingPoseAfterLoss(now, mode)) {
      return this.getLossPublicStatus(now, mode);
    }

    return null;
  }

  applyToRoot({
    targetAnchor,
    stabilizedRoot,
    mode,
    now
  }: {
    targetAnchor: THREE.Group;
    stabilizedRoot: THREE.Group;
    mode: ARStabilityMode;
    now: number;
  }) {
    const holdingAfterLoss = this.isHoldingPoseAfterLoss(now, mode);

    if ((!this.targetVisible && !holdingAfterLoss) || !this.hasRawPose || !this.hasSmoothedPose) {
      stabilizedRoot.visible = false;
      return;
    }

    const config = getStabilityConfig(mode);
    const dtMs = this.lastUpdateAtMs
      ? THREE.MathUtils.clamp(now - this.lastUpdateAtMs, 1, 80)
      : 1000 / 60;
    this.lastUpdateAtMs = now;
    this.updatePositionNormalizationFactor();
    this.updateRawToSmoothedDeltas();

    const adaptiveAlphaAt60Fps = holdingAfterLoss ? 0 : this.adaptiveAlphaAt60Fps(config);
    const alphaAt60Fps = this.isRelocking(now, config)
      ? Math.min(adaptiveAlphaAt60Fps, relockAlphaAt60Fps(config.relockBlendMs))
      : adaptiveAlphaAt60Fps;
    const frameScale = dtMs / (1000 / 60);
    const frameAlpha = 1 - Math.pow(1 - alphaAt60Fps, frameScale);
    this.smoothingAlpha = THREE.MathUtils.clamp(frameAlpha, 0, 1);

    this.updatePresentationLockState(config, mode, now);

    if (this.poseLocked || holdingAfterLoss) {
      this.smoothedPosition.copy(this.lockedPosition);
      this.smoothedQuaternion.copy(this.lockedQuaternion);
      this.smoothedScale.copy(this.lockedScale);
      this.positionAlpha = 0;
      this.rotationAlpha = 0;
      this.scaleAlpha = 0;
    } else if (this.rawToSmoothedPositionDeltaWorldUnits > config.positionDeadzoneWorldUnits) {
      this.smoothedPosition.lerp(this.rawPosition, this.smoothingAlpha);
      this.positionAlpha = this.smoothingAlpha;
    } else {
      this.positionAlpha = 0;
    }

    if (!this.poseLocked && !holdingAfterLoss && this.rawToSmoothedRotationDeltaRad > config.rotationDeadzoneRad) {
      this.smoothedQuaternion.slerp(this.rawQuaternion, this.smoothingAlpha);
      this.smoothedQuaternion.normalize();
      this.rotationAlpha = this.smoothingAlpha;
    } else if (!this.poseLocked && !holdingAfterLoss) {
      this.rotationAlpha = 0;
    }

    if (!this.poseLocked && !holdingAfterLoss && this.rawToSmoothedScaleDelta > config.scaleDeadzone) {
      this.smoothedScale.lerp(this.rawScale, this.smoothingAlpha);
      this.scaleAlpha = this.smoothingAlpha;
    } else if (!this.poseLocked && !holdingAfterLoss) {
      this.scaleAlpha = 0;
    }

    this.smoothedMatrix.compose(
      this.smoothedPosition,
      this.smoothedQuaternion,
      this.smoothedScale
    );
    this.updateRawToSmoothedDeltas();
    if (this.relockStartedAtMs && !this.isRelocking(now, config)) {
      this.relockStartedAtMs = 0;
    }

    targetAnchor.updateMatrixWorld(true);
    this.rawWorldInverse.copy(targetAnchor.matrixWorld).invert();
    this.stabilizedLocalMatrix.copy(this.rawWorldInverse).multiply(this.smoothedMatrix);

    if (!isUsableMatrix(this.stabilizedLocalMatrix)) {
      stabilizedRoot.visible = false;
      return;
    }

    stabilizedRoot.matrix.copy(this.stabilizedLocalMatrix);
    stabilizedRoot.matrixWorldNeedsUpdate = true;
    stabilizedRoot.visible = true;
    stabilizedRoot.updateMatrixWorld(true);

    if (this.targetVisible) {
      this.rememberLastKnownGoodPose(now);
    }
  }

  debug(now: number, mode: ARStabilityMode) {
    const config = getStabilityConfig(mode);
    this.updatePositionNormalizationFactor();
    this.updateRawToSmoothedDeltas();
    const rawRotation = new THREE.Euler().setFromQuaternion(this.rawQuaternion, "XYZ");
    const smoothedRotation = new THREE.Euler().setFromQuaternion(this.smoothedQuaternion, "XYZ");

    return {
      currentStabilityMode: config.label,
      currentStabilityModeKey: mode,
      posePositionUnits: "Three.js / MindAR world units; not physical meters.",
      posePositionNormalizedUnits: "Position deltas normalized by max(raw distance from camera, pose scale, 1).",
      targetVisible: this.targetVisible,
      hasRawPose: this.hasRawPose,
      hasSmoothedPose: this.hasSmoothedPose,
      presentationLocked: this.poseLocked,
      presentationLockState: this.lockStateReason,
      lockedPresentationPose: this.poseLocked
        ? transformDebugFromParts(this.lockedPosition, this.lockedQuaternion, this.lockedScale)
        : null,
      holdingPoseAfterLoss: this.isHoldingPoseAfterLoss(now, mode),
      holdPoseAgeMs: this.isHoldingPoseAfterLoss(now, mode) ? roundForDebug(this.holdPoseAgeMs(now)) : 0,
      shortHoldMs: config.shortHoldMs,
      extendedHoldMs: config.extendedHoldMs,
      relockingTarget: this.isRelocking(now, config),
      relockAgeMs: this.relockStartedAtMs ? roundForDebug(now - this.relockStartedAtMs) : 0,
      relockBlendMs: config.relockBlendMs,
      lockAcquireStableMs: config.lockAcquireStableMs,
      lockStableForMs: this.stableSinceMs ? roundForDebug(now - this.stableSinceMs) : 0,
      lockStableSampleCount: this.stableSampleCount,
      lockReleaseStableMs: config.lockReleaseStableMs,
      lockReleaseCandidateForMs: this.releaseCandidateSinceMs
        ? roundForDebug(now - this.releaseCandidateSinceMs)
        : 0,
      lockCandidatePose: this.hasLockCandidatePose
        ? transformDebugFromParts(
            this.lockCandidatePosition,
            this.lockCandidateQuaternion,
            this.lockCandidateScale
          )
        : null,
      lastKnownGoodPose: this.hasLastKnownGoodPose
        ? transformDebugFromParts(
            this.lastKnownGoodPosition,
            this.lastKnownGoodQuaternion,
            this.lastKnownGoodScale
          )
        : null,
      lastKnownGoodPoseAgeMs: this.lastKnownGoodAtMs
        ? roundForDebug(now - this.lastKnownGoodAtMs)
        : null,
      rawTargetPose: this.hasRawPose ? transformDebugFromMatrix(this.rawMatrix) : null,
      smoothedTargetPose: this.hasSmoothedPose
        ? transformDebugFromParts(this.smoothedPosition, this.smoothedQuaternion, this.smoothedScale)
        : null,
      rawRotationEulerDeg: this.hasRawPose ? eulerDegreesDebug(rawRotation) : null,
      smoothedRotationEulerDeg: this.hasSmoothedPose ? eulerDegreesDebug(smoothedRotation) : null,
      rawQuaternion: this.hasRawPose ? quaternionDebug(this.rawQuaternion) : null,
      smoothedQuaternion: this.hasSmoothedPose ? quaternionDebug(this.smoothedQuaternion) : null,
      positionNormalizationWorldUnits: roundForDebug(this.positionNormalizationWorldUnits),
      positionJitterDeltaWorldUnits: roundForDebug(this.positionJitterDeltaWorldUnits),
      positionJitterDeltaNormalized: roundForDebug(this.positionJitterDeltaNormalized),
      rotationJitterDeltaDeg: roundForDebug(THREE.MathUtils.radToDeg(this.rotationJitterDeltaRad)),
      scaleJitterDelta: roundForDebug(this.scaleJitterDelta),
      rawToSmoothedPositionDeltaWorldUnits: roundForDebug(this.rawToSmoothedPositionDeltaWorldUnits),
      rawToSmoothedPositionDeltaNormalized: roundForDebug(this.rawToSmoothedPositionDeltaNormalized),
      rawToSmoothedRotationDeltaDeg: roundForDebug(
        THREE.MathUtils.radToDeg(this.rawToSmoothedRotationDeltaRad)
      ),
      rawToSmoothedScaleDelta: roundForDebug(this.rawToSmoothedScaleDelta),
      smoothingAlpha: roundForDebug(this.smoothingAlpha),
      positionAlpha: roundForDebug(this.positionAlpha),
      rotationAlpha: roundForDebug(this.rotationAlpha),
      scaleAlpha: roundForDebug(this.scaleAlpha),
      thresholds: {
        positionDeadzoneWorldUnits: roundForDebug(config.positionDeadzoneWorldUnits),
        rotationDeg: roundForDebug(THREE.MathUtils.radToDeg(config.rotationDeadzoneRad)),
        scale: roundForDebug(config.scaleDeadzone),
        lockAcquirePositionThresholdNormalized: roundForDebug(
          config.lockAcquirePositionThresholdNormalized
        ),
        lockReleasePositionThresholdNormalized: roundForDebug(
          config.lockReleasePositionThresholdNormalized
        ),
        lockReleaseRotationDeg: roundForDebug(THREE.MathUtils.radToDeg(config.lockReleaseRotationRad)),
        lockReleaseScale: roundForDebug(config.lockReleaseScale)
      },
      targetFoundEvents: this.targetFoundEvents,
      targetLostEvents: this.targetLostEvents,
      timeSinceLastTargetFoundMs: this.lastFoundAtMs
        ? roundForDebug(now - this.lastFoundAtMs)
        : null,
      timeSinceLastTargetLostMs: this.lastLostAtMs
        ? roundForDebug(now - this.lastLostAtMs)
        : null,
      lastRawPoseAgeMs: this.lastRawAtMs ? roundForDebug(now - this.lastRawAtMs) : null
    };
  }

  private adaptiveAlphaAt60Fps(config: ARStabilityConfig) {
    const positionMotion = normalizedMotion(
      Math.max(this.rawToSmoothedPositionDeltaWorldUnits, this.positionJitterDeltaWorldUnits),
      config.positionDeadzoneWorldUnits,
      config.positionCatchupWorldUnits
    );
    const rotationMotion = normalizedMotion(
      Math.max(this.rawToSmoothedRotationDeltaRad, this.rotationJitterDeltaRad),
      config.rotationDeadzoneRad,
      config.rotationCatchupRad
    );
    const scaleMotion = normalizedMotion(
      Math.max(this.rawToSmoothedScaleDelta, this.scaleJitterDelta),
      config.scaleDeadzone,
      config.scaleCatchup
    );
    const motion = Math.max(positionMotion, rotationMotion, scaleMotion);

    return THREE.MathUtils.lerp(config.minAlphaAt60Fps, config.maxAlphaAt60Fps, motion);
  }

  private updateRawToSmoothedDeltas() {
    this.rawToSmoothedPositionDeltaWorldUnits = this.smoothedPosition.distanceTo(this.rawPosition);
    this.rawToSmoothedPositionDeltaNormalized = this.normalizePositionDelta(
      this.rawToSmoothedPositionDeltaWorldUnits
    );
    this.rawToSmoothedRotationDeltaRad = quaternionAngularDeltaRad(
      this.smoothedQuaternion,
      this.rawQuaternion
    );
    this.rawToSmoothedScaleDelta = scaleDelta(this.smoothedScale, this.rawScale);
  }

  private updatePresentationLockState(config: ARStabilityConfig, mode: ARStabilityMode, now: number) {
    if (mode !== "presentation-lock") {
      this.resetPresentationLockState("mode-not-presentation-lock", true);
      return;
    }

    if (!this.targetVisible) {
      this.resetLockAcquisition("target-not-visible");
      return;
    }

    const acquireRotationThreshold = Math.max(
      config.rotationDeadzoneRad * 4,
      config.lockReleaseRotationRad * 0.75
    );
    const acquireScaleThreshold = Math.max(config.scaleDeadzone * 4, config.lockReleaseScale * 0.75);
    const stableRawMotion =
      this.positionJitterDeltaNormalized <= config.lockAcquirePositionThresholdNormalized &&
      this.rotationJitterDeltaRad <= acquireRotationThreshold &&
      this.scaleJitterDelta <= acquireScaleThreshold;

    const rawToLockedPositionDeltaNormalized = this.normalizePositionDelta(
      this.rawPosition.distanceTo(this.lockedPosition)
    );
    const realMovementDetected =
      rawToLockedPositionDeltaNormalized > config.lockReleasePositionThresholdNormalized ||
      quaternionAngularDeltaRad(this.rawQuaternion, this.lockedQuaternion) > config.lockReleaseRotationRad ||
      scaleDelta(this.rawScale, this.lockedScale) > config.lockReleaseScale;

    if (this.poseLocked && realMovementDetected) {
      if (!this.releaseCandidateSinceMs) {
        this.releaseCandidateSinceMs = now;
      }

      if (now - this.releaseCandidateSinceMs >= config.lockReleaseStableMs) {
        this.poseLocked = false;
        this.resetLockAcquisition("released-after-sustained-movement");
        this.releaseCandidateSinceMs = 0;
        this.relockStartedAtMs = now;
      }
      return;
    }

    this.releaseCandidateSinceMs = 0;

    if (this.poseLocked) {
      this.lockStateReason = "locked";
      return;
    }

    if (!stableRawMotion) {
      this.resetLockAcquisition("raw-pose-not-stable");
      return;
    }

    this.updateLockCandidatePose(now);

    const rawToCandidatePositionDeltaNormalized = this.normalizePositionDelta(
      this.rawPosition.distanceTo(this.lockCandidatePosition)
    );
    const candidateCloseEnough =
      rawToCandidatePositionDeltaNormalized <= config.lockReleasePositionThresholdNormalized &&
      quaternionAngularDeltaRad(this.rawQuaternion, this.lockCandidateQuaternion) <=
        config.lockReleaseRotationRad &&
      scaleDelta(this.rawScale, this.lockCandidateScale) <= config.lockReleaseScale;

    if (!candidateCloseEnough) {
      this.stableSinceMs = 0;
      this.stableSampleCount = 0;
      this.lockStateReason = "averaging-candidate-pose";
      return;
    }

    if (!this.stableSinceMs) {
      this.stableSinceMs = now;
      this.stableSampleCount = 1;
    } else {
      this.stableSampleCount += 1;
    }

    if (
      this.stableSinceMs &&
      now - this.stableSinceMs >= config.lockAcquireStableMs &&
      this.stableSampleCount >= LOCK_MIN_STABLE_SAMPLES
    ) {
      this.poseLocked = true;
      this.lockedPosition.copy(this.lockCandidatePosition);
      this.lockedQuaternion.copy(this.lockCandidateQuaternion);
      this.lockedScale.copy(this.lockCandidateScale);
      this.lockStateReason = "locked";
      this.rememberLastKnownGoodPose(now);
    }
  }

  private updateLockCandidatePose(now: number) {
    if (!this.hasLockCandidatePose) {
      this.lockCandidatePosition.copy(this.hasSmoothedPose ? this.smoothedPosition : this.rawPosition);
      this.lockCandidateQuaternion.copy(
        this.hasSmoothedPose ? this.smoothedQuaternion : this.rawQuaternion
      );
      this.lockCandidateScale.copy(this.hasSmoothedPose ? this.smoothedScale : this.rawScale);
      this.hasLockCandidatePose = true;
      this.lastLockCandidateAtMs = now;
      return;
    }

    const dtMs = this.lastLockCandidateAtMs
      ? THREE.MathUtils.clamp(now - this.lastLockCandidateAtMs, 1, 120)
      : 1000 / 60;
    this.lastLockCandidateAtMs = now;
    const alpha = frameAlphaFromAlphaAt60Fps(LOCK_CANDIDATE_ALPHA_AT_60_FPS, dtMs);
    this.lockCandidatePosition.lerp(this.rawPosition, alpha);
    this.lockCandidateQuaternion.slerp(this.rawQuaternion, alpha);
    this.lockCandidateQuaternion.normalize();
    this.lockCandidateScale.lerp(this.rawScale, alpha);
  }

  private resetLockAcquisition(reason: string) {
    this.stableSinceMs = 0;
    this.stableSampleCount = 0;
    this.releaseCandidateSinceMs = 0;
    this.hasLockCandidatePose = false;
    this.lastLockCandidateAtMs = 0;
    this.lockStateReason = this.poseLocked ? "locked" : reason;
  }

  private resetPresentationLockState(reason: string, clearLockedPose: boolean) {
    this.poseLocked = false;
    this.holdingPoseAfterLossActive = false;
    this.resetLockAcquisition(reason);
    if (clearLockedPose) {
      this.lockedPosition.set(0, 0, 0);
      this.lockedQuaternion.identity();
      this.lockedScale.set(1, 1, 1);
    }
    this.lockStateReason = reason;
  }

  private updatePositionNormalizationFactor() {
    this.positionNormalizationWorldUnits = Math.max(
      this.rawPosition.length(),
      this.smoothedPosition.length(),
      Math.abs(this.rawScale.x),
      Math.abs(this.rawScale.y),
      Math.abs(this.rawScale.z),
      Math.abs(this.smoothedScale.x),
      Math.abs(this.smoothedScale.y),
      Math.abs(this.smoothedScale.z),
      1
    );
    this.positionJitterDeltaNormalized = this.normalizePositionDelta(this.positionJitterDeltaWorldUnits);
  }

  private normalizePositionDelta(deltaWorldUnits: number) {
    return deltaWorldUnits / Math.max(this.positionNormalizationWorldUnits, 0.000001);
  }

  private rememberLastKnownGoodPose(now: number) {
    this.hasLastKnownGoodPose = true;
    this.lastKnownGoodAtMs = now;
    this.lastKnownGoodPosition.copy(this.smoothedPosition);
    this.lastKnownGoodQuaternion.copy(this.smoothedQuaternion);
    this.lastKnownGoodScale.copy(this.smoothedScale);
  }

  private holdPoseAgeMs(now: number) {
    return this.lastLostAtMs ? Math.max(0, now - this.lastLostAtMs) : 0;
  }

  private isRelocking(now: number, config: ARStabilityConfig) {
    return (
      this.targetVisible &&
      this.relockStartedAtMs > 0 &&
      config.relockBlendMs > 0 &&
      now - this.relockStartedAtMs < config.relockBlendMs
    );
  }
}

function normalizedMotion(value: number, deadzone: number, catchup: number) {
  const range = Math.max(catchup - deadzone, 0.000001);
  return THREE.MathUtils.clamp((value - deadzone) / range, 0, 1);
}

function relockAlphaAt60Fps(blendMs: number) {
  if (blendMs <= 0) return 1;
  return THREE.MathUtils.clamp(1 - Math.pow(0.08, (1000 / 60) / blendMs), 0.02, 0.22);
}

function frameAlphaFromAlphaAt60Fps(alphaAt60Fps: number, dtMs: number) {
  const frameScale = THREE.MathUtils.clamp(dtMs / (1000 / 60), 0.05, 8);
  return THREE.MathUtils.clamp(1 - Math.pow(1 - alphaAt60Fps, frameScale), 0, 1);
}

function quaternionAngularDeltaRad(first: THREE.Quaternion, second: THREE.Quaternion) {
  const firstNormalized = first.clone().normalize();
  const secondNormalized = second.clone().normalize();
  return firstNormalized.angleTo(secondNormalized);
}

function scaleDelta(first: THREE.Vector3, second: THREE.Vector3) {
  return Math.max(
    Math.abs(first.x - second.x),
    Math.abs(first.y - second.y),
    Math.abs(first.z - second.z)
  );
}

function isFiniteVector(vector: THREE.Vector3) {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isFiniteQuaternion(quaternion: THREE.Quaternion) {
  return (
    Number.isFinite(quaternion.x) &&
    Number.isFinite(quaternion.y) &&
    Number.isFinite(quaternion.z) &&
    Number.isFinite(quaternion.w)
  );
}

function isUsableMatrix(matrix: THREE.Matrix4) {
  return matrix.elements.every(Number.isFinite) && Math.abs(matrix.determinant()) > 1e-12;
}

function createPostMatrix(targetWidth: number, targetHeight: number) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  position.x = targetWidth / 2;
  position.y = targetWidth / 2 + (targetHeight - targetWidth) / 2;
  scale.set(targetWidth, targetWidth, targetWidth);
  const matrix = new THREE.Matrix4();
  matrix.compose(position, quaternion, scale);
  return matrix;
}

function createMarkerLocalSheetMatrix(marker: MarkerSheetMarker, target: ImageTargetSettings) {
  const sheetAspect = target.heightMm / target.widthMm;
  const markerCenterX = marker.x + marker.width / 2;
  const markerCenterY = marker.y + marker.height / 2;
  const position = new THREE.Vector3(
    markerCenterX - 0.5,
    (0.5 - markerCenterY) * sheetAspect,
    0
  );
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    THREE.MathUtils.degToRad(marker.rotationDeg)
  );
  const markerScaleBySheetWidth = marker.widthMm / target.widthMm;
  const scale = new THREE.Vector3(
    markerScaleBySheetWidth,
    markerScaleBySheetWidth,
    markerScaleBySheetWidth
  );
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function fuseSheetMatrices(matrices: THREE.Matrix4[]) {
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const currentPosition = new THREE.Vector3();
  const currentScale = new THREE.Vector3();
  const currentQuaternion = new THREE.Quaternion();

  matrices.forEach((matrix, index) => {
    matrix.decompose(currentPosition, currentQuaternion, currentScale);
    if (index === 0) {
      position.copy(currentPosition);
      quaternion.copy(currentQuaternion).normalize();
      scale.copy(currentScale);
      return;
    }

    const weight = 1 / (index + 1);
    position.lerp(currentPosition, weight);
    if (quaternion.dot(currentQuaternion) < 0) {
      currentQuaternion.set(
        -currentQuaternion.x,
        -currentQuaternion.y,
        -currentQuaternion.z,
        -currentQuaternion.w
      );
    }
    quaternion.slerp(currentQuaternion, weight).normalize();
    scale.lerp(currentScale, weight);
  });

  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function markerSheetPositionDebug(marker: MarkerSheetMarker, target: ImageTargetSettings | null) {
  const sheetWidthMm = target?.widthMm || 1;
  const sheetHeightMm = target?.heightMm || 1;
  const centerX = marker.x + marker.width / 2;
  const centerY = marker.y + marker.height / 2;

  return {
    normalizedTopLeft: {
      x: roundForDebug(marker.x),
      y: roundForDebug(marker.y),
      width: roundForDebug(marker.width),
      height: roundForDebug(marker.height)
    },
    centerMmFromSheetCenter: {
      x: roundForDebug((centerX - 0.5) * sheetWidthMm),
      y: roundForDebug((0.5 - centerY) * sheetHeightMm),
      z: 0
    },
    rotationDeg: marker.rotationDeg
  };
}

function resizeTrackingView({
  video,
  renderer,
  camera,
  provider,
  resizeDebug,
  reason
}: {
  video: HTMLVideoElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  provider: TrackingProvider;
  resizeDebug: ResizeDebugState;
  reason: string;
}) {
  video.width = video.videoWidth;
  video.height = video.videoHeight;
  const calibration = provider.getCameraCalibration();
  const { width: containerWidth, height: containerHeight } = stableLayoutViewportSize();

  const videoRatio = video.videoWidth / video.videoHeight;
  const containerRatio = containerWidth / containerHeight;
  let videoDisplayWidth: number;
  let videoDisplayHeight: number;

  if (videoRatio > containerRatio) {
    videoDisplayHeight = containerHeight;
    videoDisplayWidth = videoDisplayHeight * videoRatio;
  } else {
    videoDisplayWidth = containerWidth;
    videoDisplayHeight = videoDisplayWidth / videoRatio;
  }

  if (calibration) {
    const projection = calibration.projectionMatrix;
    const inputRatio = calibration.inputWidth / calibration.inputHeight;
    const inputAdjust =
      inputRatio > containerRatio
        ? video.width / calibration.inputWidth
        : video.height / calibration.inputHeight;
    const adjustedVideoHeight =
      inputRatio > containerRatio
        ? containerHeight * inputAdjust
        : (containerWidth / calibration.inputWidth) * calibration.inputHeight * inputAdjust;
    const fovAdjust = containerHeight / adjustedVideoHeight;
    const fov = 2 * Math.atan((1 / projection[5]) * fovAdjust) * (180 / Math.PI);
    const near = projection[14] / (projection[10] - 1);
    const far = projection[14] / (projection[10] + 1);

    camera.fov = fov;
    camera.near = near;
    camera.far = far;
  } else {
    camera.fov = 60;
    camera.near = 0.01;
    camera.far = 100;
  }

  camera.aspect = containerWidth / containerHeight;
  camera.updateProjectionMatrix();

  Object.assign(video.style, {
    position: "fixed",
    top: `${-(videoDisplayHeight - containerHeight) / 2}px`,
    left: `${-(videoDisplayWidth - containerWidth) / 2}px`,
    width: `${videoDisplayWidth}px`,
    height: `${videoDisplayHeight}px`
  });

  Object.assign(renderer.domElement.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh"
  });
  const currentSize = renderer.getSize(new THREE.Vector2());
  if (
    Math.round(currentSize.x) !== containerWidth ||
    Math.round(currentSize.y) !== containerHeight
  ) {
    const previousCanvasWidth = renderer.domElement.width;
    const previousCanvasHeight = renderer.domElement.height;
    renderer.setSize(containerWidth, containerHeight, false);
    resizeDebug.rendererSetSizeCount += 1;

    if (
      renderer.domElement.width !== previousCanvasWidth ||
      renderer.domElement.height !== previousCanvasHeight
    ) {
      resizeDebug.canvasResizeCount += 1;
    }
  }

  resizeDebug.lastResizeReason = reason;
  resizeDebug.lastRendererSize = {
    width: containerWidth,
    height: containerHeight
  };
}

function createDebugCube() {
  const size = 50 / 1000;
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({ color: 0xff1f1f })
  );
  cube.position.set(0, 0, size / 2);
  return cube;
}

function targetSizeDebug(target: Pick<ImageTargetSettings, "widthMm" | "heightMm">) {
  const geometry = getImageTargetGeometry(target);
  return {
    widthMm: roundForDebug(geometry.widthMm),
    heightMm: roundForDebug(geometry.heightMm),
    widthM: roundForDebug(geometry.widthM),
    heightM: roundForDebug(geometry.heightM),
    aspectRatio: roundForDebug(geometry.aspectRatio),
    normalizedHeight: roundForDebug(geometry.normalizedHeight)
  };
}

function targetPixelSizeDebug(target: Pick<ImageTargetSettings, "pixelWidth" | "pixelHeight">) {
  const width = Math.max(Math.round(finiteNumber(target.pixelWidth, MASTERPLAN_TARGET_PIXEL_WIDTH)), 1);
  const height = Math.max(Math.round(finiteNumber(target.pixelHeight, MASTERPLAN_TARGET_PIXEL_HEIGHT)), 1);

  return {
    width,
    height,
    aspectRatio: roundForDebug(width / height)
  };
}

function targetDebug(target: ImageTargetSettings) {
  return {
    targetVersion: target.targetVersion,
    imageUrl: target.imageUrl,
    previewUrl: target.previewUrl,
    mindUrl: target.mindUrl,
    pixelSize: targetPixelSizeDebug(target),
    physicalSize: targetSizeDebug(target),
    markerSheet: {
      sheetId: target.markerSheet.sheetId,
      version: target.markerSheet.version,
      format: target.markerSheet.format,
      orientation: target.markerSheet.orientation,
      maxTrack: target.markerSheet.maxTrack,
      manifestUrl: target.markerSheet.manifestUrl,
      markerCount: target.markerSheet.markers.length,
      markers: target.markerSheet.markers.map((marker) => ({
        id: marker.id,
        targetIndex: marker.targetIndex,
        role: marker.role,
        x: roundForDebug(marker.x),
        y: roundForDebug(marker.y),
        width: roundForDebug(marker.width),
        height: roundForDebug(marker.height),
        rotationDeg: marker.rotationDeg
      }))
    }
  };
}

function transformDebugFromRuntime(transform: {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  rotation: THREE.Euler;
  scale: number;
}): TransformDebug {
  void transform.rotation;
  const rotation = new THREE.Euler().setFromQuaternion(transform.quaternion, "XYZ");

  return {
    position: vectorDebug(transform.position),
    rotation: eulerDegreesDebug(rotation),
    scale: vectorDebug(new THREE.Vector3(transform.scale, transform.scale, transform.scale))
  };
}

function transformDebugFromMatrix(matrix: THREE.Matrix4): TransformDebug {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  matrix.decompose(position, quaternion, scale);
  return transformDebugFromParts(position, quaternion, scale);
}

function transformDebugFromParts(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3
): TransformDebug {
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");

  return {
    position: vectorDebug(position),
    rotation: eulerDegreesDebug(rotation),
    scale: vectorDebug(scale)
  };
}

function buildLiveDebugSnapshot({
  video,
  renderer,
  targetAnchor,
  stabilizedRoot,
  boardReferenceGroup,
  desktopViewportTransformGroup,
  modelCorrectionGroup,
  scaleRoot,
  target,
  activeModel,
  activeCorrectionMetrics,
  targetVisible,
  stabilityMode,
  selectedTrackingMode,
  trackingProvider,
  trackingSupport,
  deviceProfile,
  poseStabilizer,
  frameRateTracker,
  resizeDebug,
  now
}: {
  video: HTMLVideoElement;
  renderer: THREE.WebGLRenderer;
  targetAnchor: THREE.Group;
  stabilizedRoot: THREE.Group;
  boardReferenceGroup: THREE.Group;
  desktopViewportTransformGroup: THREE.Group;
  modelCorrectionGroup: THREE.Group;
  scaleRoot: THREE.Group;
  target: ImageTargetSettings;
  activeModel: THREE.Object3D | null;
  activeCorrectionMetrics: ModelCorrectionMetrics | null;
  targetVisible: boolean;
  stabilityMode: ARStabilityMode;
  selectedTrackingMode: ARTrackingMode;
  trackingProvider: TrackingProvider | null;
  trackingSupport: TrackingProviderSupportMap;
  deviceProfile: DeviceProfile;
  poseStabilizer: PoseStabilizer;
  frameRateTracker: FrameRateTracker;
  resizeDebug: ResizeDebugState;
  now: number;
}) {
  const correctedBounds = boundsDebug(modelCorrectionGroup);
  const stabilityConfig = getStabilityConfig(stabilityMode);
  const frameDebug = frameRateTracker.debug();
  const modelStats = collectModelPerformanceStats(activeModel);
  const viewport = viewportDebug();
  const providerState = trackingProvider?.getTrackingState() || null;

  return {
    sampledAt: new Date().toISOString(),
    trackingMode: trackingProvider?.label || "",
    selectedTrackingMode,
    selectedTrackingModeLabel: TRACKING_MODE_LABELS[selectedTrackingMode],
    activeTrackingProvider: trackingProvider?.id || "",
    activeTrackingProviderLabel: trackingProvider?.label || "",
    activeTarget: targetDebug(target),
    providerSupportStatus: trackingSupport,
    providerDebugState: trackingProvider?.getDebugState() || null,
    mindARStatus: trackingProvider?.id === "mindar-image" ? trackingProvider.getDebugState() : null,
    multiMarkerModeActive: target.markerSheet.markers.length > 1,
    activeSheet: {
      sheetId: target.markerSheet.sheetId,
      version: target.markerSheet.version,
      format: target.markerSheet.format,
      orientation: target.markerSheet.orientation,
      markerCount: target.markerSheet.markers.length,
      manifestUrl: target.markerSheet.manifestUrl
    },
    activeMarker: providerState
      ? {
          id: providerState.activeMarkerId,
          role: providerState.activeMarkerRole,
          targetIndex: providerState.activeTargetIndex,
          visibleMarkerCount: providerState.visibleMarkerCount,
          poseSource: providerState.poseSource
        }
      : null,
    webXRSupportCheck: trackingSupport["webxr-world"],
    deviceProfile,
    stabilityMode: stabilityConfig.label,
    stabilityModeKey: stabilityMode,
    fpsEstimate: frameDebug.fpsEstimate,
    frameTimeEstimateMs: frameDebug.frameTimeEstimateMs,
    targetVisible,
    rendererPixelRatio: roundForDebug(renderer.getPixelRatio()),
    viewport,
    viewportSize: {
      width: viewport.width,
      height: viewport.height
    },
    canvasResizeCount: resizeDebug.canvasResizeCount,
    rendererSetSizeCount: resizeDebug.rendererSetSizeCount,
    arSceneRemountCount: resizeDebug.arSceneRemountCount,
    lastResizeReason: resizeDebug.lastResizeReason,
    lastRendererSize: resizeDebug.lastRendererSize,
    videoResolution: {
      width: video.videoWidth,
      height: video.videoHeight
    },
    video: {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      clientWidth: video.clientWidth,
      clientHeight: video.clientHeight,
      readyState: video.readyState
    },
    stability: poseStabilizer.debug(now, stabilityMode),
    rawTargetAnchorTransform: objectLocalDebug(targetAnchor),
    smoothedTargetTransform: objectWorldDebug(stabilizedRoot),
    stabilizedRootLocalTransform: objectLocalDebug(stabilizedRoot),
    modelLoaded: Boolean(activeModel),
    modelStats,
    targetAnchorWorld: objectWorldDebug(targetAnchor),
    stabilizedRootWorld: objectWorldDebug(stabilizedRoot),
    boardReferenceWorld: objectWorldDebug(boardReferenceGroup),
    desktopViewportTransform: objectLocalDebug(desktopViewportTransformGroup),
    modelCorrectionTransform: objectLocalDebug(modelCorrectionGroup),
    scaleRootTransform: objectLocalDebug(scaleRoot),
    modelWorld: activeModel ? objectWorldDebug(activeModel) : null,
    modelLocal: activeModel ? objectLocalDebug(activeModel) : null,
    boundsBeforeCorrection: activeCorrectionMetrics
      ? boundsInfoDebug(activeCorrectionMetrics.boundsBeforeCorrection)
      : null,
    boundsAfterCorrection: activeCorrectionMetrics
      ? boundsInfoDebug(activeCorrectionMetrics.boundsAfterCorrection)
      : null,
    correctedBounds,
    longestDimensionAxisAfterTransforms: longestAxisFromDebugBounds(correctedBounds)
  };
}

function forceVisibleModel(root: THREE.Object3D) {
  root.visible = true;
  root.traverse((child) => {
    child.visible = true;

    if (!(child instanceof THREE.Mesh)) return;

    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.visible = true;
      if (!Number.isFinite(material.opacity) || material.opacity <= 0) {
        material.opacity = 1;
        material.transparent = false;
      }
      material.needsUpdate = true;
    });
  });
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function boundsDebug(object: THREE.Object3D): BoundsDebug {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const valid = isFiniteBox(box) && !box.isEmpty();
  const size = valid ? box.getSize(new THREE.Vector3()) : new THREE.Vector3();

  return {
    min: vectorDebug(valid ? box.min : new THREE.Vector3()),
    max: vectorDebug(valid ? box.max : new THREE.Vector3()),
    size: vectorDebug(size),
    valid
  };
}

function boundsInfoDebug(bounds: ModelBoundsInfo): BoundsDebug {
  return {
    min: vectorDebug(bounds.min),
    max: vectorDebug(bounds.max),
    size: vectorDebug(bounds.size),
    valid: bounds.valid
  };
}

function longestAxisFromDebugBounds(bounds: BoundsDebug) {
  const { size } = bounds;
  if (size.x >= size.y && size.x >= size.z) return "x";
  if (size.y >= size.x && size.y >= size.z) return "y";
  return "z";
}

function isFiniteBox(box: THREE.Box3) {
  return (
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z)
  );
}

function objectLocalDebug(object: THREE.Object3D): TransformDebug {
  if (!object.matrixAutoUpdate) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Euler();
    object.matrix.decompose(position, quaternion, scale);
    rotation.setFromQuaternion(quaternion);

    return {
      position: vectorDebug(position),
      rotation: eulerDegreesDebug(rotation),
      scale: vectorDebug(scale)
    };
  }

  return {
    position: vectorDebug(object.position),
    rotation: eulerDegreesDebug(object.rotation),
    scale: vectorDebug(object.scale)
  };
}

function objectWorldDebug(object: THREE.Object3D): TransformDebug {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Euler();

  object.updateMatrixWorld(true);
  object.getWorldPosition(position);
  object.getWorldQuaternion(quaternion);
  object.getWorldScale(scale);
  rotation.setFromQuaternion(quaternion);

  return {
    position: vectorDebug(position),
    rotation: eulerDegreesDebug(rotation),
    scale: vectorDebug(scale)
  };
}

function finiteNumber(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundForDebug(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100000) / 100000 : value;
}

function vectorDebug(vector: { x: number; y: number; z: number }) {
  return {
    x: roundForDebug(finiteNumber(vector.x, 0)),
    y: roundForDebug(finiteNumber(vector.y, 0)),
    z: roundForDebug(finiteNumber(vector.z, 0))
  };
}

function quaternionDebug(quaternion: THREE.Quaternion) {
  return {
    x: roundForDebug(finiteNumber(quaternion.x, 0)),
    y: roundForDebug(finiteNumber(quaternion.y, 0)),
    z: roundForDebug(finiteNumber(quaternion.z, 0)),
    w: roundForDebug(finiteNumber(quaternion.w, 1))
  };
}

function eulerDegreesDebug(euler: THREE.Euler) {
  return {
    x: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.x, 0))),
    y: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.y, 0))),
    z: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.z, 0)))
  };
}

function viewportDebug() {
  const stableViewport = stableLayoutViewportSize();
  return {
    width: stableViewport.width,
    height: stableViewport.height,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    visualViewportWidth: window.visualViewport?.width || null,
    visualViewportHeight: window.visualViewport?.height || null,
    visualViewportScale: window.visualViewport?.scale || null,
    orientation: window.screen.orientation?.type || ""
  };
}

function stableLayoutViewportSize() {
  const documentElement = document.documentElement;
  return {
    width: Math.max(Math.round(window.innerWidth || documentElement.clientWidth || 1), 1),
    height: Math.max(Math.round(window.innerHeight || documentElement.clientHeight || 1), 1)
  };
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}
