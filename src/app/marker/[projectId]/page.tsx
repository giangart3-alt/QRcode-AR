import Link from "next/link";
import QRCode from "qrcode";
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
  let arUrl = `https://q-rcode-ar.vercel.app/ar/project/${projectId}`;

  try {
    const project = await loadProject(projectId);
    if (project) {
      projectName = project.name;
      marker = project.marker;
      arUrl = project.arUrl;
    } else {
      error = "Project not found. Showing the default marker board.";
    }
  } catch (caught) {
    error =
      caught instanceof BlobConfigurationError || caught instanceof Error
        ? caught.message
      : "Unable to load project marker settings.";
  }
  const qrDataUrl = await QRCode.toDataURL(arUrl, { margin: 1, width: 260 });

  return (
    <main className="min-h-screen bg-[var(--panel)] px-5 py-6 text-[var(--ink)]">
      <div className="no-print mx-auto mb-8 flex max-w-6xl items-center justify-between border-b border-[var(--line)] pb-5">
        <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[var(--soft)]" href="/">
          Home
        </Link>
        <PrintButton />
      </div>

      <section className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 shadow-sm print:border-0 print:p-0 print:shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={marker.imageUrl}
            alt={`${projectName} marker playground`}
            className="h-auto w-full rounded-lg border border-[var(--line)] print:rounded-none"
          />
        </div>

        <aside className="no-print rounded-xl border border-[var(--line)] bg-[var(--background)] p-5">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Project marker</p>
          <h1 className="mt-3 text-4xl font-black">{projectName}</h1>
          <div className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={`QR code for ${projectName} AR project`} className="mx-auto w-52" />
          </div>
          <div className="mt-5 space-y-4 text-base leading-7 text-[var(--muted)]">
            <p>
              This marker page uses the project marker settings saved in Vercel Blob.
            </p>
            <p>
              Physical size: <strong>{marker.widthMm}mm x {marker.heightMm}mm</strong>.
              Print at <strong>100% scale</strong> with no browser fit-to-page resizing.
            </p>
            <p>
              Style: <strong>{marker.styleId}</strong>. Origin is the marker center;
              X is left/right, Z is forward/back, and Y is vertical height.
            </p>
            <div>
              <p className="font-bold text-[var(--ink)]">Export presets planned</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm font-semibold">
                {["A4", "A3", "A2", "A1", "A0", "2A0", "4A0", "Custom mm", "16:9", "16:10", "Full HD", "4K", "8K", "Custom px"].map((item) => (
                  <span key={item} className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            {error ? (
              <p className="rounded-lg border border-[var(--accent)] bg-[var(--soft)] p-3 font-semibold text-[var(--ink)]">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
