import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import {
  BlobConfigurationError,
  loadProject,
  normalizeProjectMetadata,
  saveProject
} from "@/lib/projects";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      password?: string;
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

    if (!body.activeSceneId) {
      return NextResponse.json({ error: "activeSceneId is required." }, { status: 400 });
    }

    if (!project.scenes.some((scene) => scene.id === body.activeSceneId)) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    const updatedProject = normalizeProjectMetadata({
      ...project,
      activeSceneId: body.activeSceneId,
      updatedAt: new Date().toISOString()
    });

    await saveProject(updatedProject);

    return NextResponse.json({ project: updatedProject });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to set active scene.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
