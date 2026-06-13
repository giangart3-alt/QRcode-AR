import { EditorClient } from "./EditorClient";

export default async function EditorPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorClient id={id} />;
}
