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

  try {
    const project = await loadProject(projectId);
    if (project) {
      projectName = project.name;
      marker = project.marker;
    } else {
      error = "Project not found. Showing the default marker board.";
    }
  } catch (caught) {
    error =
      caught instanceof BlobConfigurationError || caught instanceof Error
        ? caught.message
      : "Unable to load project marker settings.";
  }

  return (
    <MarkerExportClient
      projectName={projectName}
      marker={marker}
      error={error}
    />
  );
}
