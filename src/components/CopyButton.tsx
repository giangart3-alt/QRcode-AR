"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy",
  compact = false
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={compact ? "button-compact" : "focus-ring rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:bg-[var(--soft)]"}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
