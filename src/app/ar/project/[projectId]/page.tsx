import { ARClient } from "../../[id]/ARClient";

export default async function ProjectARPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ARClient id={projectId} />;
}
