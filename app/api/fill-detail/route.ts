import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { template, placeholders, authorName, bookTitle, bookWhy } =
      await req.json();
    const slots: string[] = Array.isArray(placeholders) ? placeholders : [];

    if (slots.length === 0) return NextResponse.json({ details: [] });

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing" },
        { status: 500 },
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `I am filling in placeholders in an email template.

EMAIL TEMPLATE:
${template}

PLACEHOLDERS TO FILL (in this order):
${slots.map((s, i) => `${i + 1}. ${s}`).join("\n")}

AUTHOR: ${authorName}
BOOK: ${bookTitle}
FACTS ABOUT THE BOOK (the only facts you may use):
${bookWhy}

Rules:
- For each placeholder, write ONLY the words that replace it, so the sentence around it reads naturally. The text inside the brackets tells you what to write.
- Use only the facts above. Do not invent anything.
- Keep each one short: under 25 words, no quotation marks, no full stop at the end.
- If the facts are not enough for a placeholder, use an empty string for it.

Reply with a JSON object: { "details": ["words for placeholder 1", "words for placeholder 2"] }`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ details: slots.map(() => "") });
    }
    const data = JSON.parse(text.slice(start, end + 1));
    const details = slots.map((_, i) => String((data.details ?? [])[i] ?? ""));

    return NextResponse.json({ details });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while writing the details." },
      { status: 500 },
    );
  }
}
