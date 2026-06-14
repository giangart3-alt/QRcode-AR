"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { APP_AXIS_COLORS } from "@/lib/coordinates";
import type { MarkerSettings } from "@/lib/placement";
import { boardImageUrlForStyle, getMarkerBoardImageUrl, mmToMeters } from "@/lib/placement";
import {
  applySceneTransform,
  computeBaseFitScaleFromObject,
  computeSceneDisplayScale,
  sceneTransformFromObject,
  type SceneScaleMetrics
} from "@/lib/scene-transform";
import { loadGltfModel } from "@/lib/three-gltf";
import type { SceneMetadata } from "@/lib/projects";

export type TransformMode = "translate" | "rotate" | "scale";

type SceneThreeViewportProps = {
  scene: SceneMetadata | null;
  marker: MarkerSettings;
  editable?: boolean;
  transformMode?: TransformMode;
  className?: string;
  onSceneChange?: (scene: SceneMetadata) => void;
  onStatusChange?: (status: string) => void;
  onMetricsChange?: (metrics: SceneScaleMetrics | null) => void;
};

export function SceneThreeViewport({
  scene,
  marker,
  editable = false,
  transformMode = "translate",
  className = "",
  onSceneChange,
  onStatusChange,
  onMetricsChange
}: SceneThreeViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const sceneRef = useRef<SceneMetadata | null>(scene);
  const baseFitScaleRef = useRef(1);
  const modelDimensionsRef = useRef({ modelWidthM: 0, modelDepthM: 0 });

  const applyCurrentScene = useCallback(() => {
    const model = modelRef.current;
    const currentScene = sceneRef.current;
    if (!model || !currentScene) return;

    const displayedScale = computeSceneDisplayScale(currentScene, baseFitScaleRef.current);
    applySceneTransform(model, currentScene, displayedScale);
    onMetricsChange?.({
      ...modelDimensionsRef.current,
      baseFitScale: baseFitScaleRef.current,
      displayedScale
    });
  }, [onMetricsChange]);

  useEffect(() => {
    sceneRef.current = scene;
    applyCurrentScene();
  }, [applyCurrentScene, scene]);

  useEffect(() => {
    transformRef.current?.setMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    if (!hostRef.current) return;

    const host = hostRef.current;
    let stopped = false;
    let animationFrame = 0;
    const activeScene = sceneRef.current;
    const markerWidthM = mmToMeters(marker.widthMm);
    const markerHeightM = mmToMeters(marker.heightMm);
    const maxMarkerMeters = Math.max(markerWidthM, markerHeightM);

    onMetricsChange?.(null);
    onStatusChange?.(activeScene?.modelUrl ? "Loading 3D scene..." : "Ready for a GLB scene.");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0xf6f7f9);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 1000);
    camera.position.set(0.35, Math.max(maxMarkerMeters * 0.75, 0.75), Math.max(maxMarkerMeters * 0.95, 0.95));
    camera.lookAt(0, 0, 0);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0, 0);

    threeScene.add(new THREE.AmbientLight(0xffffff, 1.45));
    threeScene.add(new THREE.HemisphereLight(0xffffff, 0xd7dee8, 2.1));
    const directional = new THREE.DirectionalLight(0xffffff, 2.4);
    directional.position.set(2, 4, 3);
    threeScene.add(directional);

    const boardImageUrl = getMarkerBoardImageUrl(marker);
    const fallbackBoardImageUrl = boardImageUrlForStyle(
      "technical-grid",
      marker.widthMm,
      marker.heightMm,
      marker.trackingMarkerSizeOnBoardMm,
      marker.trackingMarkerPositionOnBoard
    );
    const fallbackTexture = createFallbackBoardTexture(marker.widthMm, marker.heightMm);
    let boardTexture: THREE.Texture = fallbackTexture;
    const boardMaterial = new THREE.MeshBasicMaterial({
      map: boardTexture,
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin("anonymous");

    const applyBoardTexture = (nextTexture: THREE.Texture) => {
      nextTexture.colorSpace = THREE.SRGBColorSpace;
      nextTexture.needsUpdate = true;
      if (stopped) {
        nextTexture.dispose();
        return;
      }

      boardTexture.dispose();
      boardTexture = nextTexture;
      boardMaterial.map = nextTexture;
      boardMaterial.needsUpdate = true;
    };

    const loadFallbackBoardTexture = () => {
      textureLoader.load(
        fallbackBoardImageUrl,
        applyBoardTexture,
        undefined,
        (fallbackError) => {
          console.error("Unable to load fallback board texture.", fallbackError);
        }
      );
    };

    textureLoader.load(
      boardImageUrl,
      applyBoardTexture,
      undefined,
      (textureError) => {
        console.error("Unable to load board texture. Falling back to technical grid.", textureError);
        loadFallbackBoardTexture();
      }
    );
    const markerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      boardMaterial
    );
    markerPlane.rotation.x = -Math.PI / 2;
    markerPlane.scale.set(markerWidthM, markerHeightM, 1);
    threeScene.add(markerPlane);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x1c1917 })
    );
    border.scale.set(markerWidthM, markerHeightM, 1);
    border.rotation.x = -Math.PI / 2;
    threeScene.add(border);

    const grid = new THREE.GridHelper(maxMarkerMeters, 10, 0x8b98aa, 0xd5dbe5);
    grid.position.y = 0.002;
    threeScene.add(grid);

    const axes = createAppAxesHelper(Math.min(maxMarkerMeters * 0.28, 0.3));
    axes.position.set(0, 0.01, 0);
    threeScene.add(axes);

    let transform: TransformControls | null = null;
    let transformHelper: ReturnType<TransformControls["getHelper"]> | null = null;
    let cleanupTransformKeyboard: (() => void) | null = null;

    if (editable) {
      transform = new TransformControls(camera, renderer.domElement);
      transform.setMode(transformMode);
      transform.setSpace("local");
      transformRef.current = transform;
      transformHelper = transform.getHelper();
      threeScene.add(transformHelper);

      transform.addEventListener("dragging-changed", (event) => {
        orbit.enabled = !(event as { value?: boolean }).value;
      });
      transform.addEventListener("objectChange", () => {
        const model = modelRef.current;
        const currentScene = sceneRef.current;
        if (!model || !currentScene) return;
        onSceneChange?.(sceneTransformFromObject(currentScene, model, baseFitScaleRef.current));
      });

      const setSnap = (enabled: boolean) => {
        transform?.setTranslationSnap(enabled ? 0.05 : null);
        transform?.setRotationSnap(enabled ? THREE.MathUtils.degToRad(45) : null);
        transform?.setScaleSnap(enabled ? 0.1 : null);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Shift") setSnap(true);
      };
      const handleKeyUp = (event: KeyboardEvent) => {
        if (event.key === "Shift") setSnap(false);
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      transform.addEventListener("mouseUp", () => setSnap(false));

      cleanupTransformKeyboard = () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    }

    async function loadModel() {
      if (!activeScene?.modelUrl) return;

      try {
        const gltf = await loadGltfModel(activeScene.modelUrl);
        if (stopped) return;

        const model = gltf.scene;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
          }
        });

        threeScene.add(model);
        modelRef.current = model;
        const fit = computeBaseFitScaleFromObject(model, {
          widthMm: marker.widthMm,
          heightMm: marker.heightMm
        });
        baseFitScaleRef.current = fit.baseFitScale;
        modelDimensionsRef.current = {
          modelWidthM: fit.modelWidthM,
          modelDepthM: fit.modelDepthM
        };
        const displayedScale = computeSceneDisplayScale(sceneRef.current || activeScene, fit.baseFitScale);
        applySceneTransform(model, sceneRef.current || activeScene, displayedScale);
        onMetricsChange?.({
          ...fit,
          displayedScale
        });
        transform?.attach(model);
        onStatusChange?.("Scene loaded.");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unable to load GLB model.";
        onStatusChange?.(message);
      }
    }

    function resize() {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(bounds.width, 320);
      const height = Math.max(bounds.height, 360);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function animate() {
      if (stopped) return;
      animationFrame = window.requestAnimationFrame(animate);
      orbit.update();
      renderer.render(threeScene, camera);
    }

    resize();
    window.addEventListener("resize", resize);
    void loadModel();
    animate();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      transform?.detach();
      transform?.dispose();
      cleanupTransformKeyboard?.();
      transformHelper?.dispose();
      orbit.dispose();
      boardTexture.dispose();
      markerPlane.geometry.dispose();
      disposeMaterial(markerPlane.material);
      border.geometry.dispose();
      disposeMaterial(border.material);
      disposeObject(axes);
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
      transformRef.current = null;
    };
  }, [
    editable,
    marker,
    marker.heightMm,
    marker.boardImageUrl,
    marker.boardStyle,
    marker.imageUrl,
    marker.trackingMarkerPositionOnBoard,
    marker.trackingMarkerSizeOnBoardMm,
    marker.widthMm,
    onMetricsChange,
    onSceneChange,
    onStatusChange,
    scene?.id,
    scene?.modelUrl,
    transformMode
  ]);

  return (
    <div className={`relative min-h-[420px] overflow-hidden bg-[var(--soft)] ${className}`}>
      <div ref={hostRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-[var(--line)] bg-white/88 p-2 shadow-sm backdrop-blur">
        <div className="relative h-14 w-14">
          <span className="absolute left-7 top-7 h-0.5 w-7 origin-left -rotate-[14deg] bg-[#ef4444]" />
          <span className="absolute left-[3.15rem] top-[1.45rem] text-[10px] font-black text-[#ef4444]">X</span>
          <span className="absolute left-7 top-7 h-0.5 w-7 origin-left rotate-[35deg] bg-[#22c55e]" />
          <span className="absolute left-[2.9rem] top-[2.85rem] text-[10px] font-black text-[#22c55e]">Y</span>
          <span className="absolute left-7 top-7 h-7 w-0.5 origin-bottom bg-[#3b82f6]" />
          <span className="absolute left-[1.45rem] top-0 text-[10px] font-black text-[#3b82f6]">Z</span>
          <span className="absolute left-[1.85rem] top-[1.85rem] h-2 w-2 rounded-full bg-[var(--ink)]" />
        </div>
      </div>
      {editable ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--line)] bg-white/90 px-3 py-2 text-xs font-bold text-[var(--muted)] shadow-sm backdrop-blur">
          Hold Shift to snap
        </div>
      ) : null}
      {!scene ? (
        <ViewportMessage title="No scene selected" body="Add a GLB scene from the left sidebar to begin." />
      ) : !scene.modelUrl ? (
        <ViewportMessage title="Scene has no GLB yet" body="Upload a GLB in the inspector to render it here." />
      ) : null}
    </div>
  );
}

function ViewportMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
      <div className="max-w-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-center shadow-sm backdrop-blur">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        <p className="mt-2 text-sm leading-5 text-[var(--muted)]">{body}</p>
      </div>
    </div>
  );
}

function createAppAxesHelper(size: number) {
  const group = new THREE.Group();
  const origin = new THREE.Vector3(0, 0, 0);

  group.add(createAxisLine(origin, new THREE.Vector3(size, 0, 0), APP_AXIS_COLORS.x));
  group.add(createAxisLine(origin, new THREE.Vector3(0, 0, size), APP_AXIS_COLORS.y));
  group.add(createAxisLine(origin, new THREE.Vector3(0, size, 0), APP_AXIS_COLORS.z));

  return group;
}

function createAxisLine(start: THREE.Vector3, end: THREE.Vector3, color: string) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geometry, material);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  material.dispose();
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function createFallbackBoardTexture(widthMm: number, heightMm: number) {
  const width = 1024;
  const height = Math.max(512, Math.round(width * (heightMm / Math.max(widthMm, 1))));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#111827";
    context.lineWidth = 14;
    context.strokeRect(20, 20, width - 40, height - 40);
    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 2;

    for (let index = 1; index < 10; index += 1) {
      const x = (width * index) / 10;
      context.beginPath();
      context.moveTo(x, 24);
      context.lineTo(x, height - 24);
      context.stroke();
    }

    for (let index = 1; index < 8; index += 1) {
      const y = (height * index) / 8;
      context.beginPath();
      context.moveTo(24, y);
      context.lineTo(width - 24, y);
      context.stroke();
    }

    const markerSize = Math.min(width, height) * 0.34;
    const markerX = width / 2 - markerSize / 2;
    const markerY = height / 2 - markerSize / 2;
    drawFallbackTracker(context, markerX, markerY, markerSize);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawFallbackTracker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
) {
  const scale = size / 256;
  context.fillStyle = "#000000";
  context.fillRect(x, y, size, size);
  context.fillStyle = "#ffffff";
  context.fillRect(x + 32 * scale, y + 32 * scale, 192 * scale, 192 * scale);
  context.fillStyle = "#000000";
  context.fillRect(x + 52 * scale, y + 52 * scale, 58 * scale, 58 * scale);
  context.fillRect(x + 136 * scale, y + 52 * scale, 68 * scale, 34 * scale);
  context.fillRect(x + 148 * scale, y + 86 * scale, 34 * scale, 94 * scale);
  context.fillRect(x + 72 * scale, y + 144 * scale, 96 * scale, 34 * scale);
  context.fillRect(x + 184 * scale, y + 164 * scale, 24 * scale, 44 * scale);
}
