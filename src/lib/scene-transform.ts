import * as THREE from "three";
import {
  appPositionMmToThreeMeters,
  appRotationDegreesToThreeRadians,
  threePositionMetersToAppMm,
  threeRotationRadiansToAppDegrees
} from "@/lib/coordinates";
import { mmToMeters } from "@/lib/placement";
import type { MarkerSettings } from "@/lib/placement";
import type { SceneMetadata } from "@/lib/projects";

export type SceneScaleMetrics = {
  modelWidthM: number;
  modelDepthM: number;
  baseFitScale: number;
  displayedScale: number;
};

const FIT_MARGIN = 0.9;

export function computeBaseFitScaleFromObject(
  model: THREE.Object3D,
  marker: Pick<MarkerSettings, "widthMm" | "heightMm">
) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, 0.001);
  const depth = Math.max(size.z, 0.001);
  const markerWidth = Math.max(mmToMeters(marker.widthMm), 0.001);
  const markerHeight = Math.max(mmToMeters(marker.heightMm), 0.001);

  return {
    modelWidthM: width,
    modelDepthM: depth,
    baseFitScale: Math.min(markerWidth / width, markerHeight / depth) * FIT_MARGIN
  };
}

export function computeSceneDisplayScale(scene: SceneMetadata, baseFitScale: number) {
  if (scene.scaleMode === "architectural") {
    return 1 / positiveNumber(scene.architecturalScale, 100);
  }

  return positiveNumber(baseFitScale, 1) * positiveNumber(scene.normalizedScale, 1);
}

export function applySceneTransform(
  model: THREE.Object3D,
  scene: SceneMetadata,
  displayedScale: number
) {
  model.position.copy(appPositionMmToThreeMeters(scene.placement.position));
  model.rotation.copy(appRotationDegreesToThreeRadians(scene.placement.rotation));
  model.scale.setScalar(displayedScale);
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

function positiveNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
