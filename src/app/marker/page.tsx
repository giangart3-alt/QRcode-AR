import Link from "next/link";
import Image from "next/image";
import { PrintButton } from "./PrintButton";
import {
  DEFAULT_MARKER_HEIGHT_MM,
  DEFAULT_MARKER_WIDTH_MM,
  MARKER_IMAGE_URL
} from "@/lib/placement";

export default function MarkerPage() {
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
          <Image
            src={MARKER_IMAGE_URL}
            alt="Official QRcode AR calibration playground marker"
            width={1499}
            height={1049}
            priority
            className="h-auto w-full rounded-lg border border-neutral-300 print:rounded-none"
          />
        </div>

        <aside className="no-print rounded-xl border border-neutral-200 bg-neutral-50 p-5">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-500">Official marker</p>
          <h1 className="mt-3 text-4xl font-black">Calibration playground</h1>
          <div className="mt-5 space-y-4 text-base leading-7 text-neutral-700">
            <p>
              Print or display this exact image. It is the same reference used by the
              placement editor and phone AR page.
            </p>
            <p>
              Default physical size: <strong>{DEFAULT_MARKER_WIDTH_MM}mm x {DEFAULT_MARKER_HEIGHT_MM}mm</strong>.
              If a project is saved with a different marker size, print or display at that
              saved size.
            </p>
            <p>
              Keep the full outer black frame visible, flat, well lit, and free of glare.
              A full-screen monitor or TV works for quick placement tests.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
