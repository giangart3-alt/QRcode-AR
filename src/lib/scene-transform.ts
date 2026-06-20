import * as THREE from "three";
import {
  BOARD_FROM_SOURCE_MODEL_MATRIX,
  boardSpaceFromObject,
  boardSpaceToEditorScene,
  boardSpaceToMindAR,
  placementToBoardSpaceTransform
} from "@/lib/coordinates";
import {
  DEFAULT_TARGET_HEIGHT_MM,
  DEFAULT_TARGET_WIDTH_MM,
  correctionRotationRadians,
  getImageTargetGeometry,
  normalizeDegrees,
  type ImageTargetSettings,
  type ModelCorrectionMode,
  type PlacementMetadata
} from "@/lib/placement";
import type { ModelPerformanceStats } from "@/lib/model-stats";
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
  modelStats?: ModelPerformanceStats;
};

export type SceneRuntimeTransform = {
  runtime: SceneRuntimeKind;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  rotation: THREE.Euler;
  scale: number;
  metrics: SceneScaleMetrics;
  appPlacement: PlacementMetadata;
  editorAppliedTransform: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    rotation: THREE.Euler;
    scale: number;
  };
  mindARAppliedTransform: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    rotation: THREE.Euler;
    scale: number;
  };
};

const FIT_MARGIN = 0.9;

export type ModelBoundsInfo = {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  valid: boolean;
  longestAxis: "x" | "y" | "z";
};

export type ModelCorrectionMetrics = {
  correctionMode: ModelCorrectionMode;
  sourceCenterOffset: THREE.Vector3;
  correctionMatrix: THREE.Matrix4;
  boundsBeforeCorrection: ModelBoundsInfo;
  boundsAfterCorrection: ModelBoundsInfo;
  longestAxisAfterCorrection: "x" | "y" | "z";
};

