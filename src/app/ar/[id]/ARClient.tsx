"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  DEFAULT_MARKER_HEIGHT_MM,
  DEFAULT_MARKER_WIDTH_MM,
  HIRO_MARKER_ID,
  HIRO_MARKER_IMAGE_URL,
  HIRO_MARKER_PATTERN_URL,
  getMarkerBoardGeometry
} from "@/lib/placement";
import {
  applyRuntimeSceneTransform,
  computeSceneTransformForRuntime,
  type SceneRuntimeTransform
} from "@/lib/scene-transform";
import type { MarkerSettings } from "@/lib/placement";
import type { ProjectMetadata, SceneMetadata } from "@/lib/projects";
import { loadGltfModel } from "@/lib/three-gltf";

declare global {
  interface Window {
    THREE?: typeof THREE;
    THREEx?: {
      ArToolkitSource: new (options: Record<string, unknown>) => {
        domElement: HTMLVideoElement;
        ready: boolean;
        init: (onReady: () => void, onError?: (error: unknown) => void) => void;
        onResizeElement: () => void;
        copyElementSizeTo: (element: HTMLElement) => void;
      };
      ArToolkitContext: new (options: Record<string, unknown>) => {
        init: (onReady: () => void) => void;
        update: (element: HTMLVideoElement) => void;
        getProjectionMatrix: () => THREE.Matrix4;
        arController?: { canvas: HTMLCanvasElement };
      };
      ArMarkerControls: new (
        context: unknown,
        markerRoot: THREE.Group,
        options: Record<string, unknown>
      ) => unknown;
    };
  }
}

type PublicStatus =
  | "camera loading"
  | "marker searching"
  | "marker found"
  | "marker lost"
  | "loading model"
  | "model loaded"
  | "model error";

type VectorDebug = {
  x: number;
  y: number;
  z: number;
};

type RuntimeStatus = {
  projectLoading: boolean;
  projectLoaded: boolean;
  cameraActive: boolean;
  arjsInitialized: boolean;
  selectedSceneId: string;
  selectedSceneName: string;
  modelLoading: boolean;
  modelLoaded: boolean;
  modelError: string;
  markerFound: boolean;
  modelAttachedToMarker: boolean;
  modelUrl: string;
  modelPathname: string;
  computedScale: number | null;
  finalScaleApplied: number | null;
  scaleMode: string;
  modelDimensions: {
    widthM: number;
    heightM: number;
    depthM: number;
  } | null;
  markerDimensions: {
    widthMm: number;
    heightMm: number;
    widthM: number;
    heightM: number;
    trackingSizeMm: number;
    trackingSizeM: number;
    trackingCenterMm: {
      xMm: number;
      yMm: number;
    };
    boardOffsetFromTrackingCenterM: {
      xM: number;
      yM: number;
    };
  };
  appPlacement: {
    positionMm: VectorDebug;
    rotationDeg: VectorDebug;
    placementScale: number;
  } | null;
  scaleDebug: {
    scaleMode: string;
    normalizedScale: number;
    architecturalScale: number;
    baseFitScale: number;
    finalScale: number;
    boundsValid: boolean;
    scaleFallbackReason: string;
  } | null;
  runtimeTransform: {
    positionM: VectorDebug;
    rotationRad: VectorDebug;
    rotationDeg: VectorDebug;
    scale: number;
  } | null;
  axisCorrection: {
    applied: boolean;
    note: string;
    groupPositionM: VectorDebug;
    groupRotationRad: VectorDebug;
    groupRotationDeg: VectorDebug;
    groupScale: VectorDebug;
    boardReferencePositionM: VectorDebug;
    boardReferenceRotationRad: VectorDebug;
    boardReferenceScale: VectorDebug;
    boardOffsetFromTrackingCenterM: {
      xM: number;
      yM: number;
    };
  } | null;
  finalModelTransform: {
    positionM: VectorDebug;
    rotationRad: VectorDebug;
    rotationDeg: VectorDebug;
    scale: VectorDebug;
  } | null;
  lastError: string;
};

const AR_SCRIPT = "https://cdn.jsdelivr.net/npm/@ar-js-org/ar.js@3.4.7/three.js/build/ar-threex.js";
const CAMERA_PARAMETERS = "https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/data/data/camera_para.dat";
const LAST_POSE_HOLD_MS = 3000;
const DEFAULT_MARKER_GEOMETRY = getMarkerBoardGeometry({
  widthMm: DEFAULT_MARKER_WIDTH_MM,
  heightMm: DEFAULT_MARKER_HEIGHT_MM,
  trackingMarkerSizeOnBoardMm: 0,
  trackingMarkerPositionOnBoard: {
    xMm: 0,
    yMm: 0
  }
});

