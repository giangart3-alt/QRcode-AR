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

type ARStabilityMode = "realtime" | "balanced" | "stable";

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
};

const DEFAULT_STABILITY_MODE: ARStabilityMode = "balanced";

const AR_STABILITY_MODES: ARStabilityMode[] = ["realtime", "balanced", "stable"];

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
    pixelRatioMax: 2
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
    pixelRatioMax: 2
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
    pixelRatioMax: 1.5
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
  trackingMode: "MindAR";
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
  trackingMode: "MindAR",
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
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [publicStatus, setPublicStatus] = useState<PublicStatus>("camera loading");
  const [runtimeResetKey, setRuntimeResetKey] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(INITIAL_STATUS);
  const [liveDebugSnapshot, setLiveDebugSnapshot] = useState<Record<string, unknown>>({});
  const [debugCopyStatus, setDebugCopyStatus] = useState("");

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

  useEffect(() => {
    debugEnabledRef.current = debug;
  }, [debug]);

  const handleStabilityModeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextMode = parseStabilityMode(event.target.value) || DEFAULT_STABILITY_MODE;
    applyStabilityMode(nextMode, true);
  }, [applyStabilityMode]);

  const copyDebugReport = useCallback(async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      viewport: viewportDebug(),
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
  }, [id, project, publicStatus, runtimeStatus, stabilityMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setPublicStatus("camera loading");
      patchRuntimeStatus({
        ...INITIAL_STATUS,
        projectLoading: true,
        activeProjectId: id
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
    let controller: MindARController | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let video: HTMLVideoElement | null = null;
    let activeModel: THREE.Object3D | null = null;
    let activeCorrectionMetrics: ModelCorrectionMetrics | null = null;
    let targetVisible = false;
    const postMatrix = new THREE.Matrix4();

    async function start() {
      setPublicStatus("camera loading");
      patchRuntimeStatus({
        cameraActive: false,
        mindARInitialized: false,
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
        const mindarModule = await loadMindARImageRuntime();
        const ControllerClass = mindarModule.Controller;

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

        controller = new ControllerClass({
          inputWidth: video.videoWidth,
          inputHeight: video.videoHeight,
          maxTrack: 1,
          warmupTolerance: 3,
          missTolerance: 8,
          filterMinCF: null,
          filterBeta: null,
          onUpdate: (data) => {
            if (data.type !== "updateMatrix" || data.targetIndex !== 0) return;
            if (!video) return;

            if (data.worldMatrix) {
              const matrix = new THREE.Matrix4();
              matrix.fromArray(data.worldMatrix);
              matrix.multiply(postMatrix);
              if (!poseStabilizer.setRawMatrix(matrix, performance.now())) return;
              targetAnchor.matrix.copy(matrix);
              targetAnchor.visible = true;
              targetAnchor.updateMatrixWorld(true);
              stabilizedRoot.visible = true;

              if (!targetVisible) {
                targetVisible = true;
                setPublicStatus("target found");
                patchRuntimeStatus({ targetFound: true, targetLost: false });
              }
            } else {
              poseStabilizer.markTargetLost(performance.now());
              targetAnchor.matrix.copy(INVISIBLE_MATRIX);
              targetAnchor.visible = false;
              stabilizedRoot.visible = false;

              if (targetVisible) {
                targetVisible = false;
                setPublicStatus("target lost");
                patchRuntimeStatus({ targetFound: false, targetLost: true });
              } else {
                setPublicStatus("target searching");
              }
            }
          }
        });

        resizeMindArView({
          container: mount,
          video,
          renderer,
          camera,
          controller
        });
        window.addEventListener("resize", resize);

        const { dimensions } = await controller.addImageTargets(target.mindUrl);
        const [targetWidth, targetHeight] = dimensions[0] || [1, getImageTargetGeometry(target).normalizedHeight];
        postMatrix.copy(createPostMatrix(targetWidth, targetHeight));
        await controller.dummyRun(video);
        if (stopped) return;

        controller.processVideo(video);
        patchRuntimeStatus({ mindARInitialized: true });
        setPublicStatus("target searching");

        function resize() {
          if (!mount || !video || !renderer || !controller) return;
          resizeMindArView({ container: mount, video, renderer, camera, controller });
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
          controller?.stopProcessVideo();
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
        const errorMessage = caught instanceof Error ? caught.message : "MindAR init failed";
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
      const errorMessage = caught instanceof Error ? caught.message : "MindAR runtime error.";
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

function parseStabilityMode(value: string | null): ARStabilityMode | null {
  if (!value) return null;
  return AR_STABILITY_MODES.includes(value as ARStabilityMode)
    ? (value as ARStabilityMode)
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

    if (!this.targetVisible) {
      this.targetFoundEvents += 1;
      this.lastFoundAtMs = now;
      this.hasSmoothedPose = false;
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

  markTargetLost(now: number) {
    if (this.targetVisible) {
      this.targetLostEvents += 1;
      this.lastLostAtMs = now;
    }

    this.targetVisible = false;
    this.hasSmoothedPose = false;
    this.lastUpdateAtMs = 0;
    this.smoothingAlpha = 0;
    this.positionAlpha = 0;
    this.rotationAlpha = 0;
    this.scaleAlpha = 0;
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
    if (!this.targetVisible || !this.hasRawPose || !this.hasSmoothedPose) {
      stabilizedRoot.visible = false;
      return;
    }

    const config = getStabilityConfig(mode);
    const dtMs = this.lastUpdateAtMs
      ? THREE.MathUtils.clamp(now - this.lastUpdateAtMs, 1, 80)
      : 1000 / 60;
    this.lastUpdateAtMs = now;
    this.updateRawToSmoothedDeltas();

    const alphaAt60Fps = this.adaptiveAlphaAt60Fps(config);
    const frameScale = dtMs / (1000 / 60);
    const frameAlpha = 1 - Math.pow(1 - alphaAt60Fps, frameScale);
    this.smoothingAlpha = THREE.MathUtils.clamp(frameAlpha, 0, 1);

    if (this.rawToSmoothedPositionDeltaM > config.positionDeadzoneM) {
      this.smoothedPosition.lerp(this.rawPosition, this.smoothingAlpha);
      this.positionAlpha = this.smoothingAlpha;
    } else {
      this.positionAlpha = 0;
    }

    if (this.rawToSmoothedRotationDeltaRad > config.rotationDeadzoneRad) {
      this.smoothedQuaternion.slerp(this.rawQuaternion, this.smoothingAlpha);
      this.smoothedQuaternion.normalize();
      this.rotationAlpha = this.smoothingAlpha;
    } else {
      this.rotationAlpha = 0;
    }

    if (this.rawToSmoothedScaleDelta > config.scaleDeadzone) {
      this.smoothedScale.lerp(this.rawScale, this.smoothingAlpha);
      this.scaleAlpha = this.smoothingAlpha;
    } else {
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
        scale: roundForDebug(config.scaleDeadzone)
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

function resizeMindArView({
  container,
  video,
  renderer,
  camera,
  controller
}: {
  container: HTMLElement;
  video: HTMLVideoElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controller: MindARController;
}) {
  video.width = video.videoWidth;
  video.height = video.videoHeight;

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

  const projection = controller.getProjectionMatrix();
  const inputRatio = controller.inputWidth / controller.inputHeight;
  const inputAdjust =
    inputRatio > containerRatio
      ? video.width / controller.inputWidth
      : video.height / controller.inputHeight;
  const adjustedVideoHeight =
    inputRatio > containerRatio
      ? container.clientHeight * inputAdjust
      : (container.clientWidth / controller.inputWidth) * controller.inputHeight * inputAdjust;
  const fovAdjust = container.clientHeight / adjustedVideoHeight;
  const fov = 2 * Math.atan((1 / projection[5]) * fovAdjust) * (180 / Math.PI);
  const near = projection[14] / (projection[10] - 1);
  const far = projection[14] / (projection[10] + 1);

  camera.fov = fov;
  camera.near = near;
  camera.far = far;
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
    trackingMode: "MindAR",
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
