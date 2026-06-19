import * as THREE from "three";
import type { PlacementMetadata } from "@/lib/placement";
import {
  degreesToRadians,
  metersToMm,
  mmToMeters,
  normalizeDegrees,
  radiansToDegrees
} from "@/lib/placement";

export type AppAxis = "x" | "y" | "z";

export const APP_AXIS_COLORS: Record<AppAxis, string> = {
  x: "#ef4444",
  y: "#22c55e",
  z: "#3b82f6"
};

export type BoardSpaceRuntimeTransform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  rotation: THREE.Euler;
  scale: number;
};

// Canonical board space is X/Y on the image target and Z above it. The desktop
// Three scene is Y-up with the image target on X/Z, so board Y and Z are swapped.
export const EDITOR_SCENE_FROM_BOARD_MATRIX = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);

export const BOARD_FROM_EDITOR_SCENE_MATRIX = EDITOR_SCENE_FROM_BOARD_MATRIX.clone().invert();

// GLBs arrive in Three's usual Y-up model basis. The app's board basis is Z-up,
// so this source-model adapter is intentionally separate from user placement.
export const BOARD_FROM_SOURCE_MODEL_MATRIX = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);

export const SOURCE_MODEL_FROM_BOARD_MATRIX = BOARD_FROM_SOURCE_MODEL_MATRIX.clone().invert();

export function placementToBoardSpaceTransform(
  placement: PlacementMetadata,
  scale = placement.scale
): BoardSpaceRuntimeTransform {
  const quaternion = rotationDegreesToBoardQuaternion(placement.rotation);

  return {
    position: boardPositionMmToMeters(placement.position),
    quaternion,
    rotation: new THREE.Euler().setFromQuaternion(quaternion, "XYZ"),
    scale
  };
}

export function boardSpaceToEditorScene(
  placement: PlacementMetadata,
  scale = placement.scale
): BoardSpaceRuntimeTransform {
  const boardTransform = placementToBoardSpaceTransform(placement, scale);
  const quaternion = convertQuaternionBasis(
    boardTransform.quaternion,
    EDITOR_SCENE_FROM_BOARD_MATRIX
  );

  return {
    position: boardTransform.position.clone().applyMatrix4(EDITOR_SCENE_FROM_BOARD_MATRIX),
    quaternion,
    rotation: new THREE.Euler().setFromQuaternion(quaternion, "XYZ"),
    scale
  };
}

export function editorSceneToBoardSpace(input: {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
}): PlacementMetadata {
  const boardPosition = input.position.clone().applyMatrix4(BOARD_FROM_EDITOR_SCENE_MATRIX);
  const boardQuaternion = convertQuaternionBasis(
    input.quaternion,
    BOARD_FROM_EDITOR_SCENE_MATRIX
  );

  return {
    position: boardPositionMetersToMm(boardPosition),
    rotation: boardQuaternionToRotationDegrees(boardQuaternion),
    scale: input.scale
  };
}

export function boardSpaceToMindAR(
  placement: PlacementMetadata,
  targetWidthM: number,
  scale = placement.scale
): BoardSpaceRuntimeTransform {
  const safeTargetWidthM = Math.max(targetWidthM, 0.001);
  const boardTransform = placementToBoardSpaceTransform(placement, scale);

  return {
    position: boardTransform.position.clone().multiplyScalar(1 / safeTargetWidthM),
    quaternion: boardTransform.quaternion.clone(),
    rotation: boardTransform.rotation.clone(),
    scale: scale / safeTargetWidthM
  };
}

export function boardSpaceFromObject(input: {
  object: THREE.Object3D;
  scale: number;
}): PlacementMetadata {
  return {
    position: boardPositionMetersToMm(input.object.position),
    rotation: boardQuaternionToRotationDegrees(input.object.quaternion),
    scale: input.scale
  };
}

export function applyEditorBoardSpaceRoot(root: THREE.Object3D) {
  root.matrixAutoUpdate = false;
  root.matrix.copy(EDITOR_SCENE_FROM_BOARD_MATRIX);
  root.matrixWorldNeedsUpdate = true;
  root.updateMatrixWorld(true);
}

export function applyMindARBoardSpaceRoot(root: THREE.Object3D, targetWidthM: number) {
  const safeTargetWidthM = Math.max(targetWidthM, 0.001);
  root.matrixAutoUpdate = false;
  root.matrix.makeScale(
    1 / safeTargetWidthM,
    1 / safeTargetWidthM,
    1 / safeTargetWidthM
  );
  root.matrixWorldNeedsUpdate = true;
  root.updateMatrixWorld(true);
}

export function boardPositionMmToMeters(position: PlacementMetadata["position"]) {
  return new THREE.Vector3(
    mmToMeters(position.x),
    mmToMeters(position.y),
    mmToMeters(position.z)
  );
}

export function boardPositionMetersToMm(position: THREE.Vector3) {
  return {
    x: metersToMm(position.x),
    y: metersToMm(position.y),
    z: metersToMm(position.z)
  };
}

export function rotationDegreesToBoardQuaternion(rotation: PlacementMetadata["rotation"]) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      degreesToRadians(rotation.x),
      degreesToRadians(rotation.y),
      degreesToRadians(rotation.z),
      "XYZ"
    )
  );
}

export function boardQuaternionToRotationDegrees(quaternion: THREE.Quaternion) {
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");

  return {
    x: normalizeDegrees(radiansToDegrees(rotation.x)),
    y: normalizeDegrees(radiansToDegrees(rotation.y)),
    z: normalizeDegrees(radiansToDegrees(rotation.z))
  };
}

export function convertQuaternionBasis(
  quaternion: THREE.Quaternion,
  basis: THREE.Matrix4
) {
  const inverseBasis = basis.clone().invert();
  const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
  const convertedMatrix = basis.clone().multiply(rotationMatrix).multiply(inverseBasis);

  return new THREE.Quaternion().setFromRotationMatrix(convertedMatrix).normalize();
}

// Legacy helpers for older code paths and persisted schema migration. Prefer the
// explicit board-space helpers above for new placement/runtime code.
export function appPositionMmToThreeMeters(position: PlacementMetadata["position"]) {
  return new THREE.Vector3(
    mmToMeters(position.x),
    mmToMeters(position.z),
    mmToMeters(position.y)
  );
}

export function threePositionMetersToAppMm(position: THREE.Vector3) {
  return {
    x: metersToMm(position.x),
    y: metersToMm(position.z),
    z: metersToMm(position.y)
  };
}

export function appRotationDegreesToThreeRadians(rotation: PlacementMetadata["rotation"]) {
  return new THREE.Euler(
    degreesToRadians(rotation.x),
    degreesToRadians(rotation.z),
    degreesToRadians(rotation.y)
  );
}

export function threeRotationRadiansToAppDegrees(rotation: THREE.Euler) {
  return {
    x: radiansToDegrees(rotation.x),
    y: radiansToDegrees(rotation.z),
    z: radiansToDegrees(rotation.y)
  };
}

export function migrateLegacyYUpPlacementToZUp(placement: PlacementMetadata): PlacementMetadata {
  return {
    ...placement,
    position: {
      x: placement.position.x,
      y: placement.position.z,
      z: placement.position.y
    },
    rotation: {
      x: placement.rotation.x,
      y: placement.rotation.z,
      z: placement.rotation.y
    }
  };
}
