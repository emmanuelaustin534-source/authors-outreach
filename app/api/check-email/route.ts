import { NextResponse } from "next/server";
import { promises as dns } from "dns";

export const runtime = "nodejs";
export const maxDuration = 30;

// Common typos of popular email domains
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gmaul.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.comm": "gmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "yahoo.cm": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "iclould.com": "icloud.com",
  "icoud.com": "icloud.com",
  "icloud.con": "icloud.com",
};

function withTimeout<T>(p: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

function codeOf(err: unknown) {
  return (err as { code?: string }).code;
}

export async function POST(req: Request) {
  const { email } = await req.json();
  const e = String(email || "")
    .trim()
    .toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return NextResponse.json({
      level: "bad",
      message: "This does not look like an email address.",
    });
  }

  const [local, domain] = e.split("@");

  // 1. A typo of a popular domain
  if (TYPOS[domain]) {
    const suggestion = `${local}@${TYPOS[domain]}`;
    return NextResponse.json({
      level: "bad",
      message: `"${domain}" looks like a typo. Did you mean ${suggestion}?`,
      suggestion,
    });
  }

  // 2. Can this domain receive email?
  try {
    let hasMail = false;

    try {
      const mx = await withTimeout(dns.resolveMx(domain));
      hasMail = mx.some((m) => m.exchange && m.exchange !== ".");
    } catch (err) {
      const c = codeOf(err);
      if (c !== "ENOTFOUND" && c !== "ENODATA") throw err;
    }

    if (hasMail) {
      return NextResponse.json({
        level: "ok",
        message: "The domain can receive email.",
      });
    }

    // No mail server listed: check if the domain exists at all
    try {
      const a = await withTimeout(dns.resolve4(domain));
      if (a.length > 0) {
        return NextResponse.json({
          level: "warn",
          message:
            "This domain has a website but no mail server listed. The email may not be delivered.",
        });
      }
    } catch (err) {
      const c = codeOf(err);
      if (c !== "ENOTFOUND" && c !== "ENODATA") throw err;
    }

    return NextResponse.json({
      level: "bad",
      message: `The domain "${domain}" does not exist or cannot receive email.`,
    });
  } catch {
    return NextResponse.json({
      level: "warn",
      message: "Could not check this address right now.",
    });
  }
}
