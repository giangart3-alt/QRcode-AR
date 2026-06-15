import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import {
  BlobConfigurationError,
  normalizeProjectMetadata,
  saveProject
} from "@/lib/projects";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      password?: string;
      project?: unknown;
    };

    const auth = validateAdminPassword(readAdminPassword(request, body.password));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!body.project || typeof body.project !== "object") {
      return NextResponse.json({ error: "Project JSON is required." }, { status: 400 });
    }

    const project = normalizeProjectMetadata(body.project as Record<string, unknown>);
    await saveProject(project);

    return NextResponse.json({ project });
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to import project.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
