import { NextResponse } from "next/server";
import { normalizePlacement } from "@/lib/placement";
import { BlobConfigurationError, loadProject, saveProject } from "@/lib/projects";

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

    if (!process.env.ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: "ADMIN_PASSWORD is not configured in Vercel." },
        { status: 500 }
      );
    }

    if (body.password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Incorrect admin password." }, { status: 401 });
    }

    const project = await loadProject(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const placement = normalizePlacement(
      body.placement as Parameters<typeof normalizePlacement>[0],
      project.scale,
      project.verticalOffset
    );
    const updatedProject = {
      ...project,
      scale: placement.scale,
      verticalOffset: placement.position.y,
      placement
    };

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