const INITIAL_STATUS: RuntimeStatus = {
  projectLoading: true,
  projectLoaded: false,
  cameraActive: false,
  arjsInitialized: false,
  selectedSceneId: "",
  selectedSceneName: "",
  modelLoading: false,
  modelLoaded: false,
  modelError: "",
  markerFound: false,
  modelAttachedToMarker: false,
  modelUrl: "",
  modelPathname: "",
  computedScale: null,
  finalScaleApplied: null,
  scaleMode: "",
  modelDimensions: null,
  markerDimensions: {
    widthMm: DEFAULT_MARKER_GEOMETRY.widthMm,
    heightMm: DEFAULT_MARKER_GEOMETRY.heightMm,
    widthM: DEFAULT_MARKER_GEOMETRY.widthM,
    heightM: DEFAULT_MARKER_GEOMETRY.heightM,
    trackingSizeMm: DEFAULT_MARKER_GEOMETRY.trackingMarkerSizeMm,
    trackingSizeM: DEFAULT_MARKER_GEOMETRY.trackingMarkerSizeM,
    trackingCenterMm: {
      xMm: DEFAULT_MARKER_GEOMETRY.trackingMarkerCenterMm.xMm,
      yMm: DEFAULT_MARKER_GEOMETRY.trackingMarkerCenterMm.yMm
    },
    boardOffsetFromTrackingCenterM: {
      xM: DEFAULT_MARKER_GEOMETRY.boardOffsetFromTrackingCenterM.xM,
      yM: DEFAULT_MARKER_GEOMETRY.boardOffsetFromTrackingCenterM.yM
    }
  },
  appPlacement: null,
  scaleDebug: null,
  runtimeTransform: null,
  axisCorrection: null,
  finalModelTransform: null,
  lastError: ""
};

