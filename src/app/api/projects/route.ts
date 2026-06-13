import { NextResponse } from "next/server";
import {
  BlobConfigurationError,
  getSiteUrl,
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

    const siteUrl = getSiteUrl();
    const id = sanitizeId(body.name);
    const project: ProjectMetadata = {
      id,
      name: body.name.trim(),
      scale: Number.isFinite(body.scale) ? Number(body.scale) : 1,
      verticalOffset: Number.isFinite(body.verticalOffset)
        ? Number(body.verticalOffset)
        : 0,
      modelUrl: body.modelUrl,
      modelPathname: body.modelPathname,
      modelSize: Number(body.modelSize || 0),
      createdAt: new Date().toISOString(),
      arUrl: `${siteUrl}/ar/${id}`,
      viewUrl: `${siteUrl}/view/${id}`
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
