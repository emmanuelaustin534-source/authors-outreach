import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const { template, placeholder, authorName, bookTitle, bookWhy } =
      await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing in .env.local" },
        { status: 500 },
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `I am filling in one placeholder in an email template.

EMAIL TEMPLATE:
${template}

PLACEHOLDER TO FILL:
${placeholder}

AUTHOR: ${authorName}
BOOK: ${bookTitle}
FACTS ABOUT THE BOOK (the only facts you may use):
${bookWhy}

Rules:
- Write ONLY the words that replace the placeholder, so the sentence reads naturally.
- Use only the facts above. Do not invent anything.
- Keep it short: under 20 words, no quotation marks, no full stop at the end.
- If the facts are not enough, return an empty string.

Reply with a JSON object: { "detail": "the words" }`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ detail: "" });
    }
    const data = JSON.parse(text.slice(start, end + 1));

    return NextResponse.json({ detail: data.detail ?? "" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while writing the detail." },
      { status: 500 },
    );
  }
}
