"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  MASTERPLAN_TARGET_IMAGE_URL,
  correctionRotationRadians,
  getImageTargetGeometry,
  type ImageTargetSettings,
  type ModelCorrectionMode
} from "@/lib/placement";
import {
  computeSceneTransformForRuntime,
  type SceneRuntimeTransform
} from "@/lib/scene-transform";
import type { ProjectMetadata, SceneMetadata } from "@/lib/projects";
import { loadGltfModel } from "@/lib/three-gltf";
import type { Controller } from "mind-ar/dist/mindar-image.prod.js";

type MindARController = Controller;

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
  rawBounds: BoundsDebug | null;
  correctedBounds: BoundsDebug | null;
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
  rawBounds: null,
  correctedBounds: null,
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
  const liveDebugRef = useRef<Record<string, unknown>>({});
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [publicStatus, setPublicStatus] = useState<PublicStatus>("camera loading");
  const [runtimeResetKey, setRuntimeResetKey] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(INITIAL_STATUS);
  const [debugCopyStatus, setDebugCopyStatus] = useState("");

  const patchRuntimeStatus = useCallback((next: Partial<RuntimeStatus>) => {
    setRuntimeStatus((current) => ({ ...current, ...next }));
  }, []);

  const copyDebugReport = useCallback(async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      viewport: viewportDebug(),
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
  }, [id, project, publicStatus, runtimeStatus]);

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
        rawBounds: null,
        correctedBounds: null,
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
        const mindarModule = await import("mind-ar/dist/mindar-image.prod.js");
        const ControllerClass = mindarModule.Controller;

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.getContext();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

        targetAnchor.add(new THREE.AmbientLight(0xffffff, 2));
        const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd7dee8, 3);
        targetAnchor.add(hemisphere);
        const directional = new THREE.DirectionalLight(0xffffff, 3);
        directional.position.set(0.6, 1.4, 0.8);
        targetAnchor.add(directional);

        const boardReferenceGroup = new THREE.Group();
        const desktopViewportTransformGroup = new THREE.Group();
        const modelCorrectionGroup = new THREE.Group();
        const correction = correctionRotationRadians(target.correctionMode);
        modelCorrectionGroup.rotation.set(correction.x, correction.y, correction.z);
        targetAnchor.add(boardReferenceGroup);
        boardReferenceGroup.add(desktopViewportTransformGroup);
        desktopViewportTransformGroup.add(modelCorrectionGroup);

        const debugCube = createDebugCube(target);
        boardReferenceGroup.add(debugCube);

        const targetAxes = new THREE.AxesHelper(0.18);
        boardReferenceGroup.add(targetAxes);

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
              targetAnchor.matrix.copy(matrix);
              targetAnchor.visible = true;
              targetAnchor.updateMatrixWorld(true);

              if (!targetVisible) {
                targetVisible = true;
                setPublicStatus("target found");
                patchRuntimeStatus({ targetFound: true, targetLost: false });
              }
            } else {
              targetAnchor.matrix.copy(INVISIBLE_MATRIX);
              targetAnchor.visible = false;

              if (targetVisible) {
                targetVisible = false;
                setPublicStatus("target lost");
                patchRuntimeStatus({ targetFound: false, targetLost: true });
              } else {
                setPublicStatus("target searching");
              }
            }

            liveDebugRef.current = buildLiveDebugSnapshot({
              video,
              targetAnchor,
              boardReferenceGroup,
              desktopViewportTransformGroup,
              modelCorrectionGroup,
              activeModel,
              targetVisible
            });
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

            const runtimeTransform = computeSceneTransformForRuntime(
              model,
              activeSceneForRuntime,
              target,
              "ar"
            );
            applyTransformToGroup(desktopViewportTransformGroup, runtimeTransform);
            modelCorrectionGroup.add(model);
            model.updateMatrixWorld(true);
            modelCorrectionGroup.updateMatrixWorld(true);
            desktopViewportTransformGroup.updateMatrixWorld(true);

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
              desktopViewportTransform: objectLocalDebug(desktopViewportTransformGroup),
              modelLocalTransform: objectLocalDebug(model),
              modelWorldTransform: objectWorldDebug(model),
              rawBounds: boundsDebug(model),
              correctedBounds: boundsDebug(modelCorrectionGroup),
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

        function animate() {
          if (stopped || !renderer) return;
          animationFrame = window.requestAnimationFrame(animate);
          renderer.render(threeScene, camera);
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
        <div className="pointer-events-auto flex items-center gap-2">
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
            {JSON.stringify(runtimeStatus, null, 2)}
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

function createDebugCube(target: ImageTargetSettings) {
  const widthM = Math.max(getImageTargetGeometry(target).widthM, 0.001);
  const size = 50 / 1000 / widthM;
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshBasicMaterial({ color: 0xff1f1f })
  );
  cube.position.set(0, 0, size / 2);
  return cube;
}

function applyTransformToGroup(group: THREE.Group, transform: SceneRuntimeTransform) {
  group.position.copy(transform.position);
  group.rotation.copy(transform.rotation);
  group.scale.setScalar(transform.scale);
  group.updateMatrixWorld(true);
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

function buildLiveDebugSnapshot({
  video,
  targetAnchor,
  boardReferenceGroup,
  desktopViewportTransformGroup,
  modelCorrectionGroup,
  activeModel,
  targetVisible
}: {
  video: HTMLVideoElement;
  targetAnchor: THREE.Group;
  boardReferenceGroup: THREE.Group;
  desktopViewportTransformGroup: THREE.Group;
  modelCorrectionGroup: THREE.Group;
  activeModel: THREE.Object3D | null;
  targetVisible: boolean;
}) {
  return {
    sampledAt: new Date().toISOString(),
    trackingMode: "MindAR",
    targetVisible,
    viewport: viewportDebug(),
    video: {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      clientWidth: video.clientWidth,
      clientHeight: video.clientHeight,
      readyState: video.readyState
    },
    targetAnchorWorld: objectWorldDebug(targetAnchor),
    boardReferenceWorld: objectWorldDebug(boardReferenceGroup),
    desktopViewportTransform: objectLocalDebug(desktopViewportTransformGroup),
    modelCorrectionTransform: objectLocalDebug(modelCorrectionGroup),
    modelWorld: activeModel ? objectWorldDebug(activeModel) : null,
    modelLocal: activeModel ? objectLocalDebug(activeModel) : null
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
