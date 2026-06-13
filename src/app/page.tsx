import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col justify-between">
        <nav className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <strong className="text-lg">QRcode AR</strong>
          <div className="flex gap-2">
            <Link className="focus-ring rounded-md px-3 py-2 text-sm font-semibold hover:bg-white" href="/marker">
              Marker
            </Link>
            <Link
              className="focus-ring rounded-md bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white hover:bg-black"
              href="/admin"
            >
              Admin
            </Link>
          </div>
        </nav>

        <div className="grid gap-10 py-16 md:grid-cols-[1.1fr_0.9fr] md:items-end">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
              GLB to phone AR
            </p>
            <h1 className="max-w-3xl text-5xl font-black leading-[0.98] text-[var(--ink)] md:text-7xl">
              Upload a model. Print a marker. Share a QR code.
            </h1>
          </div>
          <div className="border-l-4 border-[var(--accent)] bg-[var(--panel)] p-6 shadow-sm">
            <p className="text-lg leading-8 text-[var(--muted)]">
              This MVP uploads GLB files directly to Vercel Blob, stores public project metadata,
              generates an AR QR link, and includes a model-viewer fallback for devices where
              browser marker tracking is limited.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                className="focus-ring rounded-md bg-[var(--accent)] px-4 py-3 font-semibold text-white hover:bg-[var(--accent-dark)]"
                href="/admin"
              >
                Open admin
              </Link>
              <Link
                className="focus-ring rounded-md border border-[var(--line)] bg-white px-4 py-3 font-semibold hover:border-[var(--accent)]"
                href="/marker"
              >
                Print marker
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
