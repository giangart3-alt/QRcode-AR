import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as {
    password?: string;
  };

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_PASSWORD is not configured in Vercel." },
      { status: 500 }
    );
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: "Incorrect admin password." },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}
