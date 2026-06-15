import { ARClient } from "./ARClient";

export default async function ARPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ debug?: string }>;
}) {
  const { id } = await params;
  const { debug } = await searchParams;
  return <ARClient id={id} debug={debug === "1"} />;
}
