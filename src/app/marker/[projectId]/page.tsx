import QRCode from "qrcode";
import { MarkerExportClient } from "./MarkerExportClient";
import { createDefaultMarker } from "@/lib/placement";
import { BlobConfigurationError, loadProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectMarkerPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  let error = "";
  let projectName = projectId;
  let marker = createDefaultMarker();
  let arUrl = `https://q-rcode-ar.vercel.app/ar/project/${projectId}`;

  try {
    const project = await loadProject(projectId);
    if (project) {
      projectName = project.name;
      marker = project.marker;
      arUrl = project.arUrl;
    } else {
      error = "Project not found. Showing the default marker board.";
    }
  } catch (caught) {
    error =
      caught instanceof BlobConfigurationError || caught instanceof Error
        ? caught.message
      : "Unable to load project marker settings.";
  }
  const qrDataUrl = await QRCode.toDataURL(arUrl, { margin: 1, width: 260 });

  return (
    <MarkerExportClient
      projectName={projectName}
      marker={marker}
      arUrl={arUrl}
      qrDataUrl={qrDataUrl}
      error={error}
    />
  );
}
