"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="focus-ring rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--panel)]"
    >
      Print
    </button>
  );
}
