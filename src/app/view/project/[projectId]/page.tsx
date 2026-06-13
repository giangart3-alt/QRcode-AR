import { ViewerClient } from "../../[id]/ViewerClient";

export default async function ProjectViewerPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ViewerClient id={projectId} />;
}
