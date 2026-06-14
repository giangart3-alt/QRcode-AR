import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl flex-col">
        <nav className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <strong className="text-lg tracking-tight text-[var(--ink)]">QRcode AR</strong>
          <Link
            className="focus-ring rounded-lg bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black"
            href="/admin"
          >
            Admin
          </Link>
        </nav>

        <div className="grid flex-1 place-items-center py-12 text-center md:py-16">
          <div>
            <h1 className="max-w-3xl text-5xl font-black leading-[1.02] text-[var(--ink)] md:text-7xl">
              QRcode AR
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              A simple workspace for persistent GLB scenes, project QR codes, and printable AR markers.
            </p>
            <div className="mt-8 flex justify-center">
              <Link
                className="focus-ring rounded-lg bg-[var(--accent)] px-5 py-4 font-semibold text-white transition hover:bg-[var(--accent-dark)]"
                href="/admin"
              >
                Admin
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
