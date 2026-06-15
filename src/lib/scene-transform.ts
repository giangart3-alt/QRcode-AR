import * as THREE from "three";
import {
  appPositionMmToThreeMeters,
  appRotationDegreesToThreeRadians,
  threePositionMetersToAppMm,
  threeRotationRadiansToAppDegrees
} from "@/lib/coordinates";
import {
  DEFAULT_MARKER_HEIGHT_MM,
  DEFAULT_MARKER_WIDTH_MM,
  mmToMeters
} from "@/lib/placement";
import type { PlacementMetadata } from "@/lib/placement";
import type { MarkerSettings } from "@/lib/placement";
import type { SceneMetadata } from "@/lib/projects";

export type SceneRuntimeKind = "desktop" | "ar";

export type SceneScaleMetrics = {
  modelWidthM: number;
  modelDepthM: number;
  modelHeightM: number;
  baseFitScale: number;
  displayedScale: number;
  markerWidthM: number;
  markerHeightM: number;
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
  marker: Pick<MarkerSettings, "widthMm" | "heightMm">
) {
  const bounds = computeModelBounds(model);
  const markerWidthM = Math.max(mmToMeters(positiveNumber(marker.widthMm, DEFAULT_MARKER_WIDTH_MM)), 0.001);
  const markerHeightM = Math.max(mmToMeters(positiveNumber(marker.heightMm, DEFAULT_MARKER_HEIGHT_MM)), 0.001);

  return {
    modelWidthM: bounds.widthM,
    modelDepthM: bounds.depthM,
    modelHeightM: bounds.heightM,
    markerWidthM,
    markerHeightM,
    boundsValid: bounds.valid,
    baseFitScale: Math.min(markerWidthM / bounds.widthM, markerHeightM / bounds.depthM) * FIT_MARGIN
  };
}

export function computeSceneDisplayScale(scene: SceneMetadata, baseFitScale: number) {
  if (scene.scaleMode === "architectural") {
    return 1 / positiveNumber(scene.architecturalScale, 100);
  }

  return positiveNumber(baseFitScale, 1) * positiveNumber(scene.normalizedScale, 1);
}

export function computeSceneTransformForRuntime(
  model: THREE.Object3D,
  scene: SceneMetadata,
  marker: Pick<MarkerSettings, "widthMm" | "heightMm">,
  runtime: SceneRuntimeKind = "desktop"
): SceneRuntimeTransform {
  const fit = computeBaseFitScaleFromObject(model, marker);
  const computedScale = computeSceneDisplayScale(scene, fit.baseFitScale);
  const scaleFallbackReason =
    Number.isFinite(computedScale) && computedScale > 0
      ? undefined
      : "Saved scale was invalid; fit scale fallback applied.";
  const scale = positiveNumber(computedScale, positiveNumber(fit.baseFitScale, 1));
  const appPlacement = safePlacement(scene.placement);

  return {
    runtime,
    position: appPositionMmToThreeMeters(appPlacement.position),
    rotation: appRotationDegreesToThreeRadians(appPlacement.rotation),
    scale,
    appPlacement,
    metrics: {
      ...fit,
      displayedScale: scale,
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

export function applySceneTransform(
  model: THREE.Object3D,
  scene: SceneMetadata,
  displayedScale: number
) {
  const appPlacement = safePlacement(scene.placement);

  model.position.copy(appPositionMmToThreeMeters(appPlacement.position));
  model.rotation.copy(appRotationDegreesToThreeRadians(appPlacement.rotation));
  model.scale.setScalar(positiveNumber(displayedScale, 1));
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
    scene.scaleMode === "architectural"
      ? 1
      : displayedScale / positiveNumber(baseFitScale, 1);

  return {
    ...scene,
    normalizedScale: roundForStorage(normalizedScale),
    placement: {
      ...scene.placement,
      position: roundVector(threePositionMetersToAppMm(model.position)),
      rotation: roundVector(threeRotationRadiansToAppDegrees(model.rotation)),
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

export function fitModelToMarker(scene: SceneMetadata) {
  return {
    ...scene,
    scaleMode: "fit" as const,
    normalizedScale: 1
  } satisfies SceneMetadata;
}

export function roundForStorage(value: number) {
  return Math.round(value * 1000) / 1000;
}

function roundVector<T extends { x: number; y: number; z: number }>(vector: T) {
  return {
    x: roundForStorage(vector.x),
    y: roundForStorage(vector.y),
    z: roundForStorage(vector.z)
  };
}

function computeModelBounds(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
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
    rotation: safeVector(placement.rotation),
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
