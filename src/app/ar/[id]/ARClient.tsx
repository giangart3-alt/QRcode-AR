"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  HIRO_MARKER_ID,
  HIRO_MARKER_IMAGE_URL,
  HIRO_MARKER_PATTERN_URL,
  getMarkerBoardImageUrl,
  mmToMeters
} from "@/lib/placement";
import { applySceneTransform, computeBaseFitScaleFromObject, computeSceneDisplayScale } from "@/lib/scene-transform";
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

type RuntimeStatus = Record<
  "project" | "webgl" | "camera" | "marker" | "model" | "tracking",
  string
>;

const AR_SCRIPT = "https://cdn.jsdelivr.net/npm/@ar-js-org/ar.js@3.4.7/three.js/build/ar-threex.js";
const CAMERA_PARAMETERS = "https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/data/data/camera_para.dat";
const LAST_POSE_HOLD_MS = 3000;

export function ARClient({ id }: { id: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [message, setMessage] = useState("Loading project...");
  const [debug, setDebug] = useState(false);
  const [trackingResetKey, setTrackingResetKey] = useState(0);
  const [lastError, setLastError] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({
    project: "loading",
    webgl: "pending",
    camera: "pending",
    marker: "pending",
    model: "pending",
    tracking: "pending"
  });

  const setStatus = useCallback((key: keyof RuntimeStatus, value: string) => {
    setRuntimeStatus((current) =>
      current[key] === value ? current : { ...current, [key]: value }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      setStatus("project", "loading");
      const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (cancelled) return;

      if (!response.ok || !result.project) {
        const errorMessage = result.error || "Model not found.";
        setStatus("project", errorMessage);
        setMessage(errorMessage);
        setLastError(errorMessage);
        return;
      }

      setProject(result.project);
      setStatus("project", "loaded");
      setLastError("");
      setMessage("Project loaded. Preparing camera...");
    }

    loadProject().catch((caught) => {
      const errorMessage = caught instanceof Error ? caught.message : "Unable to load project.";
      setStatus("project", errorMessage);
      setMessage(errorMessage);
      setLastError(errorMessage);
    });

    return () => {
      cancelled = true;
    };
  }, [id, setStatus]);

  useEffect(() => {
    if (!project || !mountRef.current) return;

    cleanupRef.current?.();
    const currentProject = project;
    const activeScene = getActiveSceneForClient(currentProject);
    const marker = currentProject.marker;
    const trackingPatternUrl = HIRO_MARKER_PATTERN_URL;
    const trackingMarkerSizeM = mmToMeters(marker.trackingMarkerSizeOnBoardMm);
    let stopped = false;
    let animationFrame = 0;
    let resizeHandler: (() => void) | null = null;
    let lastTrackingState = "";

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("camera", "unsupported");
        setMessage("Unsupported browser. Try Chrome on Android, or use the fallback viewer.");
        return;
      }

      window.THREE = THREE;
      setLastError("");
      setStatus("marker", "loading tracking runtime");
      setMessage("Loading marker tracking...");

      try {
        await loadScript(AR_SCRIPT);
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "Unable to load the marker tracking library.";
        setStatus("marker", "tracking runtime failed");
        setLastError(errorMessage);
        setMessage("Unable to load the marker tracking library. Use the fallback viewer.");
        return;
      }

      const mount = mountRef.current;
      if (!window.THREEx || stopped || !mount) {
        setStatus("marker", "tracking runtime unavailable");
        setLastError("AR.js runtime is unavailable.");
        setMessage("Unsupported browser. Use the fallback viewer.");
        return;
      }

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.getContext();
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "WebGL is unavailable in this browser.";
        setStatus("webgl", "unavailable");
        setLastError(errorMessage);
        setMessage("WebGL is unavailable in this browser.");
        return;
      }

      setStatus("webgl", "ready");
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      Object.assign(renderer.domElement.style, {
        position: "absolute",
        inset: "0",
        zIndex: "1",
        pointerEvents: "none"
      });
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      scene.add(camera);

      const markerRoot = new THREE.Group();
      markerRoot.visible = false;
      scene.add(markerRoot);
      const boardRoot = new THREE.Group();
      boardRoot.position.set(
        -mmToMeters(marker.trackingMarkerPositionOnBoard.xMm),
        0,
        mmToMeters(marker.trackingMarkerPositionOnBoard.yMm)
      );
      markerRoot.add(boardRoot);

      const ambient = new THREE.AmbientLight(0xffffff, 1.6);
      boardRoot.add(ambient);
      const hemisphere = new THREE.HemisphereLight(0xffffff, 0xf97316, 2.8);
      boardRoot.add(hemisphere);
      const directional = new THREE.DirectionalLight(0xffffff, 2.8);
      directional.position.set(0.5, 1.4, 0.8);
      boardRoot.add(directional);

      const arToolkitSource = new window.THREEx.ArToolkitSource({
        sourceType: "webcam",
        sourceWidth: 1280,
        sourceHeight: 720,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight
      });

      setStatus("camera", "requesting camera");
      setMessage("Requesting camera permission...");

      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Camera permission denied.")), 15000);
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
        setStatus("camera", "active");
        setMessage("Camera active. Initializing marker tracking...");
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "Camera permission denied.";
        setStatus("camera", "camera error");
        setLastError(errorMessage);
        setMessage("Camera permission denied. Allow camera access, then reload this page.");
        renderer.dispose();
        renderer.domElement.remove();
        return;
      }

      const arToolkitContext = new window.THREEx.ArToolkitContext({
        cameraParametersUrl: CAMERA_PARAMETERS,
        detectionMode: "mono"
      });

      setStatus("marker", "initializing");
      await new Promise<void>((resolve) => {
        arToolkitContext.init(() => {
          camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
          resolve();
        });
      });

      new window.THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
        type: "pattern",
        patternUrl: trackingPatternUrl,
        size: trackingMarkerSizeM,
        changeMatrixMode: "modelViewMatrix"
      });
      setStatus("marker", "pattern loaded");

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
        renderer.dispose();
        const video = arToolkitSource.domElement;
        const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
        stream?.getTracks().forEach((track) => track.stop());
        video.remove();
        renderer.domElement.remove();
      };

      setStatus("model", "loading");
      setMessage("Loading model...");

      try {
        if (!activeScene) {
          throw new Error("No active scene has been created yet.");
        }

        if (!activeScene.modelUrl) {
          throw new Error("Active scene does not have a GLB model yet.");
        }

        const gltf = await loadGltfModel(activeScene.modelUrl);
        if (stopped) return;

        const model = gltf.scene;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.frustumCulled = false;
          }
        });
        const fit = computeBaseFitScaleFromObject(model, marker);
        const displayedScale = computeSceneDisplayScale(activeScene, fit.baseFitScale);
        applySceneTransform(model, activeScene, displayedScale);
        boardRoot.add(model);
        setStatus("model", "loaded");
        setMessage("Camera active. Point at the AR tracking marker.");
      } catch (caught) {
        const errorMessage = caught instanceof Error ? caught.message : "Model loading error.";
        setStatus("model", errorMessage);
        setLastError(errorMessage);
        setMessage(errorMessage);
        return;
      }

      let lastSeen = 0;
      let markerWasSeen = false;

      function updateTrackingState(nextState: string) {
        if (lastTrackingState === nextState) return;
        lastTrackingState = nextState;
        setStatus("marker", nextState);
        setStatus("tracking", nextState);
        setMessage(nextState);
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
            setModelOpacity(markerRoot, 1);
            updateTrackingState("marker found");
          } else if (!markerWasSeen) {
            markerRoot.visible = false;
            updateTrackingState("marker searching");
          } else if (Date.now() - lastSeen < LAST_POSE_HOLD_MS) {
            markerRoot.visible = true;
            setModelOpacity(markerRoot, 0.68);
            updateTrackingState("marker lost");
          } else {
            markerRoot.visible = true;
            setModelOpacity(markerRoot, 0.28);
            updateTrackingState("marker lost");
          }
        }

        renderer.render(scene, camera);
      }

      animate();

      cleanupRef.current = () => {
        stopped = true;
        window.cancelAnimationFrame(animationFrame);
        if (resizeHandler) window.removeEventListener("resize", resizeHandler);
        renderer.dispose();
        const video = arToolkitSource.domElement;
        const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
        stream?.getTracks().forEach((track) => track.stop());
        video.remove();
        renderer.domElement.remove();
      };
    }

    start().catch((caught) => {
      const errorMessage = caught instanceof Error ? caught.message : "AR runtime error.";
      setMessage(errorMessage);
      setStatus("tracking", errorMessage);
      setLastError(errorMessage);
    });

    return () => {
      stopped = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [project, trackingResetKey, setStatus]);

  const activeSceneForDebug = project ? getActiveSceneForClient(project) : null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <Link className="focus-ring rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25" href="/">
            Home
          </Link>
          {project ? (
            <>
              <Link
                className="focus-ring rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--accent-dark)]"
                href={project.viewUrl}
              >
                Open viewer
              </Link>
              <Link
                className="focus-ring rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25"
                href="/ar/test"
              >
                Open AR test
              </Link>
            </>
          ) : null}
        </div>
        <p className="mt-3 max-w-xl rounded-lg bg-black/55 p-3 text-sm font-semibold backdrop-blur">{message}</p>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <button
            className="focus-ring rounded-lg bg-[var(--panel)] px-3 py-3 text-sm font-bold text-[var(--ink)] hover:bg-[var(--soft)]"
            onClick={() => setTrackingResetKey((value) => value + 1)}
          >
            Retry camera/tracking
          </button>
          <button
            className="focus-ring rounded-lg bg-white/15 px-3 py-3 text-sm font-bold backdrop-blur hover:bg-white/25"
            onClick={() => setDebug((value) => !value)}
          >
            Debug
          </button>
        </div>
        {debug ? (
          <pre className="pointer-events-auto mt-3 max-h-[40vh] max-w-2xl overflow-auto rounded-lg bg-black/75 p-3 text-xs leading-5 text-[var(--soft)]">
            {JSON.stringify(
              {
                status: runtimeStatus,
                cameraActive: runtimeStatus.camera === "active",
                arjsInitialized: ["pattern loaded", "marker searching", "marker found", "marker lost"].includes(runtimeStatus.marker),
                markerPatternUrl: HIRO_MARKER_PATTERN_URL,
                markerFound: runtimeStatus.tracking === "marker found",
                activeProjectId: project?.id,
                activeSceneId: activeSceneForDebug?.id || "",
                modelLoaded: runtimeStatus.model === "loaded",
                modelUrl: activeSceneForDebug?.modelUrl || "",
                modelPath: activeSceneForDebug?.modelPathname || "",
                lastError,
                markerStyle: project?.marker.styleId,
                boardStyle: project?.marker.boardStyle,
                boardSizeMm: project ? `${project.marker.widthMm} x ${project.marker.heightMm}` : "",
                boardImage: project ? getMarkerBoardImageUrl(project.marker) : "",
                trackingMarkerId: HIRO_MARKER_ID,
                trackingMarkerType: project?.marker.trackingMarkerType,
                trackingMarkerSizeMm: project?.marker.trackingMarkerSizeOnBoardMm,
                trackingMarkerImage: HIRO_MARKER_IMAGE_URL,
                trackingMarkerPattern: HIRO_MARKER_PATTERN_URL,
                trackingMarkerPositionOnBoard: project?.marker.trackingMarkerPositionOnBoard,
                activeSceneLoaded: Boolean(activeSceneForDebug),
                webgl: runtimeStatus.webgl,
                placement: activeSceneForDebug?.placement || null,
                userAgent: navigator.userAgent
              },
              null,
              2
            )}
          </pre>
        ) : null}
      </div>
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
