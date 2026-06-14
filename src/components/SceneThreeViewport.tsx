"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { MarkerSettings } from "@/lib/placement";
import { mmToMeters } from "@/lib/placement";
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
    threeScene.background = new THREE.Color(0xf3f6f5);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 1000);
    camera.position.set(0.35, Math.max(maxMarkerMeters * 0.75, 0.75), Math.max(maxMarkerMeters * 0.95, 0.95));
    camera.lookAt(0, 0, 0);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0, 0);

    threeScene.add(new THREE.AmbientLight(0xffffff, 1.5));
    threeScene.add(new THREE.HemisphereLight(0xffffff, 0x60706c, 2.2));
    const directional = new THREE.DirectionalLight(0xffffff, 2.4);
    directional.position.set(2, 4, 3);
    threeScene.add(directional);

    const texture = new THREE.TextureLoader().load(marker.imageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    const markerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0,
        side: THREE.DoubleSide
      })
    );
    markerPlane.rotation.x = -Math.PI / 2;
    markerPlane.scale.set(markerWidthM, markerHeightM, 1);
    threeScene.add(markerPlane);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x101615 })
    );
    border.scale.set(markerWidthM, markerHeightM, 1);
    border.rotation.x = -Math.PI / 2;
    threeScene.add(border);

    const grid = new THREE.GridHelper(maxMarkerMeters, 10, 0x0f766e, 0x9aa8a4);
    grid.position.y = 0.002;
    threeScene.add(grid);

    const axes = new THREE.AxesHelper(Math.min(maxMarkerMeters * 0.28, 0.3));
    axes.position.set(0, 0.01, 0);
    threeScene.add(axes);

    let transform: TransformControls | null = null;
    let transformHelper: ReturnType<TransformControls["getHelper"]> | null = null;

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
      transformHelper?.dispose();
      orbit.dispose();
      texture.dispose();
      markerPlane.geometry.dispose();
      disposeMaterial(markerPlane.material);
      border.geometry.dispose();
      disposeMaterial(border.material);
      renderer.dispose();
      renderer.domElement.remove();
      modelRef.current = null;
      transformRef.current = null;
    };
  }, [
    editable,
    marker.heightMm,
    marker.imageUrl,
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
      <div className="max-w-sm rounded-xl border border-[var(--line)] bg-white/90 p-5 text-center shadow-sm backdrop-blur">
        <h2 className="text-xl font-black text-[var(--ink)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
      </div>
    </div>
  );
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  material.dispose();
}
