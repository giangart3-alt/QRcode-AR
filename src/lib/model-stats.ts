import * as THREE from "three";

export type ModelPerformanceWarningLevel = "none" | "warning" | "heavy" | "severe";

export type ModelPerformanceStats = {
  modelLoaded: boolean;
  meshCount: number;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  geometryCount: number;
  warningLevel: ModelPerformanceWarningLevel;
  warning: string;
};

export function collectModelPerformanceStats(root: THREE.Object3D | null): ModelPerformanceStats {
  if (!root) {
    return {
      modelLoaded: false,
      meshCount: 0,
      triangleCount: 0,
      materialCount: 0,
      textureCount: 0,
      geometryCount: 0,
      warningLevel: "none",
      warning: ""
    };
  }

  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  let meshCount = 0;
  let triangleCount = 0;

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;

    meshCount += 1;
    geometries.add(child.geometry);
    const index = child.geometry.getIndex();
    const position = child.geometry.getAttribute("position");
    const vertexCount = index?.count || position?.count || 0;
    triangleCount += Math.floor(vertexCount / 3);

    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((material) => {
      if (!material) return;
      materials.add(material);
      collectMaterialTextures(material, textures);
    });
  });

  const warning = modelPerformanceWarning(triangleCount);

  return {
    modelLoaded: true,
    meshCount,
    triangleCount,
    materialCount: materials.size,
    textureCount: textures.size,
    geometryCount: geometries.size,
    warningLevel: warning.level,
    warning: warning.message
  };
}

export function modelPerformanceWarning(triangleCount: number): {
  level: ModelPerformanceWarningLevel;
  message: string;
} {
  const formatted = formatTriangleCount(triangleCount);

  if (triangleCount > 900000) {
    return {
      level: "severe",
      message: `Severe: ${formatted} triangles may reduce FPS and increase tracking latency on mobile.`
    };
  }

  if (triangleCount > 500000) {
    return {
      level: "heavy",
      message: `Heavy: ${formatted} triangles may reduce mobile WebAR frame rate and tracking responsiveness.`
    };
  }

  if (triangleCount > 300000) {
    return {
      level: "warning",
      message: `Warning: ${formatted} triangles is high for mobile WebAR; consider an optimized GLB for production.`
    };
  }

  return {
    level: "none",
    message: ""
  };
}

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>) {
  Object.values(material as unknown as Record<string, unknown>).forEach((value) => {
    if (value instanceof THREE.Texture) {
      textures.add(value);
    }
  });
}

function formatTriangleCount(count: number) {
  if (count >= 1000) {
    return `${Math.round(count / 1000)}k`;
  }

  return String(count);
}
