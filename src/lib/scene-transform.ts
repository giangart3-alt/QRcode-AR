import * as THREE from "three";
import {
  appPositionMmToThreeMeters,
  appRotationDegreesToThreeRadians,
  threePositionMetersToAppMm,
  threeRotationRadiansToAppDegrees
} from "@/lib/coordinates";
import {
  DEFAULT_TARGET_HEIGHT_MM,
  DEFAULT_TARGET_WIDTH_MM,
  degreesToRadians,
  getImageTargetGeometry,
  mmToMeters,
  normalizeDegrees,
  type ImageTargetSettings,
  type PlacementMetadata
} from "@/lib/placement";
import type { SceneMetadata } from "@/lib/projects";

export type SceneRuntimeKind = "desktop" | "ar";

export type SceneScaleMetrics = {
  modelWidthM: number;
  modelDepthM: number;
  modelHeightM: number;
  baseFitScale: number;
  displayedScale: number;
  runtimeScale: number;
  targetWidthM: number;
  targetHeightM: number;
  boundsValid: boolean;
  scaleFallbackReason?: string;
};

export type SceneRuntimeTransform = {
  runtime: SceneRuntimeKind;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: number;
  metrics: SceneScaleMetrics;
  appPlacement: PlacementMetadata;
};

const FIT_MARGIN = 0.9;

export function computeBaseFitScaleFromObject(
  model: THREE.Object3D,
  target: Pick<ImageTargetSettings, "widthMm" | "heightMm">
) {
  const bounds = computeModelBounds(model);
  const geometry = getImageTargetGeometry({
    widthMm: positiveNumber(target.widthMm, DEFAULT_TARGET_WIDTH_MM),
    heightMm: positiveNumber(target.heightMm, DEFAULT_TARGET_HEIGHT_MM)
  });

  return {
    modelWidthM: bounds.widthM,
    modelDepthM: bounds.depthM,
    modelHeightM: bounds.heightM,
    targetWidthM: Math.max(geometry.widthM, 0.001),
    targetHeightM: Math.max(geometry.heightM, 0.001),
    boundsValid: bounds.valid,
    baseFitScale: Math.min(
      geometry.widthM / bounds.widthM,
      geometry.heightM / bounds.depthM
    ) * FIT_MARGIN
  };
}

export function computeSceneDisplayScale(scene: SceneMetadata, baseFitScale: number) {
  void scene.scaleMode;
  void scene.architecturalScale;

  return positiveNumber(baseFitScale, 1) * positiveNumber(scene.normalizedScale, 1);
}

export function computeSceneTransformForRuntime(
  model: THREE.Object3D,
  scene: SceneMetadata,
  target: Pick<ImageTargetSettings, "widthMm" | "heightMm">,
  runtime: SceneRuntimeKind = "desktop"
): SceneRuntimeTransform {
  const fit = computeBaseFitScaleFromObject(model, target);
  const computedScale = computeSceneDisplayScale(scene, fit.baseFitScale);
  const scaleFallbackReason =
    Number.isFinite(computedScale) && computedScale > 0
      ? undefined
      : "Saved scale was invalid; fit scale fallback applied.";
  const displayedScale = positiveNumber(computedScale, positiveNumber(fit.baseFitScale, 1));
  const appPlacement = safePlacement(scene.placement);
  const targetWidthM = Math.max(fit.targetWidthM, 0.001);
  const runtimeScale = runtime === "ar" ? displayedScale / targetWidthM : displayedScale;

  return {
    runtime,
    position:
      runtime === "ar"
        ? appPositionMmToMindArUnits(appPlacement.position, targetWidthM)
        : appPositionMmToThreeMeters(appPlacement.position),
    rotation:
      runtime === "ar"
        ? appRotationDegreesToMindArRadians(appPlacement.rotation)
        : appRotationDegreesToThreeRadians(appPlacement.rotation),
    scale: runtimeScale,
    appPlacement,
    metrics: {
      ...fit,
      displayedScale,
      runtimeScale,
      scaleFallbackReason
    }
  };
}

