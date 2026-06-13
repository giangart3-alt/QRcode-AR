import { ProjectWorkspaceClient } from "./ProjectWorkspaceClient";

export default async function AdminProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectWorkspaceClient projectId={projectId} />;
}
