import { NextResponse } from "next/server";
import { readAdminPassword, validateAdminPassword } from "@/lib/admin-auth";
import { BlobConfigurationError, cleanupOldProjects } from "@/lib/projects";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      password?: string;
      confirm?: boolean;
    };
    const auth = validateAdminPassword(readAdminPassword(request, body.password));

    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!body.confirm) {
      return NextResponse.json(
        { error: "Cleanup requires explicit confirmation." },
        { status: 400 }
      );
    }

    const result = await cleanupOldProjects();
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to clean test projects.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
