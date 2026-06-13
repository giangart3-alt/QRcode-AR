"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="focus-ring rounded-md bg-black px-4 py-2 text-sm font-semibold text-white"
    >
      Print
    </button>
  );
}
