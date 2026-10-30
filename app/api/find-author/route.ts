import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

type TavilyResult = { title: string; url: string; content: string };

async function webSearch(query: string): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 10 }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

export async function POST(req: Request) {
  try {
    const { authorName, bookHint } = await req.json();
    const name = String(authorName || "").trim();

    if (name.length < 3) {
      return NextResponse.json(
        { error: "Please type the author's full name." },
        { status: 400 },
      );
    }
    if (!process.env.GEMINI_API_KEY || !process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY or TAVILY_API_KEY is missing." },
        { status: 500 },
      );
    }

    const hint = String(bookHint || "").trim();
    const results = await webSearch(
      hint
        ? `${name} author "${hint}" book`
        : `${name} author books Goodreads Amazon`,
    );

    if (results.length === 0) {
      return NextResponse.json({
        matchType: "none",
        confidence: "none",
        authorName: "",
        bookTitle: "",
        bookWhy: "",
        notes: "The web search found nothing for this name.",
        candidates: [],
        sources: [],
      });
    }

    const searchText = results
      .map(
        (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 500)}`,
      )
      .join("\n\n");

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `You are a careful research assistant. Below are web search results about an author.

Author name typed by the user: ${name}
Book the user has in mind (may be empty): ${hint || "none"}

SEARCH RESULTS:
${searchText}

Rules:
- Use ONLY facts found in the search results. Do not guess.
- Find the author who best matches the name. If several different authors share this name, pick the most prominent one and list the others in "candidates" (up to 3).
- Pick the most unique or notable book of the main author.
- "confidence" is how sure you are that the results are about one real author with this name.
- If you cannot find an author, set "authorName" to an empty string and "confidence" to "none".
- If a book is given, prefer the author of that book.

Reply with a JSON object like this:
{
  "authorName": "full name or empty string",
  "confidence": "high" or "medium" or "low" or "none",
  "bookTitle": "title or empty string",
  "notes": "short note about who this author is, from the results",
  "candidates": [
    { "authorName": "name", "bookTitle": "title or empty string", "reason": "why this could be the author the user means" }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json(
        { error: "Gemini did not return a usable answer." },
        { status: 502 },
      );
    }
    const data = JSON.parse(text.slice(start, end + 1));

    const candidates = (data.candidates ?? []).map(
      (c: { authorName?: string; bookTitle?: string; reason?: string }) => ({
        authorName: c.authorName ?? "",
        bookTitle: c.bookTitle ?? "",
        bookWhy: "",
        reason: c.reason ?? "",
      }),
    );

    return NextResponse.json({
      matchType: data.authorName ? "possible" : "none",
      confidence: data.confidence ?? "none",
      authorName: data.authorName ?? "",
      bookTitle: data.bookTitle ?? "",
      bookWhy: "",
      notes: data.notes ?? "",
      candidates,
      sources: results.map((r) => ({ title: r.title, url: r.url })),
    });
  } catch (err) {
    console.error(err);
    const status = (err as { status?: number }).status;
    if (status === 429) {
      return NextResponse.json(
        { error: "Rate limit reached. Wait one minute and try again." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Something went wrong while researching." },
      { status: 500 },
    );
  }
}