export function computeBaseFitScaleFromObject(
  model: THREE.Object3D,
  target: Pick<ImageTargetSettings, "widthMm" | "heightMm">
) {
  const bounds = computeObjectBounds(model);
  const geometry = getImageTargetGeometry({
    widthMm: positiveNumber(target.widthMm, DEFAULT_TARGET_WIDTH_MM),
    heightMm: positiveNumber(target.heightMm, DEFAULT_TARGET_HEIGHT_MM)
  });

  return {
    modelWidthM: Math.max(bounds.size.x, 0.001),
    modelDepthM: Math.max(bounds.size.y, 0.001),
    modelHeightM: Math.max(bounds.size.z, 0.001),
    targetWidthM: Math.max(geometry.widthM, 0.001),
    targetHeightM: Math.max(geometry.heightM, 0.001),
    boundsValid: bounds.valid,
    baseFitScale: Math.min(
      geometry.widthM / Math.max(bounds.size.x, 0.001),
      geometry.heightM / Math.max(bounds.size.y, 0.001)
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
  const boardTransform = placementToBoardSpaceTransform(appPlacement, displayedScale);
  const editorAppliedTransform = boardSpaceToEditorScene(appPlacement, displayedScale);
  const mindARAppliedTransform = boardSpaceToMindAR(appPlacement, targetWidthM, displayedScale);

  return {
    runtime,
    position: boardTransform.position,
    quaternion: boardTransform.quaternion,
    rotation: boardTransform.rotation,
    scale: displayedScale,
    appPlacement,
    editorAppliedTransform,
    mindARAppliedTransform,
    metrics: {
      ...fit,
      displayedScale,
      runtimeScale,
      scaleFallbackReason
    }
  };
}

export function applyRuntimeSceneTransform(
  placementRoot: THREE.Object3D,
  scaleRoot: THREE.Object3D,
  transform: SceneRuntimeTransform
) {
  placementRoot.position.copy(transform.position);
  placementRoot.quaternion.copy(transform.quaternion);
  placementRoot.scale.setScalar(1);
  scaleRoot.position.set(0, 0, 0);
  scaleRoot.quaternion.identity();
  scaleRoot.scale.setScalar(transform.scale);
  placementRoot.updateMatrixWorld(true);
  scaleRoot.updateMatrixWorld(true);
}

export function sceneTransformFromObject(
  scene: SceneMetadata,
  placementRoot: THREE.Object3D,
  scaleRoot: THREE.Object3D,
  baseFitScale: number
) {
  const displayedScale =
    (Math.abs(scaleRoot.scale.x) + Math.abs(scaleRoot.scale.y) + Math.abs(scaleRoot.scale.z)) / 3;
  const normalizedScale =
    displayedScale / positiveNumber(baseFitScale, 1);
  const boardPlacement = boardSpaceFromObject({
    object: placementRoot,
    scale: roundForStorage(displayedScale)
  });

  return {
    ...scene,
    normalizedScale: roundForStorage(normalizedScale),
    placement: {
      ...scene.placement,
      position: roundVector(boardPlacement.position),
      rotation: normalizeRotationVector(roundVector(boardPlacement.rotation)),
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

export function configureModelCorrectionHierarchy({
  correctionRoot,
  scaleRoot,
  model,
  correctionMode
}: {
  correctionRoot: THREE.Object3D;
  scaleRoot: THREE.Object3D;
  model: THREE.Object3D;
  correctionMode: ModelCorrectionMode;
}): ModelCorrectionMetrics {
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const boundsBeforeCorrection = computeObjectBounds(model);
  const correctionMatrix = sourceModelCorrectionMatrix(correctionMode);
  correctionRoot.matrixAutoUpdate = false;
  correctionRoot.matrix.copy(correctionMatrix);
  correctionRoot.matrixWorldNeedsUpdate = true;

  scaleRoot.position.set(0, 0, 0);
  scaleRoot.quaternion.identity();
  scaleRoot.scale.setScalar(1);

  if (scaleRoot.parent !== correctionRoot) {
    correctionRoot.add(scaleRoot);
  }

  if (model.parent !== scaleRoot) {
    scaleRoot.add(model);
  }

  correctionRoot.updateMatrixWorld(true);
  const uncenteredBounds = computeObjectBounds(correctionRoot);
  const sourceCenterOffset = uncenteredBounds.center
    .clone()
    .negate()
    .applyMatrix4(correctionMatrix.clone().invert());

  model.position.copy(sourceCenterOffset);
  model.updateMatrixWorld(true);
  correctionRoot.updateMatrixWorld(true);

  const boundsAfterCorrection = computeObjectBounds(correctionRoot);

  return {
    correctionMode,
    sourceCenterOffset,
    correctionMatrix,
    boundsBeforeCorrection,
    boundsAfterCorrection,
    longestAxisAfterCorrection: boundsAfterCorrection.longestAxis
  };
}

export function computeObjectBounds(object: THREE.Object3D): ModelBoundsInfo {
  object.updateWorldMatrix(true, true);
  const parentInverse = object.parent
    ? object.parent.matrixWorld.clone().invert()
    : new THREE.Matrix4();
  const box = new THREE.Box3();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;
    if (!child.geometry.boundingBox) {
      child.geometry.computeBoundingBox();
    }
    if (!child.geometry.boundingBox) return;

    const childBox = child.geometry.boundingBox.clone();
    childBox.applyMatrix4(parentInverse.clone().multiply(child.matrixWorld));
    box.union(childBox);
  });

  const valid = isFiniteBox(box) && !box.isEmpty();
  const fallbackBox = new THREE.Box3(
    new THREE.Vector3(-0.5, -0.5, -0.5),
    new THREE.Vector3(0.5, 0.5, 0.5)
  );
  const safeBox = valid ? box : fallbackBox;
  const size = safeBox.getSize(new THREE.Vector3());

  return {
    min: safeBox.min.clone(),
    max: safeBox.max.clone(),
    center: safeBox.getCenter(new THREE.Vector3()),
    size,
    valid,
    longestAxis: longestDimensionAxis(size)
  };
}

export function sourceModelCorrectionMatrix(mode: ModelCorrectionMode) {
  const correction = correctionRotationRadians(mode);
  const sourceRotation = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(correction.x, correction.y, correction.z, "XYZ")
  );

  return BOARD_FROM_SOURCE_MODEL_MATRIX.clone().multiply(sourceRotation);
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

function longestDimensionAxis(size: THREE.Vector3): "x" | "y" | "z" {
  if (size.x >= size.y && size.x >= size.z) return "x";
  if (size.y >= size.x && size.y >= size.z) return "y";
  return "z";
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
