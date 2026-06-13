import { list, put } from "@vercel/blob";
import {
  createDefaultPlacement,
  normalizePlacement,
  type PlacementMetadata
} from "@/lib/placement";

export type ProjectMetadata = {
  id: string;
  name: string;
  scale: number;
  verticalOffset: number;
  modelUrl: string;
  modelPathname: string;
  modelSize: number;
  createdAt: string;
  arUrl: string;
  viewUrl: string;
  editorUrl: string;
  placement: PlacementMetadata;
};

export class BlobConfigurationError extends Error {
  constructor() {
    super(
      "Vercel Blob is not configured. Add BLOB_READ_WRITE_TOKEN to this Vercel project, or connect the existing q-rcode-ar-blob store so Vercel injects it."
    );
    this.name = "BlobConfigurationError";
  }
}

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

export function projectUrls(id: string) {
  const siteUrl = getSiteUrl();

  return {
    arUrl: `${siteUrl}/ar/${id}`,
    viewUrl: `${siteUrl}/view/${id}`,
    editorUrl: `${siteUrl}/editor/${id}`
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
  return `${slug || "model"}-${random}`;
}

export async function saveProject(project: ProjectMetadata) {
  assertBlobConfigured();

  const blob = await put(metadataPath(project.id), JSON.stringify(project, null, 2), {
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

  return normalizeProjectMetadata((await response.json()) as Partial<ProjectMetadata>);
}

export function normalizeProjectMetadata(project: Partial<ProjectMetadata>) {
  const id = project.id || "model";
  const urls = projectUrls(id);
  const scale = typeof project.scale === "number" && Number.isFinite(project.scale)
    ? project.scale
    : 1;
  const verticalOffset =
    typeof project.verticalOffset === "number" && Number.isFinite(project.verticalOffset)
      ? project.verticalOffset
      : 0;

  return {
    id,
    name: project.name || "Untitled model",
    scale,
    verticalOffset,
    modelUrl: project.modelUrl || "",
    modelPathname: project.modelPathname || "",
    modelSize:
      typeof project.modelSize === "number" && Number.isFinite(project.modelSize)
        ? project.modelSize
        : 0,
    createdAt: project.createdAt || new Date().toISOString(),
    arUrl: project.arUrl || urls.arUrl,
    viewUrl: project.viewUrl || urls.viewUrl,
    editorUrl: project.editorUrl || urls.editorUrl,
    placement: normalizePlacement(
      project.placement || createDefaultPlacement(scale, verticalOffset),
      scale,
      verticalOffset
    )
  } satisfies ProjectMetadata;
}
