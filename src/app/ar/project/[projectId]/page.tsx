import { ARClient } from "../../[id]/ARClient";

export default async function ProjectARPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ debug?: string }>;
}) {
  const { projectId } = await params;
  const { debug } = await searchParams;
  return <ARClient id={projectId} debug={debug === "1"} />;
}
