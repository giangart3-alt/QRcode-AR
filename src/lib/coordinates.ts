import * as THREE from "three";
import type { PlacementMetadata } from "@/lib/placement";
import { degreesToRadians, metersToMm, mmToMeters, radiansToDegrees } from "@/lib/placement";

export type AppAxis = "x" | "y" | "z";

export const APP_AXIS_COLORS: Record<AppAxis, string> = {
  x: "#ef4444",
  y: "#22c55e",
  z: "#3b82f6"
};

// The app is Z-up: X is horizontal on the image, Y is vertical on the image, Z is height.
// Three.js remains Y-up internally, so app Y maps to Three Z and app Z maps to Three Y.
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
