import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/projects";

export async function GET() {
  return NextResponse.json({
    hasAdminPassword: Boolean(process.env.ADMIN_PASSWORD),
    hasBlobReadWriteToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    hasBlobStoreId: Boolean(process.env.BLOB_STORE_ID),
    siteUrl: getSiteUrl()
  });
}
