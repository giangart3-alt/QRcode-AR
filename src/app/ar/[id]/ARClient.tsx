"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ProjectMetadata } from "@/lib/projects";

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

const AR_SCRIPT = "https://cdn.jsdelivr.net/npm/@ar-js-org/ar.js@3.4.7/three.js/build/ar-threex.js";
const CAMERA_PARAMETERS = "https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/data/data/camera_para.dat";
const HIRO_PATTERN = "https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.7/data/data/patt.hiro";

export function ARClient({ id }: { id: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const [project, setProject] = useState<ProjectMetadata | null>(null);
  const [message, setMessage] = useState("Loading project...");
  const [debug, setDebug] = useState(false);
  const [runtimeScale, setRuntimeScale] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      const result = (await response.json()) as {
        project?: ProjectMetadata;
        error?: string;
      };

      if (cancelled) return;

      if (!response.ok || !result.project) {
        setMessage(result.error || "Model not found.");
        return;
      }

      setProject(result.project);
    }

    loadProject().catch((caught) =>
      setMessage(caught instanceof Error ? caught.message : "Unable to load project.")
    );

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!project || !mountRef.current) return;

    const currentProject = project;
    let stopped = false;
    let animationFrame = 0;
    let resizeHandler: (() => void) | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("Unsupported browser. Try Chrome on Android, or use the fallback viewer.");
        return;
      }

      setMessage("Requesting camera permission...");
      window.THREE = THREE;

      try {
        await loadScript(AR_SCRIPT);
      } catch {
        setMessage("Unable to load the marker tracking library. Use the fallback viewer.");
        return;
      }

      if (!window.THREEx || stopped || !mountRef.current) {
        setMessage("Unsupported browser. Use the fallback viewer.");
        return;
      }

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mountRef.current.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      scene.add(camera);

      const markerRoot = new THREE.Group();
      markerRoot.visible = false;
      scene.add(markerRoot);

      const light = new THREE.HemisphereLight(0xffffff, 0x606060, 2.8);
      markerRoot.add(light);
      const directional = new THREE.DirectionalLight(0xffffff, 2);
      directional.position.set(0.5, 1, 0.5);
      markerRoot.add(directional);

      const arToolkitSource = new window.THREEx.ArToolkitSource({
        sourceType: "webcam",
        sourceWidth: 1280,
        sourceHeight: 720,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight
      });

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
      } catch {
        setMessage("Camera permission denied. Allow camera access, then reload this page.");
        renderer.dispose();
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
        patternUrl: HIRO_PATTERN,
        changeMatrixMode: "modelViewMatrix"
      });

      resizeHandler = () => {
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
        if (arToolkitContext.arController) {
          arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
        }
      };
      window.addEventListener("resize", resizeHandler);
      resizeHandler();

      setMessage("Loading model...");
      const gltf = await new GLTFLoader().loadAsync(currentProject.modelUrl);
      const model = gltf.scene;
      model.position.y = currentProject.verticalOffset;
      model.scale.setScalar(currentProject.scale * runtimeScale);
      markerRoot.add(model);
      modelRef.current = model;
      setMessage("Point the camera at the printed marker.");

      let lastSeen = 0;
      const graceMs = 900;

      function animate() {
        if (stopped) return;
        animationFrame = window.requestAnimationFrame(animate);

        if (arToolkitSource.ready) {
          arToolkitContext.update(arToolkitSource.domElement);
          if (markerRoot.visible) {
            lastSeen = Date.now();
            setMessage("Marker found.");
          } else if (Date.now() - lastSeen < graceMs) {
            markerRoot.visible = true;
            setMessage("Holding last marker position.");
          } else {
            setMessage("Marker not found. Point the camera at the printed marker.");
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
        renderer.domElement.remove();
      };
    }

    start().catch((caught) => {
      setMessage(caught instanceof Error ? caught.message : "Model loading error.");
    });

    return () => {
      stopped = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [project, id, runtimeScale]);

  useEffect(() => {
    if (!modelRef.current || !project) return;
    modelRef.current.scale.setScalar(project.scale * runtimeScale);
  }, [project, runtimeScale]);

  function reset() {
    setRuntimeScale(1);
    if (modelRef.current && project) {
      modelRef.current.position.y = project.verticalOffset;
      modelRef.current.rotation.set(0, 0, 0);
    }
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <Link className="focus-ring rounded-md bg-white/15 px-3 py-2 text-sm font-semibold backdrop-blur" href="/">
            Home
          </Link>
          {project ? (
            <Link
              className="focus-ring rounded-md bg-teal-400 px-3 py-2 text-sm font-semibold text-black"
              href={`/view/${project.id}`}
            >
              Open fallback viewer
            </Link>
          ) : null}
        </div>
        <p className="mt-3 max-w-xl rounded-md bg-black/45 p-3 text-sm font-semibold backdrop-blur">{message}</p>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent p-4">
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <button className="focus-ring rounded-md bg-white px-3 py-3 text-sm font-bold text-black" onClick={reset}>
            Reset
          </button>
          <button
            className="focus-ring rounded-md bg-white px-3 py-3 text-sm font-bold text-black"
            onClick={() => setRuntimeScale((value) => Math.max(0.05, value - 0.1))}
          >
            Scale -
          </button>
          <button
            className="focus-ring rounded-md bg-white px-3 py-3 text-sm font-bold text-black"
            onClick={() => setRuntimeScale((value) => Math.min(8, value + 0.1))}
          >
            Scale +
          </button>
          <button
            className="focus-ring rounded-md bg-white/15 px-3 py-3 text-sm font-bold"
            onClick={() => setDebug((value) => !value)}
          >
            Debug
          </button>
        </div>
        {debug ? (
          <pre className="pointer-events-auto mt-3 max-w-md overflow-auto rounded-md bg-black/70 p-3 text-xs text-teal-100">
            {JSON.stringify(
              {
                project: project?.id,
                baseScale: project?.scale,
                runtimeScale,
                verticalOffset: project?.verticalOffset,
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

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(script);
  });
}
