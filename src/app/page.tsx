import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col">
        <nav className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <strong className="text-lg tracking-tight text-[var(--ink)]">QRcode AR</strong>
          <div className="flex gap-2">
            <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)]" href="/marker">
              Marker
            </Link>
            <Link
              className="focus-ring rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white transition hover:bg-black"
              href="/admin"
            >
              Admin
            </Link>
          </div>
        </nav>

        <div className="grid flex-1 content-center gap-8 py-12 md:grid-cols-[1.08fr_0.92fr] md:items-center md:py-16">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
              GLB to phone AR
            </p>
            <h1 className="max-w-3xl text-5xl font-black leading-[1.02] text-[var(--ink)] md:text-7xl">
              Upload a model. Print a marker. Share a QR code.
            </h1>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="focus-ring rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white transition hover:bg-[var(--accent-dark)]"
                href="/admin"
              >
                Open admin
              </Link>
              <Link
                className="focus-ring rounded-lg border border-[var(--line)] bg-white px-4 py-3 font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:bg-[var(--soft)]"
                href="/marker"
              >
                Print marker
              </Link>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-sm">
            <div className="mb-5 grid grid-cols-[1fr_88px] gap-4">
              <div className="rounded-lg border border-[var(--line)] bg-[var(--soft)] p-4">
                <div className="h-28 rounded-md border border-[var(--line)] bg-white" />
                <div className="mt-3 h-2 w-2/3 rounded-full bg-[var(--line)]" />
                <div className="mt-2 h-2 w-1/2 rounded-full bg-[var(--line)]" />
              </div>
              <div className="grid aspect-square place-items-center rounded-lg border border-[var(--line)] bg-white p-2">
                <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-1">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <span
                      key={index}
                      className={index % 2 === 0 ? "rounded-sm bg-[var(--ink)]" : "rounded-sm bg-[var(--soft)]"}
                    />
                  ))}
                </div>
              </div>
            </div>
            <p className="text-lg leading-8 text-[var(--muted)]">
              This MVP uploads GLB files directly to Vercel Blob, stores public project metadata,
              generates an AR QR link, and includes a model-viewer fallback for devices where
              browser marker tracking is limited.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
