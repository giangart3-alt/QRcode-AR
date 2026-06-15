import { redirect } from "next/navigation";

export default async function EditorPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/project/${id}`);
}
