import Link from "next/link";
import { PrintButton } from "../PrintButton";
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
    <main className="min-h-screen bg-white px-5 py-6 text-black">
      <div className="no-print mx-auto mb-8 flex max-w-6xl items-center justify-between border-b border-neutral-200 pb-5">
        <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold hover:bg-neutral-100" href="/">
          Home
        </Link>
        <PrintButton />
      </div>

      <section className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm print:border-0 print:p-0 print:shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={marker.imageUrl}
            alt={`${projectName} marker playground`}
            className="h-auto w-full rounded-lg border border-neutral-300 print:rounded-none"
          />
        </div>

        <aside className="no-print rounded-xl border border-neutral-200 bg-neutral-50 p-5">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-500">Project marker</p>
          <h1 className="mt-3 text-4xl font-black">{projectName}</h1>
          <div className="mt-5 space-y-4 text-base leading-7 text-neutral-700">
            <p>
              This marker page uses the project marker settings saved in Vercel Blob.
            </p>
            <p>
              Physical size: <strong>{marker.widthMm}mm x {marker.heightMm}mm</strong>.
            </p>
            <p>
              Style: <strong>{marker.styleId}</strong>. Origin is the marker center;
              X is left/right, Z is forward/back, and Y is vertical height.
            </p>
            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-900">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
