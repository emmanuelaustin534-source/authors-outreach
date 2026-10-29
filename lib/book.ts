import { GoogleGenAI } from "@google/genai";

type TavilyResult = { title: string; url: string; content: string };

export type BookInfo = {
  bookWhy: string;
  sources: { title: string; url: string }[];
};

async function webSearch(query: string): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 8 }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

// Opens the pages and reads the parts about the book
async function extractPages(
  urls: string[],
  query: string,
): Promise<{ url: string; content: string }[]> {
  if (urls.length === 0) return [];
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({ urls, query, chunks_per_source: 3 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map(
      (r: { url: string; raw_content?: string }) => ({
        url: r.url,
        content: r.raw_content ?? "",
      }),
    );
  } catch {
    return [];
  }
}

// Book pages come first, then other pages, then author pages
function rank(url: string) {
  const u = url.toLowerCase();
  if (u.includes("goodreads.com/book/show")) return 0;
  if (
    u.includes("amazon.") &&
    (u.includes("/dp/") || u.includes("/gp/product"))
  )
    return 1;
  if (u.includes("goodreads.com") || u.includes("amazon.")) return 3;
  return 2;
}

// Reads the book pages and writes what makes the book unique
export async function researchBook(
  authorName: string,
  bookTitle: string,
): Promise<BookInfo> {
  const empty: BookInfo = { bookWhy: "", sources: [] };
  if (!authorName || !bookTitle) return empty;

  const found = await webSearch(
    `"${bookTitle}" by ${authorName} book description`,
  );

  // Keep only results that really mention this book (title before any ":" subtitle)
  const mainTitle = bookTitle.split(":")[0].trim().toLowerCase();
  const matches = found
    .filter((r) =>
      (r.title + " " + r.content).toLowerCase().includes(mainTitle),
    )
    .sort((a, b) => rank(a.url) - rank(b.url))
    .slice(0, 3);
  if (matches.length === 0) return empty;

  // Open the best pages and read them
  const pages = await extractPages(
    matches.map((m) => m.url),
    `What is the book "${bookTitle}" by ${authorName} about? Story, theme, setting and description.`,
  );
  console.log(
    "Book pages read:",
    pages.map((p) => `${p.url} (${p.content.length} chars)`),
  );

  const searchText = matches
    .map((m, i) => {
      const page = pages.find((p) => p.url === m.url);
      const text = page?.content
        ? page.content.slice(0, 1500)
        : m.content.slice(0, 500);
      return `[${i + 1}] ${m.title}\n${m.url}\n${text}`;
    })
    .join("\n\n");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `Below is text from web pages about the book "${bookTitle}" by ${authorName}.

PAGES:
${searchText}

Write what makes this book interesting or unique, in one or two sentences.

Rules:
- Use ONLY facts found in the pages above. Do not guess.
- Prefer the book's own description (the blurb written by the author or publisher).
- Write about the story, theme, setting or approach of the book. Do NOT write about prices, sales, ranks or the number of reviews.
- If the pages do not describe the book itself, return an empty string.

Reply with a JSON object: { "bookWhy": "the sentences, or empty string" }`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });

  const text = response.text ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return empty;
  const data = JSON.parse(text.slice(start, end + 1));

  return {
    bookWhy: String(data.bookWhy ?? ""),
    sources: matches.map((m) => ({ title: m.title, url: m.url })),
  };
}
