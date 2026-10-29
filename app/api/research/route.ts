import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 60;

type TavilyResult = { title: string; url: string; content: string };

// Searches the web with Tavily
async function webSearch(query: string): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

export async function POST(req: Request) {
  try {
    const { email, name } = await req.json();

    if (!process.env.GEMINI_API_KEY || !process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY or TAVILY_API_KEY is missing in .env.local" },
        { status: 500 },
      );
    }

    // The part before the @ (like "katieandrews0418"), used to look for similar names
    const emailName = email
      .split("@")[0]
      .replace(/[0-9._-]+/g, " ")
      .trim();

    // 1. Search the web
    const queries = [`"${email}"`, `${name || emailName} author books`];
    if (!name) queries.push(`${emailName} author Goodreads Amazon`);

    console.time("search");
    const found = (await Promise.all(queries.map(webSearch))).flat();

    // Remove duplicate links and keep the best 10
    const seen = new Set<string>();
    const results = found
      .filter((r) => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      })
      .slice(0, 6);

    if (results.length === 0) {
      return NextResponse.json({
        matchType: "none",
        confidence: "none",
        authorName: "",
        bookTitle: "",
        bookWhy: "",
        notes: "The web search found nothing for this email.",
        candidates: [],
        sources: [],
      });
    }

    const searchText = results
      .map(
        (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 400)}`,
      )
      .join("\n\n");

    // 2. Ask Gemini to read the results
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `You are a careful research assistant. Below are web search results about an email address. Work out who the author is and pick their most unique or notable book.

Email: ${email}
Name (may be empty): ${name || "unknown"}
Name hint taken from the email: ${emailName}

SEARCH RESULTS:
${searchText}

Rules:
- Use ONLY facts found in the search results above. Do NOT guess or use outside memory.
- "matchType" must be one of three values:
  * "exact": the email address itself appears in the results, connected to this author.
  * "possible": the email address is NOT in the results, but the results show one or more authors whose name looks like the email name or the given name (for example "katieandrews" and "Kathryn Andrews"). These are only possible matches.
  * "none": no author with a matching or similar name was found.
- NEVER say "exact" unless you can see the email address in the results.
- If matchType is "possible", put your best guess in the main fields, and list up to 3 other authors with the same or a similar name in "candidates". Explain in "notes" that the exact email was not found.
- For "bookWhy", use ONLY what the results say about the book's story or content. If they say nothing about it, use an empty string. Never guess from the title.
- Pick the most unique, interesting or notable book of the author.

Reply with a JSON object like this:
{
  "matchType": "exact" or "possible" or "none",
  "confidence": "high" or "medium" or "low" or "none",
  "authorName": "full name or empty string",
  "bookTitle": "title or empty string",
  "bookWhy": "one or two sentences, or empty string",
  "notes": "short note on how you matched (or failed to match) the email",
  "candidates": [
    {
      "authorName": "name",
      "bookTitle": "title or empty string",
      "bookWhy": "short, or empty string",
      "reason": "why this author could be the owner of the email"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    console.timeEnd("search");

    // 3. Turn the answer into data
    const text = response.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      console.log("Gemini replied with:", text);
      return NextResponse.json(
        { error: "Gemini did not return a usable answer." },
        { status: 502 },
      );
    }
    const data = JSON.parse(text.slice(start, end + 1));

    const sources = results.map((r) => ({ title: r.title, url: r.url }));

    return NextResponse.json({
      ...data,
      candidates: data.candidates ?? [],
      sources,
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
