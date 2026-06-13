import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import { normalizeMarker, normalizePlacement } from "@/lib/placement";
import {
  BlobConfigurationError,
  computeDisplayedScale,
  getActiveScene,
  loadProject,
  normalizeProjectMetadata,
  saveProject,
  type ScaleMode,
  type SceneMetadata
} from "@/lib/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await loadProject(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to load project.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      password?: string;
      name?: string;
      marker?: unknown;
      scenes?: SceneMetadata[];
      activeSceneId?: string;
    };

    const auth = validateAdminPassword(readAdminPassword(request, body.password));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const project = await loadProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const updatedProject = normalizeProjectMetadata({
      ...project,
      name: body.name?.trim() || project.name,
      marker: body.marker ? normalizeMarker(body.marker) : project.marker,
      scenes: Array.isArray(body.scenes)
        ? body.scenes.map((scene) => normalizeSceneForSave(scene))
        : project.scenes,
      activeSceneId: body.activeSceneId || project.activeSceneId,
      updatedAt: new Date().toISOString()
    });

    await saveProject(updatedProject);

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to save project.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      password?: string;
      placement?: unknown;
    };

    const auth = validateAdminPassword(readAdminPassword(request, body.password));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const project = await loadProject(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const activeScene = getActiveScene(project);

    if (!activeScene) {
      return NextResponse.json(
        { error: "Add a scene before saving placement." },
        { status: 400 }
      );
    }

    const placement = normalizePlacement(
      body.placement as Parameters<typeof normalizePlacement>[0],
      activeScene.normalizedScale,
      activeScene.placement.position.y
    );
    const updatedScenes = project.scenes.map((scene) =>
      scene.id === activeScene.id
        ? {
            ...scene,
            placement,
            normalizedScale: scene.scaleMode === "fit" ? placement.scale : scene.normalizedScale,
            updatedAt: new Date().toISOString()
          }
        : scene
    );
    const updatedProject = normalizeProjectMetadata({
      ...project,
      scenes: updatedScenes,
      updatedAt: new Date().toISOString()
    });

    await saveProject(updatedProject);

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to save placement.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function normalizeSceneForSave(scene: SceneMetadata) {
  const scaleMode: ScaleMode = scene.scaleMode === "architectural" ? "architectural" : "fit";
  const architecturalScale =
    typeof scene.architecturalScale === "number" && scene.architecturalScale > 0
      ? scene.architecturalScale
      : 100;
  const normalizedScale =
    typeof scene.normalizedScale === "number" && scene.normalizedScale > 0
      ? scene.normalizedScale
      : 1;
  const nextScene = {
    ...scene,
    scaleMode,
    architecturalScale,
    normalizedScale,
    placement: normalizePlacement(scene.placement, normalizedScale, 0)
  };

  nextScene.placement.scale = computeDisplayedScale(nextScene);
  return nextScene;
}