export function applyRuntimeSceneTransform(
  model: THREE.Object3D,
  transform: SceneRuntimeTransform
) {
  model.position.copy(transform.position);
  model.rotation.copy(transform.rotation);
  model.scale.setScalar(transform.scale);
  model.updateMatrixWorld(true);
}

export function sceneTransformFromObject(
  scene: SceneMetadata,
  model: THREE.Object3D,
  baseFitScale: number
) {
  const displayedScale =
    (Math.abs(model.scale.x) + Math.abs(model.scale.y) + Math.abs(model.scale.z)) / 3;
  const normalizedScale =
    displayedScale / positiveNumber(baseFitScale, 1);

  return {
    ...scene,
    normalizedScale: roundForStorage(normalizedScale),
    placement: {
      ...scene.placement,
      position: roundVector(threePositionMetersToAppMm(model.position)),
      rotation: normalizeRotationVector(roundVector(threeRotationRadiansToAppDegrees(model.rotation))),
      scale: roundForStorage(displayedScale)
    }
  } satisfies SceneMetadata;
}

export function withDisplayedScale(
  scene: SceneMetadata,
  baseFitScale: number
) {
  const displayedScale = computeSceneDisplayScale(scene, baseFitScale);

  return {
    ...scene,
    placement: {
      ...scene.placement,
      scale: roundForStorage(displayedScale)
    }
  } satisfies SceneMetadata;
}

export function fitModelToTarget(scene: SceneMetadata) {
  return {
    ...scene,
    scaleMode: "fit" as const,
    normalizedScale: 1
  } satisfies SceneMetadata;
}

export function roundForStorage(value: number) {
  return Math.round(value * 1000) / 1000;
}

function appPositionMmToMindArUnits(
  position: PlacementMetadata["position"],
  targetWidthM: number
) {
  return new THREE.Vector3(
    mmToMeters(position.x) / targetWidthM,
    mmToMeters(position.y) / targetWidthM,
    mmToMeters(position.z) / targetWidthM
  );
}

function appRotationDegreesToMindArRadians(rotation: PlacementMetadata["rotation"]) {
  return new THREE.Euler(
    degreesToRadians(rotation.x),
    degreesToRadians(rotation.y),
    degreesToRadians(rotation.z)
  );
}

function roundVector<T extends { x: number; y: number; z: number }>(vector: T) {
  return {
    x: roundForStorage(vector.x),
    y: roundForStorage(vector.y),
    z: roundForStorage(vector.z)
  };
}

function normalizeRotationVector<T extends { x: number; y: number; z: number }>(vector: T) {
  return {
    x: roundForStorage(normalizeDegrees(vector.x)),
    y: roundForStorage(normalizeDegrees(vector.y)),
    z: roundForStorage(normalizeDegrees(vector.z))
  };
}

function computeModelBounds(model: THREE.Object3D) {
  const savedPosition = model.position.clone();
  const savedQuaternion = model.quaternion.clone();
  const savedScale = model.scale.clone();

  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);

  model.position.copy(savedPosition);
  model.quaternion.copy(savedQuaternion);
  model.scale.copy(savedScale);
  model.updateMatrixWorld(true);

  const valid = isFiniteBox(box) && !box.isEmpty();
  const size = valid ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);

  return {
    valid,
    widthM: Math.max(size.x, 0.001),
    depthM: Math.max(size.z, 0.001),
    heightM: Math.max(size.y, 0.001)
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

function safePlacement(placement: PlacementMetadata): PlacementMetadata {
  return {
    ...placement,
    position: safeVector(placement.position),
    rotation: normalizeRotationVector(safeVector(placement.rotation)),
    scale: positiveNumber(placement.scale, 1)
  };
}

function safeVector<T extends { x: number; y: number; z: number }>(vector: T) {
  return {
    x: finiteNumber(vector.x, 0),
    y: finiteNumber(vector.y, 0),
    z: finiteNumber(vector.z, 0)
  };
}

function positiveNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}
