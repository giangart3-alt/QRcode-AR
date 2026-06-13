import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import { createDefaultPlacement } from "@/lib/placement";
import {
  BlobConfigurationError,
  createProject,
  createScene,
  listProjects,
  saveProject,
  summarizeProject
} from "@/lib/projects";

export async function GET(request: Request) {
  try {
    const auth = validateAdminPassword(readAdminPassword(request));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const projects = await listProjects();
    return NextResponse.json({ projects: projects.map(summarizeProject) });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to list projects.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

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
      scaleMode?: "fit" | "architectural";
      architecturalScale?: number;
      normalizedScale?: number;
    };

    const auth = validateAdminPassword(readAdminPassword(request, body.password));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }

    const hasModel = Boolean(body.modelUrl || body.modelPathname);
    if (hasModel && (!body.modelUrl || !body.modelPathname)) {
      return NextResponse.json(
        { error: "Both modelUrl and modelPathname are required for a scene." },
        { status: 400 }
      );
    }

    if (body.modelPathname && !body.modelPathname.toLowerCase().endsWith(".glb")) {
      return NextResponse.json({ error: "Only .glb files are allowed." }, { status: 400 });
    }

    const normalizedScale = Number.isFinite(body.normalizedScale)
      ? Number(body.normalizedScale)
      : Number.isFinite(body.scale)
        ? Number(body.scale)
        : 1;
    const verticalOffset = Number.isFinite(body.verticalOffset)
      ? Number(body.verticalOffset)
      : 0;
    const scene = hasModel
      ? createScene({
          name: body.name,
          modelUrl: body.modelUrl,
          modelPathname: body.modelPathname,
          modelSize: body.modelSize,
          placement: createDefaultPlacement(normalizedScale, verticalOffset),
          scaleMode: body.scaleMode,
          architecturalScale: body.architecturalScale,
          normalizedScale
        })
      : null;
    const project = createProject({
      name: body.name.trim(),
      scene
    });

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
