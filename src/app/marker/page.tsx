import Link from "next/link";
import { PrintButton } from "./PrintButton";
import {
  DEFAULT_MARKER_HEIGHT_MM,
  DEFAULT_MARKER_WIDTH_MM,
  createDefaultMarker,
  getMarkerBoardImageUrl
} from "@/lib/placement";

export default function MarkerPage() {
  const marker = createDefaultMarker();
  const boardImageUrl = getMarkerBoardImageUrl(marker);

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
            src={boardImageUrl}
            alt="Official HIRO marker"
            className="h-auto w-full rounded-lg border border-[var(--line)] print:rounded-none"
          />
        </div>

        <aside className="no-print rounded-xl border border-[var(--line)] bg-[var(--background)] p-5">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Official marker</p>
          <h1 className="mt-3 text-4xl font-black">HIRO marker</h1>
          <div className="mt-5 space-y-4 text-base leading-7 text-[var(--muted)]">
            <p>
              Print or display this marker large and flat. The phone AR page tracks
              this HIRO marker for the current baseline.
            </p>
            <p>
              Default physical size: <strong>{DEFAULT_MARKER_WIDTH_MM}mm x {DEFAULT_MARKER_HEIGHT_MM}mm</strong>.
              Use this same square marker for desktop placement, export, and mobile AR.
            </p>
            <p>
              Keep the full outer black frame visible, flat, well lit, and free of glare.
              A full-screen monitor or TV works for quick placement tests.
            </p>
            <p>
              Tracking target: <strong>{marker.trackingMarkerId}</strong>,{" "}
              <strong>{marker.trackingMarkerSizeOnBoardMm}mm</strong> square.
            </p>
          </div>
          <Link className="button-secondary mt-5" href="/ar/test">
            Open AR test
          </Link>
        </aside>
      </section>
    </main>
  );
}
