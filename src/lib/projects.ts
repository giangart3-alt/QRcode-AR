import { del, list, put } from "@vercel/blob";
import {
  createDefaultMarker,
  createDefaultPlacement,
  MARKER_IMAGE_URL,
  MARKER_PATTERN_URL,
  normalizeMarker,
  normalizePlacement,
  type MarkerSettings,
  type PlacementMetadata
} from "@/lib/placement";

export const PROJECT_SCHEMA_VERSION = 2;

export type ScaleMode = "fit" | "architectural";

export type SceneMetadata = {
  id: string;
  name: string;
  modelUrl: string;
  modelPathname: string;
  modelSize: number;
  placement: PlacementMetadata;
  scaleMode: ScaleMode;
  architecturalScale: number;
  normalizedScale: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
};

export type ProjectUrls = {
  arUrl: string;
  viewUrl: string;
  markerUrl: string;
  dashboardUrl: string;
  editorUrl: string;
  legacyArUrl: string;
  legacyViewUrl: string;
};

export type ProjectMetadata = {
  id: string;
  name: string;
  schemaVersion: number;
  marker: MarkerSettings;
  activeSceneId: string;
  scenes: SceneMetadata[];
  createdAt: string;
  updatedAt: string;
  urls: ProjectUrls;
  arUrl: string;
  viewUrl: string;
  markerUrl: string;
  editorUrl: string;
  scale: number;
  verticalOffset: number;
  modelUrl: string;
  modelPathname: string;
  modelSize: number;
  placement: PlacementMetadata;
};

export type ProjectSummary = {
  id: string;
  name: string;
  schemaVersion: number;
  activeSceneId: string;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
  arUrl: string;
  viewUrl: string;
  markerUrl: string;
};

export class BlobConfigurationError extends Error {
  constructor() {
    super(
      "Vercel Blob is not configured. Add BLOB_READ_WRITE_TOKEN to this Vercel project, or connect the existing q-rcode-ar-blob store so Vercel injects it."
    );
    this.name = "BlobConfigurationError";
  }
}

type LegacyProjectShape = Partial<ProjectMetadata> & {
  markerWidthMm?: number;
  markerHeightMm?: number;
  markerImage?: string;
};

export function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new BlobConfigurationError();
  }
}

export function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://q-rcode-ar.vercel.app"
  );
}

export function metadataPath(id: string) {
  return `projects/${id}.json`;
}

export function projectUrls(id: string): ProjectUrls {
  const siteUrl = getSiteUrl();

  return {
    arUrl: `${siteUrl}/ar/project/${id}`,
    viewUrl: `${siteUrl}/view/project/${id}`,
    markerUrl: `${siteUrl}/marker/${id}`,
    dashboardUrl: `${siteUrl}/admin/project/${id}`,
    editorUrl: `${siteUrl}/editor/${id}`,
    legacyArUrl: `${siteUrl}/ar/${id}`,
    legacyViewUrl: `${siteUrl}/view/${id}`
  };
}

export function sanitizeId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const random = crypto.randomUUID().slice(0, 8);
  return `${slug || "project"}-${random}`;
}

export function createScene(input: {
  name?: string;
  modelUrl?: string;
  modelPathname?: string;
  modelSize?: number;
  placement?: Partial<PlacementMetadata> | null;
  scaleMode?: ScaleMode;
  architecturalScale?: number;
  normalizedScale?: number;
  createdAt?: string;
  updatedAt?: string;
  thumbnailUrl?: string;
}) {
  const now = new Date().toISOString();
  const scene: SceneMetadata = {
    id: sanitizeId(input.name || "scene"),
    name: input.name?.trim() || "Untitled scene",
    modelUrl: input.modelUrl || "",
    modelPathname: input.modelPathname || "",
    modelSize: finiteNumber(input.modelSize, 0),
    placement: normalizePlacement(input.placement, 1, 0),
    scaleMode: normalizeScaleMode(input.scaleMode),
    architecturalScale: positiveNumber(input.architecturalScale, 100),
    normalizedScale: positiveNumber(input.normalizedScale, 1),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };

  if (input.thumbnailUrl) {
    scene.thumbnailUrl = input.thumbnailUrl;
  }

  scene.placement.scale = computeDisplayedScale(scene);
  return scene;
}

export function createProject(input: {
  name: string;
  scene?: SceneMetadata | null;
  marker?: Partial<MarkerSettings> | null;
}) {
  const id = sanitizeId(input.name);
  const now = new Date().toISOString();
  const scenes = input.scene ? [input.scene] : [];
  const activeSceneId = scenes[0]?.id || "";

  return normalizeProjectMetadata({
    id,
    name: input.name,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    marker: normalizeMarker(input.marker || createDefaultMarker()),
    activeSceneId,
    scenes,
    createdAt: now,
    updatedAt: now
  });
}

export async function saveProject(project: ProjectMetadata) {
  assertBlobConfigured();

  const normalized = normalizeProjectMetadata({
    ...project,
    updatedAt: project.updatedAt || new Date().toISOString()
  });

  const blob = await put(metadataPath(normalized.id), JSON.stringify(normalized, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });

  return blob;
}

