import nodemailer from "nodemailer";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { to, subject, body, test } = await req.json();

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      return NextResponse.json(
        { error: "GMAIL_USER or GMAIL_APP_PASSWORD is missing in .env.local" },
        { status: 500 },
      );
    }

    // A test email always goes to your own address
    const recipient = test ? user : String(to || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return NextResponse.json(
        { error: "The email address is not valid." },
        { status: 400 },
      );
    }
    if (!String(subject || "").trim() || !String(body || "").trim()) {
      return NextResponse.json(
        { error: "The subject or the email text is empty." },
        { status: 400 },
      );
    }
    if (/\[[^\]]+\]/.test(subject + body)) {
      return NextResponse.json(
        { error: "The email still has a placeholder like [Book Title]." },
        { status: 400 },
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: `"${process.env.SENDER_NAME || user}" <${user}>`,
      to: recipient,
      subject: test ? `[TEST] ${subject}` : subject,
      text: body,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    const code = (err as { code?: string }).code;
    if (code === "EAUTH") {
      return NextResponse.json(
        { error: "Gmail login failed. Check GMAIL_USER and the App Password." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "Could not send the email." },
      { status: 500 },
    );
  }
}
