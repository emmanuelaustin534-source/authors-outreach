import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  // No password set: allow on your own computer, block when live
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("APP_PASSWORD is not set.", { status: 503 });
    }
    return NextResponse.next();
  }

  // Check the password the browser sends

  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      const user = decoded.slice(0, i).trim();
      const pass = decoded.slice(i + 1).trim();
      const secret = password.trim();
      if (pass === secret || user === secret) return NextResponse.next();
    } catch {}
  }

  return new NextResponse("Login required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Author Outreach"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
