"use client";

import Link from "next/link";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { applyMindARBoardSpaceRoot } from "@/lib/coordinates";
import {
  MASTERPLAN_TARGET_IMAGE_URL,
  getImageTargetGeometry,
  type ImageTargetSettings,
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
  positionDeadzoneM: number;
  rotationDeadzoneRad: number;
  scaleDeadzone: number;
  minAlphaAt60Fps: number;
  maxAlphaAt60Fps: number;
  positionCatchupM: number;
  rotationCatchupRad: number;
  scaleCatchup: number;
  pixelRatioMax: number;
  lostPoseGraceMs: number;
  lockStableAfterMs: number;
  lockReleasePositionM: number;
  lockReleaseRotationRad: number;
  lockReleaseScale: number;
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
};

type TrackingState = {
  providerId: TrackingProviderId;
  label: string;
  initialized: boolean;
  running: boolean;
  targetVisible: boolean;
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

const AR_STABILITY_CONFIGS: Record<ARStabilityMode, ARStabilityConfig> = {
  realtime: {
    label: "Realtime",
    positionDeadzoneM: 0.0003,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.08),
    scaleDeadzone: 0.0006,
    minAlphaAt60Fps: 0.65,
    maxAlphaAt60Fps: 0.98,
    positionCatchupM: 0.025,
    rotationCatchupRad: THREE.MathUtils.degToRad(5),
    scaleCatchup: 0.02,
    pixelRatioMax: 2,
    lostPoseGraceMs: 0,
    lockStableAfterMs: 0,
    lockReleasePositionM: 0.02,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(4),
    lockReleaseScale: 0.02
  },
  balanced: {
    label: "Balanced",
    positionDeadzoneM: 0.0012,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.25),
    scaleDeadzone: 0.0015,
    minAlphaAt60Fps: 0.18,
    maxAlphaAt60Fps: 0.76,
    positionCatchupM: 0.035,
    rotationCatchupRad: THREE.MathUtils.degToRad(7),
    scaleCatchup: 0.03,
    pixelRatioMax: 2,
    lostPoseGraceMs: 0,
    lockStableAfterMs: 0,
    lockReleasePositionM: 0.03,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(6),
    lockReleaseScale: 0.03
  },
  stable: {
    label: "Stable",
    positionDeadzoneM: 0.0025,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.55),
    scaleDeadzone: 0.0025,
    minAlphaAt60Fps: 0.08,
    maxAlphaAt60Fps: 0.55,
    positionCatchupM: 0.05,
    rotationCatchupRad: THREE.MathUtils.degToRad(10),
    scaleCatchup: 0.04,
    pixelRatioMax: 1.5,
    lostPoseGraceMs: 0,
    lockStableAfterMs: 0,
    lockReleasePositionM: 0.04,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(8),
    lockReleaseScale: 0.04
  },
  "presentation-lock": {
    label: "Presentation Lock",
    positionDeadzoneM: 0.003,
    rotationDeadzoneRad: THREE.MathUtils.degToRad(0.65),
    scaleDeadzone: 0.003,
    minAlphaAt60Fps: 0.06,
    maxAlphaAt60Fps: 0.42,
    positionCatchupM: 0.055,
    rotationCatchupRad: THREE.MathUtils.degToRad(10),
    scaleCatchup: 0.045,
    pixelRatioMax: 1.5,
    lostPoseGraceMs: 1400,
    lockStableAfterMs: 650,
    lockReleasePositionM: 0.045,
    lockReleaseRotationRad: THREE.MathUtils.degToRad(8),
    lockReleaseScale: 0.045
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
  targetIndex: 0;
  imageTargetLoaded: boolean;
  imageTargetSrc: string;
  imageTargetImage: string;
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
    normalizedHeight: number;
  };
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
  imageTargetLoaded: false,
  imageTargetSrc: "/targets/masterplan.mind",
  imageTargetImage: MASTERPLAN_TARGET_IMAGE_URL,
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
        imageTargetSrc: result.project.target.mindUrl,
        imageTargetImage: result.project.target.imageUrl,
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

    async function start() {
      setPublicStatus("camera loading");
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
        imageTargetLoaded: false,
        imageTargetSrc: target.mindUrl,
        imageTargetImage: target.imageUrl,
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
          position: "absolute",
          inset: "0",
          zIndex: "1",
          pointerEvents: "none"
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

        const unsubscribePose = trackingProvider.onPoseUpdate(({ matrix, timestampMs }) => {
          if (!video) return;
          if (!poseStabilizer.setRawMatrix(matrix, timestampMs)) return;
          targetAnchor.matrix.copy(matrix);
          targetAnchor.visible = true;
          targetAnchor.updateMatrixWorld(true);
          stabilizedRoot.visible = true;
        });
        const unsubscribeFound = trackingProvider.onTargetFound(() => {
          targetVisible = true;
          setPublicStatus("target found");
          patchRuntimeStatus({ targetFound: true, targetLost: false });
        });
        const unsubscribeLost = trackingProvider.onTargetLost(() => {
          const holdingPose = poseStabilizer.markTargetLost(performance.now(), stabilityModeRef.current);

          if (!holdingPose) {
            targetAnchor.matrix.copy(INVISIBLE_MATRIX);
            targetAnchor.visible = false;
            stabilizedRoot.visible = false;
          }

          if (targetVisible) {
            targetVisible = false;
            setPublicStatus("target lost");
            patchRuntimeStatus({ targetFound: false, targetLost: true });
          } else {
            setPublicStatus("target searching");
          }
        });

        resizeTrackingView({
          container: mount,
          video,
          renderer,
          camera,
          provider: trackingProvider
        });
        window.addEventListener("resize", resize);

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
        setPublicStatus("target searching");

        function resize() {
          if (!mount || !video || !renderer || !trackingProvider) return;
          resizeTrackingView({ container: mount, video, renderer, camera, provider: trackingProvider });
        }

        async function loadActiveModel() {
          setPublicStatus("loading model");
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

            setPublicStatus(targetVisible ? "target found" : "target searching");
          } catch (caught) {
            const errorMessage = caught instanceof Error ? caught.message : "model load failed";
            setPublicStatus("model error");
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
              now
            });
            liveDebugRef.current = snapshot;
            if (debugEnabledRef.current) {
              setLiveDebugSnapshot(snapshot);
            }
            lastDebugSnapshotAtMs = now;
          }
        }

        cleanupRef.current = () => {
          stopped = true;
          window.cancelAnimationFrame(animationFrame);
          window.removeEventListener("resize", resize);
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

      setPublicStatus("model error");
      patchRuntimeStatus(nextStatus);
    }

    start().catch((caught) => {
      const errorMessage = caught instanceof Error ? caught.message : "Tracking runtime error.";
      setPublicStatus("model error");
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
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <p className="inline-block rounded bg-black/60 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] backdrop-blur">
          {publicStatus}
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
        <div className="absolute inset-x-0 bottom-0 z-10 p-3">
          <Link
            className="focus-ring inline-flex rounded bg-white px-3 py-2 text-sm font-semibold text-black"
            href={project?.viewUrl || "#"}
          >
            Open 3D viewer
          </Link>
        </div>
      ) : null}

      {debug ? (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[60vh] overflow-auto bg-black/80 p-3 backdrop-blur">
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
    position: "absolute",
    top: "0",
    left: "0",
    zIndex: "0",
    objectFit: "cover"
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

  protected emitPose(matrix: THREE.Matrix4, timestampMs: number) {
    this.poseCallbacks.forEach((callback) => callback({ matrix, timestampMs }));
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
  }
}

class MindARImageTrackingProvider extends BaseTrackingProvider {
  readonly id = "mindar-image" as const;
  readonly label = TRACKING_PROVIDER_LABELS["mindar-image"];
  private controller: MindARController | null = null;
  private video: HTMLVideoElement | null = null;
  private target: ImageTargetSettings | null = null;
  private postMatrix = new THREE.Matrix4();
  private lastTargetDimensions: [number, number] | null = null;

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
      maxTrack: 1,
      warmupTolerance: 3,
      missTolerance: 8,
      filterMinCF: null,
      filterBeta: null,
      onUpdate: (data) => this.handleUpdate(data)
    });

    this.status = "loading image target";
    const { dimensions } = await this.controller.addImageTargets(target.mindUrl);
    const [targetWidth, targetHeight] =
      dimensions[0] || [1, getImageTargetGeometry(target).normalizedHeight];
    this.lastTargetDimensions = [targetWidth, targetHeight];
    this.postMatrix.copy(createPostMatrix(targetWidth, targetHeight));

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
    this.initialized = false;
    this.targetVisible = false;
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
      inputWidth: this.controller?.inputWidth || 0,
      inputHeight: this.controller?.inputHeight || 0,
      targetMindUrl: this.target?.mindUrl || "",
      targetImageUrl: this.target?.imageUrl || "",
      targetDimensions: this.lastTargetDimensions
        ? {
            width: roundForDebug(this.lastTargetDimensions[0]),
            height: roundForDebug(this.lastTargetDimensions[1])
          }
        : null
    };
  }

  private handleUpdate(data: MindARUpdate) {
    if (data.type !== "updateMatrix" || data.targetIndex !== 0) return;
    const now = performance.now();

    if (data.worldMatrix) {
      const matrix = new THREE.Matrix4();
      matrix.fromArray(data.worldMatrix);
      matrix.multiply(this.postMatrix);
      if (!isUsableMatrix(matrix)) return;

      this.emitFound(now);
      this.emitPose(matrix, now);
      return;
    }

    this.emitLost(now);
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
  private targetFoundEvents = 0;
  private targetLostEvents = 0;
  private positionJitterDeltaM = 0;
  private rotationJitterDeltaRad = 0;
  private scaleJitterDelta = 0;
  private rawToSmoothedPositionDeltaM = 0;
  private rawToSmoothedRotationDeltaRad = 0;
  private rawToSmoothedScaleDelta = 0;
  private smoothingAlpha = 0;
  private positionAlpha = 0;
  private rotationAlpha = 0;
  private scaleAlpha = 0;
  private poseLocked = false;
  private stableSinceMs = 0;
  private holdPoseUntilMs = 0;
  private lockedPosition = new THREE.Vector3();
  private lockedQuaternion = new THREE.Quaternion();
  private lockedScale = new THREE.Vector3(1, 1, 1);

  setRawMatrix(matrix: THREE.Matrix4, now: number) {
    if (!isUsableMatrix(matrix)) return false;

    const nextPosition = new THREE.Vector3();
    const nextQuaternion = new THREE.Quaternion();
    const nextScale = new THREE.Vector3();
    matrix.decompose(nextPosition, nextQuaternion, nextScale);

    if (!isFiniteVector(nextPosition) || !isFiniteQuaternion(nextQuaternion) || !isFiniteVector(nextScale)) {
      return false;
    }

    if (this.hasRawPose) {
      this.positionJitterDeltaM = this.rawPosition.distanceTo(nextPosition);
      this.rotationJitterDeltaRad = this.rawQuaternion.angleTo(nextQuaternion);
      this.scaleJitterDelta = scaleDelta(this.rawScale, nextScale);
    } else {
      this.positionJitterDeltaM = 0;
      this.rotationJitterDeltaRad = 0;
      this.scaleJitterDelta = 0;
    }

    const wasHoldingPose = !this.targetVisible && this.hasSmoothedPose && now <= this.holdPoseUntilMs;

    if (!this.targetVisible) {
      this.targetFoundEvents += 1;
      this.lastFoundAtMs = now;
      if (!wasHoldingPose) {
        this.hasSmoothedPose = false;
        this.poseLocked = false;
        this.stableSinceMs = 0;
      }
      this.lastUpdateAtMs = 0;
    }

    this.targetVisible = true;
    this.hasRawPose = true;
    this.lastRawAtMs = now;
    this.rawMatrix.copy(matrix);
    this.rawPosition.copy(nextPosition);
    this.rawQuaternion.copy(nextQuaternion);
    this.rawScale.copy(nextScale);

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
    this.lastUpdateAtMs = 0;
    this.smoothingAlpha = 0;
    this.positionAlpha = 0;
    this.rotationAlpha = 0;
    this.scaleAlpha = 0;

    const shouldHoldPose = mode === "presentation-lock" && this.hasSmoothedPose && config.lostPoseGraceMs > 0;
    if (shouldHoldPose) {
      this.lockedPosition.copy(this.smoothedPosition);
      this.lockedQuaternion.copy(this.smoothedQuaternion);
      this.lockedScale.copy(this.smoothedScale);
      this.holdPoseUntilMs = now + config.lostPoseGraceMs;
      return true;
    }

    this.hasSmoothedPose = false;
    this.poseLocked = false;
    this.stableSinceMs = 0;
    this.holdPoseUntilMs = 0;
    return false;
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
    const holdingAfterLoss =
      mode === "presentation-lock" &&
      !this.targetVisible &&
      this.hasSmoothedPose &&
      now <= this.holdPoseUntilMs;

    if ((!this.targetVisible && !holdingAfterLoss) || !this.hasRawPose || !this.hasSmoothedPose) {
      stabilizedRoot.visible = false;
      return;
    }

    const config = getStabilityConfig(mode);
    const dtMs = this.lastUpdateAtMs
      ? THREE.MathUtils.clamp(now - this.lastUpdateAtMs, 1, 80)
      : 1000 / 60;
    this.lastUpdateAtMs = now;
    this.updateRawToSmoothedDeltas();

    const alphaAt60Fps = holdingAfterLoss ? 0 : this.adaptiveAlphaAt60Fps(config);
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
    } else if (this.rawToSmoothedPositionDeltaM > config.positionDeadzoneM) {
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
  }

  debug(now: number, mode: ARStabilityMode) {
    const config = getStabilityConfig(mode);

    return {
      currentStabilityMode: config.label,
      currentStabilityModeKey: mode,
      targetVisible: this.targetVisible,
      hasRawPose: this.hasRawPose,
      presentationLocked: this.poseLocked,
      holdingPoseAfterLoss: this.hasSmoothedPose && !this.targetVisible && now <= this.holdPoseUntilMs,
      holdPoseRemainingMs: this.holdPoseUntilMs > now ? roundForDebug(this.holdPoseUntilMs - now) : 0,
      rawTargetPose: this.hasRawPose ? transformDebugFromMatrix(this.rawMatrix) : null,
      smoothedTargetPose: this.hasSmoothedPose
        ? transformDebugFromParts(this.smoothedPosition, this.smoothedQuaternion, this.smoothedScale)
        : null,
      positionJitterDeltaM: roundForDebug(this.positionJitterDeltaM),
      rotationJitterDeltaDeg: roundForDebug(THREE.MathUtils.radToDeg(this.rotationJitterDeltaRad)),
      scaleJitterDelta: roundForDebug(this.scaleJitterDelta),
      rawToSmoothedPositionDeltaM: roundForDebug(this.rawToSmoothedPositionDeltaM),
      rawToSmoothedRotationDeltaDeg: roundForDebug(
        THREE.MathUtils.radToDeg(this.rawToSmoothedRotationDeltaRad)
      ),
      rawToSmoothedScaleDelta: roundForDebug(this.rawToSmoothedScaleDelta),
      smoothingAlpha: roundForDebug(this.smoothingAlpha),
      positionAlpha: roundForDebug(this.positionAlpha),
      rotationAlpha: roundForDebug(this.rotationAlpha),
      scaleAlpha: roundForDebug(this.scaleAlpha),
      deadzone: {
        positionM: roundForDebug(config.positionDeadzoneM),
        rotationDeg: roundForDebug(THREE.MathUtils.radToDeg(config.rotationDeadzoneRad)),
        scale: roundForDebug(config.scaleDeadzone),
        lockReleasePositionM: roundForDebug(config.lockReleasePositionM),
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
      Math.max(this.rawToSmoothedPositionDeltaM, this.positionJitterDeltaM),
      config.positionDeadzoneM,
      config.positionCatchupM
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
    this.rawToSmoothedPositionDeltaM = this.smoothedPosition.distanceTo(this.rawPosition);
    this.rawToSmoothedRotationDeltaRad = this.smoothedQuaternion.angleTo(this.rawQuaternion);
    this.rawToSmoothedScaleDelta = scaleDelta(this.smoothedScale, this.rawScale);
  }

  private updatePresentationLockState(config: ARStabilityConfig, mode: ARStabilityMode, now: number) {
    if (mode !== "presentation-lock" || !this.targetVisible) {
      this.poseLocked = false;
      this.stableSinceMs = 0;
      return;
    }

    const stableNow =
      this.positionJitterDeltaM <= config.positionDeadzoneM &&
      this.rotationJitterDeltaRad <= config.rotationDeadzoneRad &&
      this.scaleJitterDelta <= config.scaleDeadzone &&
      this.rawToSmoothedPositionDeltaM <= config.positionDeadzoneM * 2 &&
      this.rawToSmoothedRotationDeltaRad <= config.rotationDeadzoneRad * 2 &&
      this.rawToSmoothedScaleDelta <= config.scaleDeadzone * 2;

    if (!stableNow) {
      this.stableSinceMs = 0;
    } else if (!this.stableSinceMs) {
      this.stableSinceMs = now;
    }

    const realMovementDetected =
      this.rawToSmoothedPositionDeltaM > config.lockReleasePositionM ||
      this.rawToSmoothedRotationDeltaRad > config.lockReleaseRotationRad ||
      this.rawToSmoothedScaleDelta > config.lockReleaseScale;

    if (this.poseLocked && realMovementDetected) {
      this.poseLocked = false;
      this.stableSinceMs = 0;
      return;
    }

    if (!this.poseLocked && this.stableSinceMs && now - this.stableSinceMs >= config.lockStableAfterMs) {
      this.poseLocked = true;
      this.lockedPosition.copy(this.smoothedPosition);
      this.lockedQuaternion.copy(this.smoothedQuaternion);
      this.lockedScale.copy(this.smoothedScale);
    }
  }
}

function normalizedMotion(value: number, deadzone: number, catchup: number) {
  const range = Math.max(catchup - deadzone, 0.000001);
  return THREE.MathUtils.clamp((value - deadzone) / range, 0, 1);
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

function resizeTrackingView({
  container,
  video,
  renderer,
  camera,
  provider
}: {
  container: HTMLElement;
  video: HTMLVideoElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  provider: TrackingProvider;
}) {
  video.width = video.videoWidth;
  video.height = video.videoHeight;
  const calibration = provider.getCameraCalibration();

  const videoRatio = video.videoWidth / video.videoHeight;
  const containerRatio = container.clientWidth / container.clientHeight;
  let videoDisplayWidth: number;
  let videoDisplayHeight: number;

  if (videoRatio > containerRatio) {
    videoDisplayHeight = container.clientHeight;
    videoDisplayWidth = videoDisplayHeight * videoRatio;
  } else {
    videoDisplayWidth = container.clientWidth;
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
        ? container.clientHeight * inputAdjust
        : (container.clientWidth / calibration.inputWidth) * calibration.inputHeight * inputAdjust;
    const fovAdjust = container.clientHeight / adjustedVideoHeight;
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

  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();

  Object.assign(video.style, {
    top: `${-(videoDisplayHeight - container.clientHeight) / 2}px`,
    left: `${-(videoDisplayWidth - container.clientWidth) / 2}px`,
    width: `${videoDisplayWidth}px`,
    height: `${videoDisplayHeight}px`
  });

  Object.assign(renderer.domElement.style, {
    width: `${container.clientWidth}px`,
    height: `${container.clientHeight}px`
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
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
    normalizedHeight: roundForDebug(geometry.normalizedHeight)
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
  now: number;
}) {
  const correctedBounds = boundsDebug(modelCorrectionGroup);
  const stabilityConfig = getStabilityConfig(stabilityMode);
  const frameDebug = frameRateTracker.debug();
  const modelStats = modelStatsDebug(activeModel);
  const viewport = viewportDebug();

  return {
    sampledAt: new Date().toISOString(),
    trackingMode: trackingProvider?.label || "",
    selectedTrackingMode,
    selectedTrackingModeLabel: TRACKING_MODE_LABELS[selectedTrackingMode],
    activeTrackingProvider: trackingProvider?.id || "",
    activeTrackingProviderLabel: trackingProvider?.label || "",
    providerSupportStatus: trackingSupport,
    providerDebugState: trackingProvider?.getDebugState() || null,
    mindARStatus: trackingProvider?.id === "mindar-image" ? trackingProvider.getDebugState() : null,
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

function modelStatsDebug(root: THREE.Object3D | null) {
  if (!root) {
    return {
      modelLoaded: false,
      meshCount: 0,
      triangleCount: 0,
      materialCount: 0,
      textureCount: 0,
      geometryCount: 0
    };
  }

  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  let meshCount = 0;
  let triangleCount = 0;

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;

    meshCount += 1;
    geometries.add(child.geometry);
    const index = child.geometry.getIndex();
    const position = child.geometry.getAttribute("position");
    const vertexCount = index?.count || position?.count || 0;
    triangleCount += Math.floor(vertexCount / 3);

    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((material) => {
      if (!material) return;
      materials.add(material);
      collectMaterialTextures(material, textures);
    });
  });

  return {
    modelLoaded: true,
    meshCount,
    triangleCount,
    materialCount: materials.size,
    textureCount: textures.size,
    geometryCount: geometries.size
  };
}

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>) {
  Object.values(material as unknown as Record<string, unknown>).forEach((value) => {
    if (value instanceof THREE.Texture) {
      textures.add(value);
    }
  });
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

function eulerDegreesDebug(euler: THREE.Euler) {
  return {
    x: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.x, 0))),
    y: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.y, 0))),
    z: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.z, 0)))
  };
}

function viewportDebug() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    orientation: window.screen.orientation?.type || ""
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
