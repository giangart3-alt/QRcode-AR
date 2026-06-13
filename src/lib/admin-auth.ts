export function readAdminPassword(request: Request, bodyPassword?: string) {
  return (
    bodyPassword ||
    request.headers.get("x-admin-password") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

export function validateAdminPassword(password: string) {
  if (!process.env.ADMIN_PASSWORD) {
    return {
      ok: false,
      status: 500,
      error: "ADMIN_PASSWORD is not configured in Vercel."
    };
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return {
      ok: false,
      status: 401,
      error: "Incorrect admin password."
    };
  }

  return { ok: true, status: 200, error: "" };
}
