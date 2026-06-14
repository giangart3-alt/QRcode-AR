import { ProjectViewerClient } from "./ProjectViewerClient";

export default async function ProjectViewerPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectViewerClient projectId={projectId} />;
}
