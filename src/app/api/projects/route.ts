import { NextResponse } from "next/server";
import { createDefaultPlacement } from "@/lib/placement";
import {
  BlobConfigurationError,
  projectUrls,
  ProjectMetadata,
  sanitizeId,
  saveProject
} from "@/lib/projects";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      password?: string;
      name?: string;
      scale?: number;
      verticalOffset?: number;
      modelUrl?: string;
      modelPathname?: string;
      modelSize?: number;
    };

    if (!process.env.ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: "ADMIN_PASSWORD is not configured in Vercel." },
        { status: 500 }
      );
    }

    if (body.password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: "Incorrect admin password." },
        { status: 401 }
      );
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    if (!body.modelUrl || !body.modelPathname) {
      return NextResponse.json(
        { error: "Upload a GLB file before creating a project." },
        { status: 400 }
      );
    }

    if (!body.modelPathname.toLowerCase().endsWith(".glb")) {
      return NextResponse.json({ error: "Only .glb files are allowed." }, { status: 400 });
    }

    const id = sanitizeId(body.name);
    const urls = projectUrls(id);
    const scale = Number.isFinite(body.scale) ? Number(body.scale) : 1;
    const verticalOffset = Number.isFinite(body.verticalOffset)
      ? Number(body.verticalOffset)
      : 0;
    const project: ProjectMetadata = {
      id,
      name: body.name.trim(),
      scale,
      verticalOffset,
      modelUrl: body.modelUrl,
      modelPathname: body.modelPathname,
      modelSize: Number(body.modelSize || 0),
      createdAt: new Date().toISOString(),
      arUrl: urls.arUrl,
      viewUrl: urls.viewUrl,
      editorUrl: urls.editorUrl,
      placement: createDefaultPlacement(scale, verticalOffset)
    };

    await saveProject(project);

    return NextResponse.json({ project });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to create project metadata.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
