import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import {
  BlobConfigurationError,
  createScene,
  loadProject,
  normalizeProjectMetadata,
  saveProject
} from "@/lib/projects";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      password?: string;
      name?: string;
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

    if (!body.modelUrl || !body.modelPathname) {
      return NextResponse.json(
        { error: "A GLB modelUrl and modelPathname are required to add a scene." },
        { status: 400 }
      );
    }

    if (body.modelPathname && !body.modelPathname.toLowerCase().endsWith(".glb")) {
      return NextResponse.json({ error: "Only .glb files are allowed." }, { status: 400 });
    }

    const project = await loadProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const scene = createScene({
      name: body.name || `Scene ${project.scenes.length + 1}`,
      modelUrl: body.modelUrl,
      modelPathname: body.modelPathname,
      modelSize: body.modelSize,
      scaleMode: body.scaleMode,
      architecturalScale: body.architecturalScale,
      normalizedScale: body.normalizedScale
    });
    const updatedProject = normalizeProjectMetadata({
      ...project,
      scenes: [...project.scenes, scene],
      activeSceneId: project.activeSceneId || scene.id,
      updatedAt: new Date().toISOString()
    });

    await saveProject(updatedProject);

    return NextResponse.json({ project: updatedProject, scene });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to add scene.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