export async function loadProject(id: string) {
  assertBlobConfigured();

  const { blobs } = await list({
    limit: 1,
    prefix: metadataPath(id)
  });

  const blob = blobs.find((item) => item.pathname === metadataPath(id));

  if (!blob) {
    return null;
  }

  const response = await fetch(blob.url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Unable to load project metadata (${response.status}).`);
  }

  return normalizeProjectMetadata((await response.json()) as LegacyProjectShape);
}

export async function listProjects() {
  assertBlobConfigured();

  const { blobs } = await list({
    limit: 1000,
    prefix: "projects/"
  });

  const projectBlobs = blobs
    .filter((blob) => /^projects\/[^/]+\.json$/.test(blob.pathname))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

  const projects = await Promise.all(
    projectBlobs.map(async (blob) => {
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) return null;
      return normalizeProjectMetadata((await response.json()) as LegacyProjectShape);
    })
  );

  return projects.filter((project): project is ProjectMetadata => Boolean(project));
}

export async function deleteProjectAndAssets(id: string) {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === id);

  if (!project) {
    return null;
  }

  const remainingProjects = projects.filter((item) => item.id !== id);
  const assetCandidates = collectProjectAssetReferences(project);
  const deletedAssets = await deleteUnreferencedBlobReferences(assetCandidates, remainingProjects);
  const deletedProjectJson = metadataPath(id);

  await del(deletedProjectJson);

  return {
    deletedProjectId: id,
    deletedProjectJson,
    deletedAssets
  };
}

export async function deleteSceneAndAssets(projectId: string, sceneId: string) {
  const projects = await listProjects();
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    return null;
  }

  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return { project, scene: null, deletedAssets: [] };
  }

  const scenes = project.scenes.filter((item) => item.id !== sceneId);
  const activeSceneId = project.activeSceneId === sceneId ? scenes[0]?.id || "" : project.activeSceneId;
  const updatedProject = normalizeProjectMetadata({
    ...project,
    scenes,
    activeSceneId,
    updatedAt: new Date().toISOString()
  });
  const remainingProjects = projects.map((item) =>
    item.id === projectId ? updatedProject : item
  );
  const deletedAssets = await deleteUnreferencedBlobReferences(
    collectSceneAssetReferences(scene),
    remainingProjects
  );

  await saveProject(updatedProject);

  return {
    project: updatedProject,
    scene,
    deletedAssets
  };
}

export async function cleanupOldProjects() {
  const projects = await listProjects();

  if (projects.length <= 1) {
    return {
      keptProject: projects[0] || null,
      deletedProjects: [],
      deletedProjectJson: [],
      deletedAssets: []
    };
  }

  const sorted = [...projects].sort((a, b) => {
    const byUpdatedAt = dateValue(b.updatedAt) - dateValue(a.updatedAt);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return dateValue(b.createdAt) - dateValue(a.createdAt);
  });
  const keptProject = sorted[0];
  const deletedProjects = sorted.slice(1);
  const deletedProjectJson = deletedProjects.map((project) => metadataPath(project.id));
  const assetCandidates = deletedProjects.flatMap((project) => collectProjectAssetReferences(project));
  const deletedAssets = await deleteUnreferencedBlobReferences(assetCandidates, [keptProject]);

  await del(deletedProjectJson);

  return {
    keptProject,
    deletedProjects: deletedProjects.map(summarizeProject),
    deletedProjectJson,
    deletedAssets
  };
}

export function summarizeProject(project: ProjectMetadata): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    schemaVersion: project.schemaVersion,
    activeSceneId: project.activeSceneId,
    sceneCount: project.scenes.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    arUrl: project.arUrl,
    viewUrl: project.viewUrl,
    markerUrl: project.markerUrl
  };
}

function collectProjectAssetReferences(project: ProjectMetadata) {
  return [
    ...project.scenes.flatMap((scene) => collectSceneAssetReferences(scene)),
    ...collectMarkerAssetReferences(project.marker)
  ];
}

function collectSceneAssetReferences(scene: SceneMetadata) {
  return [scene.modelPathname, scene.modelUrl].filter(Boolean);
}

function collectMarkerAssetReferences(marker: MarkerSettings) {
  return [marker.imageUrl, marker.patternUrl].filter((value) => {
    if (!value) return false;
    if (value === MARKER_IMAGE_URL || value === MARKER_PATTERN_URL) return false;
    return true;
  });
}

async function deleteUnreferencedBlobReferences(
  candidates: string[],
  remainingProjects: ProjectMetadata[]
) {
  const remainingIdentities = new Set(
    remainingProjects
      .flatMap((project) => collectProjectAssetReferences(project))
      .map(blobIdentity)
      .filter((value): value is string => Boolean(value))
  );
  const deletable = Array.from(
    new Map(
      candidates
        .filter(isDeletableBlobReference)
        .map((reference) => [blobIdentity(reference), reference] as const)
        .filter(([identity]) => identity && !remainingIdentities.has(identity))
    ).values()
  );

  if (deletable.length > 0) {
    await del(deletable);
  }

  return deletable;
}

function isDeletableBlobReference(value: string) {
  const identity = blobIdentity(value);
  if (!identity) return false;
  if (value.startsWith("/") || value.startsWith("data:")) return false;
  return (
    identity.startsWith("models/") ||
    identity.startsWith("markers/") ||
    identity.startsWith("generated/") ||
    identity.startsWith("exports/")
  );
}

function blobIdentity(value: string | undefined) {
  if (!value) return "";

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return "";
    }
  }

  return value.replace(/^\/+/, "");
}

function dateValue(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function normalizeProjectMetadata(project: LegacyProjectShape): ProjectMetadata {
  const id = project.id || "project";
  const urls = projectUrls(id);
  const marker = normalizeMarker(
    project.marker || {
      styleId: "technical-grid",
      imageUrl: project.placement?.markerImage || project.markerImage || MARKER_IMAGE_URL,
      widthMm: project.placement?.markerWidthMm || project.markerWidthMm,
      heightMm: project.placement?.markerHeightMm || project.markerHeightMm
    }
  );
  const createdAt = project.createdAt || new Date().toISOString();
  const updatedAt = project.updatedAt || createdAt;
  const scenes = normalizeScenes(project, createdAt, updatedAt);
  const activeSceneId =
    scenes.find((scene) => scene.id === project.activeSceneId)?.id || scenes[0]?.id || "";
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) || scenes[0] || null;
  const fallbackPlacement = createDefaultPlacement(1, 0);
  const placement = activeScene?.placement || fallbackPlacement;

  return {
    id,
    name: project.name || "Untitled project",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    marker,
    activeSceneId,
    scenes,
    createdAt,
    updatedAt,
    urls,
    arUrl: urls.arUrl,
    viewUrl: urls.viewUrl,
    markerUrl: urls.markerUrl,
    editorUrl: urls.editorUrl,
    scale: placement.scale,
    verticalOffset: placement.position.y,
    modelUrl: activeScene?.modelUrl || "",
    modelPathname: activeScene?.modelPathname || "",
    modelSize: activeScene?.modelSize || 0,
    placement
  } satisfies ProjectMetadata;
}

export function getActiveScene(project: ProjectMetadata) {
  return (
    project.scenes.find((scene) => scene.id === project.activeSceneId) ||
    project.scenes[0] ||
    null
  );
}

export function updateProjectScene(
  project: ProjectMetadata,
  sceneId: string,
  updater: (scene: SceneMetadata) => SceneMetadata
) {
  const now = new Date().toISOString();
  const scenes = project.scenes.map((scene) =>
    scene.id === sceneId ? { ...updater(scene), updatedAt: now } : scene
  );

  return normalizeProjectMetadata({
    ...project,
    scenes,
    updatedAt: now
  });
}

export function computeDisplayedScale(scene: Pick<
  SceneMetadata,
  "scaleMode" | "architecturalScale" | "normalizedScale"
>) {
  if (scene.scaleMode === "architectural") {
    return 1 / positiveNumber(scene.architecturalScale, 100);
  }

  return positiveNumber(scene.normalizedScale, 1);
}

function normalizeScenes(project: LegacyProjectShape, createdAt: string, updatedAt: string) {
  if (Array.isArray(project.scenes) && project.scenes.length > 0) {
    return project.scenes.map((scene, index) =>
      normalizeScene(scene, createdAt, updatedAt, index)
    );
  }

  if (project.modelUrl || project.modelPathname) {
    return [
      normalizeScene(
        {
          id: `${project.id || "project"}-scene`,
          name: project.name || "Uploaded model",
          modelUrl: project.modelUrl,
          modelPathname: project.modelPathname,
          modelSize: project.modelSize,
          placement: project.placement,
          normalizedScale: project.scale,
          createdAt,
          updatedAt
        },
        createdAt,
        updatedAt,
        0
      )
    ];
  }

  return [];
}

function normalizeScene(
  scene: Partial<SceneMetadata>,
  fallbackCreatedAt: string,
  fallbackUpdatedAt: string,
  index: number
) {
  const normalized: SceneMetadata = {
    id: scene.id || `scene-${index + 1}`,
    name: scene.name || `Scene ${index + 1}`,
    modelUrl: scene.modelUrl || "",
    modelPathname: scene.modelPathname || "",
    modelSize: finiteNumber(scene.modelSize, 0),
    placement: normalizePlacement(scene.placement, scene.normalizedScale || 1, 0),
    scaleMode: normalizeScaleMode(scene.scaleMode),
    architecturalScale: positiveNumber(scene.architecturalScale, 100),
    normalizedScale: positiveNumber(scene.normalizedScale, scene.placement?.scale || 1),
    createdAt: scene.createdAt || fallbackCreatedAt,
    updatedAt: scene.updatedAt || fallbackUpdatedAt
  };

  if (scene.thumbnailUrl) {
    normalized.thumbnailUrl = scene.thumbnailUrl;
  }

  normalized.placement.scale = positiveNumber(
    scene.placement?.scale,
    computeDisplayedScale(normalized)
  );

  return normalized;
}

function normalizeScaleMode(value: unknown): ScaleMode {
  return value === "architectural" ? "architectural" : "fit";
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
