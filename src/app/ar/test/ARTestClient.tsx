"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { HIRO_MARKER_IMAGE_URL, HIRO_MARKER_PATTERN_URL } from "@/lib/placement";

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

type TestStatus =
  | "requesting camera"
  | "camera active"
  | "pattern loaded"
  | "marker searching"
  | "marker found"
  | "marker lost"
  | "WebGL error"
  | "camera error";

const AR_SCRIPT = "https://cdn.jsdelivr.net/npm/@ar-js-org/ar.js@3.4.7/three.js/build/ar-threex.js";
const CAMERA_PARAMETERS = "https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/data/data/camera_para.dat";
const INSTRUCTION = "Print or display the HIRO marker large and flat. Keep the full black border visible. Avoid glare. Move the phone closer until the marker fills about 25-40% of the screen.";

export function ARTestClient() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<TestStatus>("requesting camera");
  const [runKey, setRunKey] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debug, setDebug] = useState({
    cameraActive: false,
    arjsInitialized: false,
    markerPatternUrl: HIRO_MARKER_PATTERN_URL,
    markerFound: false,
    lastError: ""
  });

  const updateDebug = useCallback((next: Partial<typeof debug>) => {
    setDebug((current) => ({ ...current, ...next }));
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;

    cleanupRef.current?.();
    let stopped = false;
    let animationFrame = 0;
    let resizeHandler: (() => void) | null = null;
    let lastMarkerSeen = false;
    let lastMarkerState = "";

    async function start() {
      updateDebug({
        cameraActive: false,
        arjsInitialized: false,
        markerFound: false,
        lastError: ""
      });

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("camera error");
        updateDebug({ lastError: "Camera API is unavailable in this browser." });
        return;
      }

      window.THREE = THREE;
      setStatus("requesting camera");

      try {
        await loadScript(AR_SCRIPT);
      } catch (caught) {
        setStatus("camera error");
        updateDebug({ lastError: caught instanceof Error ? caught.message : "Unable to load AR.js." });
        return;
      }

      const mount = mountRef.current;
      if (!window.THREEx || stopped || !mount) {
        setStatus("camera error");
        updateDebug({ lastError: "AR.js runtime is unavailable." });
        return;
      }

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.getContext();
      } catch (caught) {
        setStatus("WebGL error");
        updateDebug({ lastError: caught instanceof Error ? caught.message : "WebGL is unavailable." });
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
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

      const axes = new THREE.AxesHelper(0.75);
      markerRoot.add(axes);

      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, 0.34),
        new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.92 })
      );
      cube.position.y = 0.18;
      markerRoot.add(cube);

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
        setStatus("camera error");
        updateDebug({ lastError: caught instanceof Error ? caught.message : "Camera permission denied." });
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
      setStatus("camera active");
      updateDebug({ cameraActive: true });

      try {
        const patternResponse = await fetch(HIRO_MARKER_PATTERN_URL, { cache: "no-store" });
        if (!patternResponse.ok) {
          throw new Error(`Unable to load HIRO pattern (${patternResponse.status}).`);
        }
      } catch (caught) {
        setStatus("camera error");
        updateDebug({ lastError: caught instanceof Error ? caught.message : "Pattern load failed." });
        return;
      }

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
        size: 1,
        changeMatrixMode: "modelViewMatrix"
      });

      setStatus("pattern loaded");
      updateDebug({ arjsInitialized: true });

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
        const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
        stream?.getTracks().forEach((track) => track.stop());
        video.remove();
        renderer.domElement.remove();
      };

      window.setTimeout(() => {
        if (!stopped) setStatus("marker searching");
      }, 250);

      function updateMarkerState(nextStatus: TestStatus, markerFound: boolean) {
        if (lastMarkerState === nextStatus) return;
        lastMarkerState = nextStatus;
        setStatus(nextStatus);
        updateDebug({ markerFound });
      }

      function animate() {
        if (stopped) return;
        animationFrame = window.requestAnimationFrame(animate);

        if (arToolkitSource.ready) {
          arToolkitContext.update(arToolkitSource.domElement);
          const markerFound = markerRoot.visible;

          if (markerFound) {
            lastMarkerSeen = true;
            updateMarkerState("marker found", true);
          } else if (lastMarkerSeen) {
            updateMarkerState("marker lost", false);
          } else {
            updateMarkerState("marker searching", false);
          }
        }

        renderer.render(scene, camera);
      }

      animate();
    }

    start().catch((caught) => {
      setStatus("camera error");
      updateDebug({ lastError: caught instanceof Error ? caught.message : "AR test failed." });
    });

    return () => {
      stopped = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [runKey, updateDebug]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <Link className="focus-ring rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25" href="/">
            Home
          </Link>
          <a className="focus-ring rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25" href={HIRO_MARKER_IMAGE_URL}>
            Open HIRO marker
          </a>
        </div>
        <p className="mt-3 inline-block rounded-lg bg-black/65 px-3 py-2 text-base font-black backdrop-blur">{status}</p>
        <p className="mt-3 max-w-xl rounded-lg bg-black/55 p-3 text-sm font-semibold leading-6 backdrop-blur">{INSTRUCTION}</p>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <button
            className="focus-ring rounded-lg bg-[var(--panel)] px-3 py-3 text-sm font-bold text-[var(--ink)] hover:bg-[var(--soft)]"
            onClick={() => setRunKey((value) => value + 1)}
          >
            Retry camera/tracking
          </button>
          <button
            className="focus-ring rounded-lg bg-white/15 px-3 py-3 text-sm font-bold backdrop-blur hover:bg-white/25"
            onClick={() => setDebugOpen((value) => !value)}
          >
            Debug
          </button>
        </div>
        {debugOpen ? (
          <pre className="pointer-events-auto mt-3 max-h-[40vh] max-w-2xl overflow-auto rounded-lg bg-black/75 p-3 text-xs leading-5 text-[var(--soft)]">
            {JSON.stringify(debug, null, 2)}
          </pre>
        ) : null}
      </div>
    </main>
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
