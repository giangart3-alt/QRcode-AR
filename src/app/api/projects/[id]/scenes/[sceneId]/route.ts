import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import { BlobConfigurationError, deleteSceneAndAssets } from "@/lib/projects";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  try {
    const { id, sceneId } = await params;
    const body = await readOptionalJson<{ password?: string }>(request);
    const auth = validateAdminPassword(readAdminPassword(request, body?.password));

    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await deleteSceneAndAssets(id, sceneId);

    if (!result) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    if (!result.scene) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to delete scene.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function readOptionalJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
