import { GoogleGenAI } from "@google/genai";
import { webSearch, extractPages } from "./book";

// Finds the public, professional background of an author
export async function researchBio(authorName: string): Promise<string> {
  const results = await webSearch(
    `${authorName} author biography about the author`,
  );

  const tokens = authorName
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const mine = results
    .filter(
      (r) =>
        !/(rocketreach|zoominfo|contactout|lusha|apollo|signalhire|hunter\.io)/i.test(
          r.url,
        ),
    )
    .filter((r) =>
      tokens.every((t) =>
        (r.title + " " + r.content).toLowerCase().includes(t),
      ),
    )
    .slice(0, 3);
  if (mine.length === 0) return "";

  const pages = await extractPages(
    mine.map((m) => m.url),
    `Biography and background of the author ${authorName}`,
  );

  const text = mine
    .map((m, i) => {
      const p = pages.find((x) => x.url === m.url);
      const body = p?.content
        ? p.content.slice(0, 1500)
        : m.content.slice(0, 500);
      return `[${i + 1}] ${m.title}\n${m.url}\n${body}`;
    })
    .join("\n\n");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `Below is text from web pages about the author "${authorName}".

PAGES:
${text}

Write 1 or 2 sentences about this author's background.

Rules:
- Use ONLY facts found in the pages above. Do not guess.
- Only use professional or public author facts: career, topics they write about, awards, books, where they are based if their bio says so.
- Do NOT include family, health, age, relationships or other private details.
- If the pages are not clearly about this author, return an empty string.

Reply with a JSON object: { "bio": "the sentences, or empty string" }`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });

  const out = response.text ?? "";
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start === -1 || end === -1) return "";
  const data = JSON.parse(out.slice(start, end + 1));
  return String(data.bio ?? "");
}
