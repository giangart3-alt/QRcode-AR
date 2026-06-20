"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { APP_AXIS_COLORS, applyEditorBoardSpaceRoot } from "@/lib/coordinates";
import {
  getImageTargetGeometry,
  type ImageTargetSettings
} from "@/lib/placement";
import {
  applyRuntimeSceneTransform,
  configureModelCorrectionHierarchy,
  computeSceneTransformForRuntime,
  sceneTransformFromObject,
  type SceneScaleMetrics
} from "@/lib/scene-transform";
import { collectModelPerformanceStats, type ModelPerformanceStats } from "@/lib/model-stats";
import { loadGltfModel } from "@/lib/three-gltf";
import type { SceneMetadata } from "@/lib/projects";

export type TransformMode = "translate" | "rotate" | "scale";

type SceneThreeViewportProps = {
  scene: SceneMetadata | null;
  target: ImageTargetSettings;
  editable?: boolean;
  transformMode?: TransformMode;
  className?: string;
  onSceneChange?: (scene: SceneMetadata) => void;
  onStatusChange?: (status: string) => void;
  onMetricsChange?: (metrics: SceneScaleMetrics | null) => void;
};

export function SceneThreeViewport({
  scene,
  target,
  editable = false,
  transformMode = "translate",
  className = "",
  onSceneChange,
  onStatusChange,
  onMetricsChange
}: SceneThreeViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const fitObjectRef = useRef<THREE.Object3D | null>(null);
  const transformObjectRef = useRef<THREE.Object3D | null>(null);
  const scaleObjectRef = useRef<THREE.Object3D | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const sceneRef = useRef<SceneMetadata | null>(scene);
  const baseFitScaleRef = useRef(1);
  const modelStatsRef = useRef<ModelPerformanceStats | null>(null);

  const emitMetrics = useCallback((nextMetrics: SceneScaleMetrics) => {
    onMetricsChange?.(
      modelStatsRef.current
        ? { ...nextMetrics, modelStats: modelStatsRef.current }
        : nextMetrics
    );
  }, [onMetricsChange]);

  const applyCurrentScene = useCallback(() => {
    const fitObject = fitObjectRef.current;
    const placementRoot = transformObjectRef.current;
    const scaleRoot = scaleObjectRef.current;
    const currentScene = sceneRef.current;
    if (!fitObject || !placementRoot || !scaleRoot || !currentScene) return;

    placementRoot.position.set(0, 0, 0);
    placementRoot.quaternion.identity();
    placementRoot.scale.set(1, 1, 1);
    scaleRoot.position.set(0, 0, 0);
    scaleRoot.quaternion.identity();
    scaleRoot.scale.set(1, 1, 1);
    placementRoot.updateMatrixWorld(true);
    scaleRoot.updateMatrixWorld(true);

    const runtimeTransform = computeSceneTransformForRuntime(fitObject, currentScene, target, "desktop");
    applyRuntimeSceneTransform(placementRoot, scaleRoot, runtimeTransform);
    baseFitScaleRef.current = runtimeTransform.metrics.baseFitScale;
    emitMetrics(runtimeTransform.metrics);
  }, [target, emitMetrics]);

  useEffect(() => {
    sceneRef.current = scene;
    applyCurrentScene();
  }, [applyCurrentScene, scene]);

  useEffect(() => {
    transformRef.current?.setMode(transformMode);
    const targetObject =
      transformMode === "scale" ? scaleObjectRef.current : transformObjectRef.current;
    if (targetObject) {
      transformRef.current?.attach(targetObject);
    }
  }, [transformMode]);

  useEffect(() => {
    if (!hostRef.current) return;

    const host = hostRef.current;
    let stopped = false;
    let animationFrame = 0;
    const activeScene = sceneRef.current;
    const targetGeometry = getImageTargetGeometry(target);
    const maxTargetMeters = Math.max(targetGeometry.widthM, targetGeometry.heightM);

    onMetricsChange?.(null);
    modelStatsRef.current = null;
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
    camera.position.set(
      targetGeometry.widthM * 0.45,
      Math.max(maxTargetMeters * 0.75, 0.75),
      Math.max(maxTargetMeters * 0.95, 0.95)
    );
    camera.lookAt(0, 0, 0);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0, 0);

    threeScene.add(new THREE.AmbientLight(0xffffff, 1.45));
    threeScene.add(new THREE.HemisphereLight(0xffffff, 0xd7dee8, 2.1));
    const directional = new THREE.DirectionalLight(0xffffff, 2.4);
    directional.position.set(2, 4, 3);
    threeScene.add(directional);

    const targetTexture = createFallbackTargetTexture();
    const targetMaterial = new THREE.MeshBasicMaterial({
      map: targetTexture,
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin("anonymous");

    const applyTargetTexture = (nextTexture: THREE.Texture) => {
      nextTexture.colorSpace = THREE.SRGBColorSpace;
      nextTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      nextTexture.needsUpdate = true;
      if (stopped) {
        nextTexture.dispose();
        return;
      }

      targetTexture.dispose();
      targetMaterial.map = nextTexture;
      targetMaterial.needsUpdate = true;
    };

    textureLoader.load(
      target.previewUrl || target.imageUrl,
      applyTargetTexture,
      undefined,
      (textureError) => {
        console.error("Unable to load image target texture.", textureError);
      }
    );

    const targetPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      targetMaterial
    );
    targetPlane.rotation.x = -Math.PI / 2;
    targetPlane.scale.set(targetGeometry.widthM, targetGeometry.heightM, 1);
    threeScene.add(targetPlane);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x1c1917 })
    );
    border.scale.set(targetGeometry.widthM, targetGeometry.heightM, 1);
    border.rotation.x = -Math.PI / 2;
    threeScene.add(border);

    const axes = createAppAxesHelper(Math.min(maxTargetMeters * 0.18, 0.35));
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
        const placementRoot = transformObjectRef.current;
        const scaleRoot = scaleObjectRef.current;
        const currentScene = sceneRef.current;
        if (!placementRoot || !scaleRoot || !currentScene) return;

        const uniformScale =
          (Math.abs(scaleRoot.scale.x) +
            Math.abs(scaleRoot.scale.y) +
            Math.abs(scaleRoot.scale.z)) / 3;
        if (Number.isFinite(uniformScale) && uniformScale > 0) {
          scaleRoot.scale.setScalar(uniformScale);
        }

        onSceneChange?.(
          sceneTransformFromObject(currentScene, placementRoot, scaleRoot, baseFitScaleRef.current)
        );
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
        modelStatsRef.current = collectModelPerformanceStats(model);
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
          }
        });

        const boardSpaceRoot = new THREE.Group();
        const placementRoot = new THREE.Group();
        const modelCorrectionGroup = new THREE.Group();
        const scaleRoot = new THREE.Group();
        applyEditorBoardSpaceRoot(boardSpaceRoot);
        placementRoot.add(modelCorrectionGroup);
        configureModelCorrectionHierarchy({
          correctionRoot: modelCorrectionGroup,
          scaleRoot,
          model,
          correctionMode: target.correctionMode
        });
        boardSpaceRoot.add(placementRoot);
        threeScene.add(boardSpaceRoot);

        modelRef.current = model;
        fitObjectRef.current = modelCorrectionGroup;
        transformObjectRef.current = placementRoot;
        scaleObjectRef.current = scaleRoot;
        placementRoot.updateMatrixWorld(true);
        const runtimeTransform = computeSceneTransformForRuntime(
          modelCorrectionGroup,
          sceneRef.current || activeScene,
          target,
          "desktop"
        );
        applyRuntimeSceneTransform(placementRoot, scaleRoot, runtimeTransform);
        baseFitScaleRef.current = runtimeTransform.metrics.baseFitScale;
        emitMetrics(runtimeTransform.metrics);
        transform?.attach(transformMode === "scale" ? scaleRoot : placementRoot);
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
      disposeTexture(targetMaterial.map);
      targetPlane.geometry.dispose();
      disposeMaterial(targetPlane.material);
      border.geometry.dispose();
      disposeMaterial(border.material);
      disposeObject(axes);
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
      fitObjectRef.current = null;
      transformObjectRef.current = null;
      scaleObjectRef.current = null;
      transformRef.current = null;
    };
  }, [
    editable,
    target,
    target.heightMm,
    target.imageUrl,
    target.previewUrl,
    target.correctionMode,
    target.widthMm,
    onMetricsChange,
    emitMetrics,
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

function createFallbackTargetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 768;
  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#94a3b8";
    context.lineWidth = 4;
    context.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeTexture(texture: THREE.Texture | null) {
  texture?.dispose();
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
