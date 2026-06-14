"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export function AdminLoginClient() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Enter the admin password to continue.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const storedPassword = window.sessionStorage.getItem("adminPassword") || "";

    if (!storedPassword) return;

    async function validateStoredPassword() {
      setBusy(true);
      setStatus("Checking saved session...");

      try {
        const ok = await checkPassword(storedPassword);
        if (cancelled) return;

        if (ok) {
          router.replace("/admin/dashboard");
          return;
        }

        window.sessionStorage.removeItem("adminPassword");
        setStatus("Saved session expired. Enter the admin password again.");
      } catch (caught) {
        if (cancelled) return;
        setStatus("Enter the admin password to continue.");
        setError(caught instanceof Error ? caught.message : "Unable to check saved session.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void validateStoredPassword();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStatus("Checking password...");

    try {
      const ok = await checkPassword(password);

      if (!ok) {
        throw new Error("Incorrect admin password.");
      }

      window.sessionStorage.setItem("adminPassword", password);
      router.replace("/admin/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to unlock admin.");
      setStatus("Enter the admin password to continue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-5 py-6 text-[var(--foreground)]">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col">
        <nav className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <Link className="focus-ring rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]" href="/">
            Home
          </Link>
          <Link className="button-secondary" href="/marker">
            Marker
          </Link>
        </nav>

        <div className="grid flex-1 place-items-center py-10">
          <form onSubmit={unlock} className="w-full max-w-md rounded-xl border border-[var(--line)] bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
              Admin
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--ink)]">
              Project dashboard
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{status}</p>

            <label className="mt-6 block text-sm font-semibold text-[var(--ink)]" htmlFor="admin-password">
              Admin password
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="focus-ring mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] shadow-inner"
                autoComplete="current-password"
              />
            </label>

            <button
              type="submit"
              disabled={busy || !password}
              className="focus-ring mt-5 w-full rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Checking..." : "Open dashboard"}
            </button>

            {error ? (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
                {error}
              </p>
            ) : null}
          </form>
        </div>
      </section>
    </main>
  );
}

async function checkPassword(password: string) {
  const response = await fetch("/api/admin/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const result = (await response.json()) as { ok?: boolean; error?: string };

  if (!response.ok) {
    throw new Error(result.error || "Unable to check admin password.");
  }

  return Boolean(result.ok);
}