export function ARClient({ id, debug = false }: { id: string; debug?: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [publicStatus, setPublicStatus] = useState<PublicStatus>("camera loading");
  const [trackingResetKey, setTrackingResetKey] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(INITIAL_STATUS);

  const patchRuntimeStatus = useCallback((next: Partial<RuntimeStatus>) => {
    setRuntimeStatus((current) => ({ ...current, ...next }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setPublicStatus("camera loading");
      patchRuntimeStatus({
        ...INITIAL_STATUS,
        projectLoading: true
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
        selectedSceneId: selectedScene?.id || "",
        selectedSceneName: selectedScene?.name || "",
        modelUrl: selectedScene?.modelUrl || "",
        modelPathname: selectedScene?.modelPathname || "",
        scaleMode: selectedScene?.scaleMode || "",
        markerDimensions: markerDimensions(result.project.marker),
        appPlacement: selectedScene ? placementDebug(selectedScene) : null,
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
    const selectedScene = getActiveSceneForClient(currentProject);
    const marker = currentProject.marker;
    const markerGeometry = getMarkerBoardGeometry(marker);
    const markerSizeM = markerGeometry.trackingMarkerSizeM;
    let stopped = false;
    let animationFrame = 0;
    let resizeHandler: (() => void) | null = null;
    let markerWasSeen = false;
    let lastSeen = 0;
    let lastTrackingState = "";

    async function start() {
      setPublicStatus("camera loading");
      patchRuntimeStatus({
        cameraActive: false,
        arjsInitialized: false,
        markerFound: false,
        modelAttachedToMarker: false,
        modelLoading: false,
        modelLoaded: false,
        modelError: "",
        lastError: "",
        computedScale: null,
        finalScaleApplied: null,
        modelDimensions: null,
        markerDimensions: markerDimensions(marker),
        appPlacement: selectedScene ? placementDebug(selectedScene) : null,
        scaleDebug: null,
        runtimeTransform: null,
        axisCorrection: null,
        finalModelTransform: null
      });

      if (!navigator.mediaDevices?.getUserMedia) {
        const errorMessage = "Camera API is unavailable in this browser.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        return;
      }

      if (!selectedScene) {
        const errorMessage = "No active scene has been created yet.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        return;
      }

      if (!selectedScene.modelUrl) {
        const errorMessage = "Active scene does not have a GLB model yet.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        return;
      }

      const activeScene = selectedScene;
      window.THREE = THREE;

      try {
        await loadScript(AR_SCRIPT);
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "Unable to load AR.js.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        return;
      }

      const mount = mountRef.current;
      if (!window.THREEx || stopped || !mount) {
        const errorMessage = "AR.js runtime is unavailable.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        return;
      }

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.getContext();
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "WebGL is unavailable.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
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

      const threeScene = new THREE.Scene();
      const camera = new THREE.Camera();
      threeScene.add(camera);

      const markerRoot = new THREE.Group();
      markerRoot.visible = false;
      threeScene.add(markerRoot);

      markerRoot.add(new THREE.AmbientLight(0xffffff, 2));
      const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd7dee8, 3);
      markerRoot.add(hemisphere);
      const directional = new THREE.DirectionalLight(0xffffff, 3);
      directional.position.set(0.6, 1.4, 0.8);
      markerRoot.add(directional);

      const modelAnchor = new THREE.Group();
      modelAnchor.visible = true;
      markerRoot.add(modelAnchor);
      patchRuntimeStatus({ axisCorrection: axisCorrectionDebug(modelAnchor, marker) });

      const arToolkitSource = new window.THREEx.ArToolkitSource({
        sourceType: "webcam",
        sourceWidth: 1280,
        sourceHeight: 720,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Camera permission timed out.")), 15000);
          arToolkitSource.init(
            () => {
              window.clearTimeout(timeout);
              resolve();
            },
            (error) => {
              window.clearTimeout(timeout);
              reject(error);
            }
          );
        });
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "Camera permission denied.";
        setPublicStatus("model error");
        patchRuntimeStatus({ lastError: errorMessage, modelError: errorMessage });
        renderer.dispose();
        renderer.domElement.remove();
        return;
      }

      const video = arToolkitSource.domElement;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      Object.assign(video.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        zIndex: "0"
      });
      mount.prepend(video);
      patchRuntimeStatus({ cameraActive: true });

      const arToolkitContext = new window.THREEx.ArToolkitContext({
        cameraParametersUrl: CAMERA_PARAMETERS,
        detectionMode: "mono"
      });

      await new Promise<void>((resolve) => {
        arToolkitContext.init(() => {
          camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
          resolve();
        });
      });

      new window.THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
        type: "pattern",
        patternUrl: HIRO_MARKER_PATTERN_URL,
        size: markerSizeM,
        changeMatrixMode: "modelViewMatrix"
      });

      patchRuntimeStatus({ arjsInitialized: true });
      setPublicStatus("marker searching");

      resizeHandler = () => {
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
        if (arToolkitContext.arController) {
          arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
        }
      };
      window.addEventListener("resize", resizeHandler);
      resizeHandler();

      cleanupRef.current = () => {
        stopped = true;
        window.cancelAnimationFrame(animationFrame);
        if (resizeHandler) window.removeEventListener("resize", resizeHandler);
        disposeObject(modelAnchor);
        renderer.dispose();
        const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
        stream?.getTracks().forEach((track) => track.stop());
        video.remove();
        renderer.domElement.remove();
      };

      function updateTrackingState(nextState: "marker searching" | "marker found" | "marker lost") {
        if (lastTrackingState === nextState) return;
        lastTrackingState = nextState;
        patchRuntimeStatus({ markerFound: nextState === "marker found" });

        setPublicStatus(nextState);
      }

      function animate() {
        if (stopped) return;
        animationFrame = window.requestAnimationFrame(animate);

        if (arToolkitSource.ready) {
          arToolkitContext.update(arToolkitSource.domElement);
          const markerVisibleAfterUpdate = markerRoot.visible;

          if (markerVisibleAfterUpdate) {
            markerWasSeen = true;
            lastSeen = Date.now();
            setModelOpacity(modelAnchor, 1);
            updateTrackingState("marker found");
          } else if (!markerWasSeen) {
            markerRoot.visible = false;
            updateTrackingState("marker searching");
          } else if (Date.now() - lastSeen < LAST_POSE_HOLD_MS) {
            markerRoot.visible = true;
            setModelOpacity(modelAnchor, 0.72);
            updateTrackingState("marker lost");
          } else {
            markerRoot.visible = false;
            setModelOpacity(modelAnchor, 1);
            updateTrackingState("marker lost");
          }
        }

        renderer.render(threeScene, camera);
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
          const gltf = await loadGltfModel(activeScene.modelUrl);
          if (stopped) return;

          const model = gltf.scene;
          forceVisibleModel(model);

          const runtimeTransform = computeSceneTransformForRuntime(
            model,
            activeScene,
            marker,
            "ar"
          );
          applyRuntimeSceneTransform(model, runtimeTransform);
          modelAnchor.add(model);
          const debugTransform = runtimeTransformDebug(
            runtimeTransform,
            activeScene,
            modelAnchor,
            marker,
            model
          );

          patchRuntimeStatus({
            selectedSceneId: activeScene.id,
            selectedSceneName: activeScene.name,
            modelUrl: activeScene.modelUrl,
            modelPathname: activeScene.modelPathname,
            modelLoading: false,
            modelLoaded: true,
            modelError: "",
            modelAttachedToMarker: true,
            computedScale: debugTransform.scaleDebug.finalScale,
            finalScaleApplied: debugTransform.scaleDebug.finalScale,
            scaleMode: activeScene.scaleMode,
            modelDimensions: {
              widthM: debugTransform.modelDimensions.widthM,
              heightM: debugTransform.modelDimensions.heightM,
              depthM: debugTransform.modelDimensions.depthM
            },
            markerDimensions: markerDimensions(marker),
            appPlacement: debugTransform.appPlacement,
            scaleDebug: debugTransform.scaleDebug,
            runtimeTransform: debugTransform.runtimeTransform,
            axisCorrection: debugTransform.axisCorrection,
            finalModelTransform: debugTransform.finalModelTransform,
            lastError: runtimeTransform.metrics.scaleFallbackReason || ""
          });

          setPublicStatus(markerWasSeen ? "marker found" : "marker searching");
        } catch (caught) {
          const errorMessage = caught instanceof Error ? caught.message : "Unable to load GLB model.";
          setPublicStatus("model error");
          patchRuntimeStatus({
            modelLoading: false,
            modelLoaded: false,
            modelError: errorMessage,
            lastError: errorMessage
          });
        }
      }

      animate();
      void loadActiveModel();
    }

    start().catch((caught) => {
      const errorMessage = caught instanceof Error ? caught.message : "AR runtime error.";
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
  }, [project, trackingResetKey, patchRuntimeStatus]);

  const showFallbackViewer = publicStatus === "model error" && Boolean(project?.viewUrl);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
        <p className="inline-block rounded bg-black/60 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] backdrop-blur">
          {publicStatus}
        </p>
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
            <Link className="focus-ring rounded bg-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/25" href="/ar/test">
              Open AR test
            </Link>
            <button
              className="focus-ring rounded bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-white/90"
              onClick={() => setTrackingResetKey((value) => value + 1)}
            >
              Retry camera/tracking
            </button>
          </div>
          <pre className="max-w-3xl overflow-auto rounded bg-black/70 p-3 text-xs leading-5 text-[var(--soft)]">
            {JSON.stringify(
              {
                projectLoading: runtimeStatus.projectLoading,
                projectLoaded: runtimeStatus.projectLoaded,
                cameraActive: runtimeStatus.cameraActive,
                arjsInitialized: runtimeStatus.arjsInitialized,
                markerPatternUrl: HIRO_MARKER_PATTERN_URL,
                markerFound: runtimeStatus.markerFound,
                activeProjectId: project?.id || id,
                activeSceneId: runtimeStatus.selectedSceneId,
                selectedSceneName: runtimeStatus.selectedSceneName,
                modelUrl: runtimeStatus.modelUrl,
                modelPathname: runtimeStatus.modelPathname,
                modelLoading: runtimeStatus.modelLoading,
                modelLoaded: runtimeStatus.modelLoaded,
                modelAttachedToMarker: runtimeStatus.modelAttachedToMarker,
                modelError: runtimeStatus.modelError,
                modelDimensions: runtimeStatus.modelDimensions,
                markerDimensions: runtimeStatus.markerDimensions,
                scaleMode: runtimeStatus.scaleMode,
                appPlacement: runtimeStatus.appPlacement,
                scaleDebug: runtimeStatus.scaleDebug,
                runtimeTransform: runtimeStatus.runtimeTransform,
                axisCorrection: runtimeStatus.axisCorrection,
                finalModelTransform: runtimeStatus.finalModelTransform,
                computedScale: runtimeStatus.computedScale,
                finalScaleApplied: runtimeStatus.finalScaleApplied,
                trackingMarkerId: HIRO_MARKER_ID,
                trackingMarkerImage: HIRO_MARKER_IMAGE_URL,
                lastError: runtimeStatus.lastError
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

function runtimeTransformDebug(
  transform: SceneRuntimeTransform,
  scene: SceneMetadata,
  markerReferenceGroup: THREE.Group,
  marker: MarkerSettings,
  model: THREE.Object3D
) {
  return {
    modelDimensions: {
      widthM: roundForDebug(transform.metrics.modelWidthM),
      heightM: roundForDebug(transform.metrics.modelHeightM),
      depthM: roundForDebug(transform.metrics.modelDepthM)
    },
    appPlacement: placementDebug(scene),
    scaleDebug: {
      scaleMode: scene.scaleMode,
      normalizedScale: roundForDebug(finiteNumber(scene.normalizedScale, 1)),
      architecturalScale: roundForDebug(finiteNumber(scene.architecturalScale, 100)),
      baseFitScale: roundForDebug(transform.metrics.baseFitScale),
      finalScale: roundForDebug(transform.scale),
      boundsValid: transform.metrics.boundsValid,
      scaleFallbackReason: transform.metrics.scaleFallbackReason || ""
    },
    runtimeTransform: {
      positionM: vectorDebug(transform.position),
      rotationRad: eulerDebug(transform.rotation),
      rotationDeg: eulerDegreesDebug(transform.rotation),
      scale: roundForDebug(transform.scale)
    },
    axisCorrection: axisCorrectionDebug(markerReferenceGroup, marker),
    finalModelTransform: modelTransformDebug(model)
  };
}

function placementDebug(scene: SceneMetadata) {
  return {
    positionMm: vectorDebug(scene.placement.position),
    rotationDeg: vectorDebug(scene.placement.rotation),
    placementScale: roundForDebug(finiteNumber(scene.placement.scale, 1))
  };
}

function axisCorrectionDebug(group: THREE.Group, marker: MarkerSettings) {
  const markerGeometry = getMarkerBoardGeometry(marker);

  return {
    applied: false,
    note: "The detected HIRO marker is the full desktop reference surface; no marker offset correction is applied.",
    groupPositionM: vectorDebug(group.position),
    groupRotationRad: eulerDebug(group.rotation),
    groupRotationDeg: eulerDegreesDebug(group.rotation),
    groupScale: vectorDebug(group.scale),
    boardReferencePositionM: vectorDebug(group.position),
    boardReferenceRotationRad: eulerDebug(group.rotation),
    boardReferenceScale: vectorDebug(group.scale),
    boardOffsetFromTrackingCenterM: {
      xM: roundForDebug(markerGeometry.boardOffsetFromTrackingCenterM.xM),
      yM: roundForDebug(markerGeometry.boardOffsetFromTrackingCenterM.yM)
    }
  };
}

function modelTransformDebug(model: THREE.Object3D) {
  return {
    positionM: vectorDebug(model.position),
    rotationRad: eulerDebug(model.rotation),
    rotationDeg: eulerDegreesDebug(model.rotation),
    scale: vectorDebug(model.scale)
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

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(script);
  });
}

function setModelOpacity(root: THREE.Object3D, opacity: number) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.transparent = opacity < 1;
      material.opacity = opacity;
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

function markerDimensions(marker: MarkerSettings) {
  const markerGeometry = getMarkerBoardGeometry(marker);

  return {
    widthMm: roundForDebug(markerGeometry.widthMm),
    heightMm: roundForDebug(markerGeometry.heightMm),
    widthM: roundForDebug(markerGeometry.widthM),
    heightM: roundForDebug(markerGeometry.heightM),
    trackingSizeMm: roundForDebug(markerGeometry.trackingMarkerSizeMm),
    trackingSizeM: roundForDebug(markerGeometry.trackingMarkerSizeM),
    trackingCenterMm: {
      xMm: roundForDebug(markerGeometry.trackingMarkerCenterMm.xMm),
      yMm: roundForDebug(markerGeometry.trackingMarkerCenterMm.yMm)
    },
    boardOffsetFromTrackingCenterM: {
      xM: roundForDebug(markerGeometry.boardOffsetFromTrackingCenterM.xM),
      yM: roundForDebug(markerGeometry.boardOffsetFromTrackingCenterM.yM)
    }
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

function eulerDebug(euler: THREE.Euler) {
  return vectorDebug(euler);
}

function eulerDegreesDebug(euler: THREE.Euler) {
  return {
    x: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.x, 0))),
    y: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.y, 0))),
    z: roundForDebug(THREE.MathUtils.radToDeg(finiteNumber(euler.z, 0)))
  };
}
