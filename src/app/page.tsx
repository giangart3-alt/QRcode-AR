import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-10 text-[var(--foreground)]">
      <section className="mx-auto max-w-3xl text-center">
        <h1 className="text-5xl font-black leading-[1.02] text-[var(--ink)] md:text-7xl">
          QRcode AR
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
          A focused editor for persistent GLB scenes, project QR codes, and AR marker exports.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            className="focus-ring rounded-lg bg-[var(--accent)] px-5 py-4 font-semibold text-white transition hover:bg-[var(--accent-dark)]"
            href="/admin"
          >
            Open editor
          </Link>
        </div>
      </section>
    </main>
  );
}
