import { ARClient } from "./ARClient";

export default async function ARPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ARClient id={id} />;
}
