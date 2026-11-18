import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const {
      template,
      placeholders,
      authorName,
      bookTitle,
      bookWhy,
      authorBio,
    } = await req.json();
    const slots: string[] = Array.isArray(placeholders) ? placeholders : [];

    if (slots.length === 0) return NextResponse.json({ details: [] });

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing" },
        { status: 500 },
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `I am filling in placeholders in an email to an author. The email is from a publicist who came across the author's book.

EMAIL TEMPLATE:
${template}

PLACEHOLDERS TO FILL (in this order):
${slots.map((s, i) => `${i + 1}. ${s}`).join("\n")}

AUTHOR: ${authorName}
BOOK: ${bookTitle}
BOOK DESCRIPTION (the facts you may use):
${bookWhy || "none"}
${authorBio ? `ABOUT THE AUTHOR (facts you may use):\n${authorBio}` : ""}

Rules:
- For each placeholder, write ONLY the words that replace it, so the sentence around it reads naturally and correctly. The words inside the brackets tell you what kind of text to write.
- Base everything on the description above. You may paraphrase, combine ideas, and say what the book seems to explore or what message it seems to carry, as long as it follows from the description.
- Never invent names, events, places or facts that are not in the description. Do not claim to have read the whole book.
- Always write something for every placeholder when the description allows it. Use an empty string only if the description says nothing at all that could fit.
- Keep each one short: usually under 25 words, with no quotation marks and no full stop at the end. A placeholder that asks for a sentence or two can be up to 45 words.

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
    const status = (err as { status?: number }).status;
    if (status === 429) {
      return NextResponse.json(
        { error: "Rate limit reached. Wait a moment and try again." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Something went wrong while writing the details." },
      { status: 500 },
    );
  }
}
