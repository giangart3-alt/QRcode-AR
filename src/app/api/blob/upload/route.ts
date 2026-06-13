import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { assertBlobConfigured, BlobConfigurationError } from "@/lib/projects";

const MAX_GLB_SIZE = 500 * 1024 * 1024;

function errorStatus(error: unknown) {
  if (error instanceof BlobConfigurationError) return 500;
  if (!(error instanceof Error)) return 400;

  if (error.message.includes("ADMIN_PASSWORD")) return 500;
  if (error.message.includes("Incorrect admin password")) return 401;
  if (error.message.includes("maximum allowed size")) return 413;

  return 400;
}

export async function POST(request: Request) {
  let body: HandleUploadBody;

  try {
    assertBlobConfigured();
    body = (await request.json()) as HandleUploadBody;

    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload || "{}") as {
          password?: string;
        };

        if (!process.env.ADMIN_PASSWORD) {
          throw new Error("ADMIN_PASSWORD is not configured in Vercel.");
        }

        if (payload.password !== process.env.ADMIN_PASSWORD) {
          throw new Error("Incorrect admin password.");
        }

        if (!pathname.toLowerCase().endsWith(".glb")) {
          throw new Error("Only .glb files are allowed.");
        }

        return {
          maximumSizeInBytes: MAX_GLB_SIZE,
          tokenPayload: "{}"
        };
      },
      onUploadCompleted: async () => undefined
    });

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof BlobConfigurationError || error instanceof Error
        ? error.message
        : "Unable to upload this GLB file.";

    return NextResponse.json({ error: message }, { status: errorStatus(error) });
  }
}
