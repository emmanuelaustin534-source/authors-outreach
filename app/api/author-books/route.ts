import { NextResponse } from "next/server";

export const maxDuration = 60;

type Book = {
  title: string;
  subtitle: string;
  year: string;
  description: string;
  source: string;
  link: string;
};

type Volume = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    description?: string;
    publishedDate?: string;
    infoLink?: string;
  };
};

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function googleSearch(q: string, max: number): Promise<Volume[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY
    ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}`
    : "";
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
        q,
      )}&printType=books&maxResults=${max}${key}`,
    );
    if (!res.ok) {
      console.log("Google Books status:", res.status);
      return [];
    }
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { authorName } = await req.json();
    const name = String(authorName || "").trim();
    if (name.length < 3) {
      return NextResponse.json(
        { error: "Missing author name." },
        { status: 400 },
      );
    }

    const tokens = norm(name)
      .split(" ")
      .filter((t) => t.length > 1);
    const isHis = (authors: string[]) =>
      authors.some((a) => tokens.every((t) => norm(a).includes(t)));

    const books: Book[] = [];
    const seen = new Set<string>();
    const add = (b: Book) => {
      const k = norm(b.title.split(":")[0]);
      if (!k || seen.has(k)) return;
      seen.add(k);
      books.push(b);
    };

    // 1. Google Books by author: has the book descriptions
    for (const it of await googleSearch(`inauthor:"${name}"`, 20)) {
      const v = it.volumeInfo ?? {};
      if (!v.title || !isHis(v.authors ?? [])) continue;
      add({
        title: v.title,
        subtitle: v.subtitle ?? "",
        year: String(v.publishedDate ?? "").slice(0, 4),
        description: String(v.description ?? "").slice(0, 1200),
        source: "Google Books",
        link: v.infoLink ?? "",
      });
    }

    // 2. Open Library: titles and years, no descriptions
    if (books.length < 3) {
      try {
        const res = await fetch(
          `https://openlibrary.org/search.json?author=${encodeURIComponent(
            name,
          )}&limit=20&fields=title,subtitle,first_publish_year,author_name,key`,
        );
        if (res.ok) {
          const data = await res.json();
          for (const d of data.docs ?? []) {
            if (!d.title || !isHis(d.author_name ?? [])) continue;
            add({
              title: d.title,
              subtitle: d.subtitle ?? "",
              year: d.first_publish_year ? String(d.first_publish_year) : "",
              description: "",
              source: "Open Library",
              link: d.key ? `https://openlibrary.org${d.key}` : "",
            });
          }
        }
      } catch {}
    }

    // The 3 books with descriptions first
    const top = [...books]
      .sort((a, b) => Number(!!b.description) - Number(!!a.description))
      .slice(0, 3);

    // 3. For books with no description, ask Google Books again by title
    await Promise.all(
      top.map(async (b) => {
        if (b.description) return;
        const main = b.title.split(":")[0];
        const items = await googleSearch(
          `intitle:"${main}" inauthor:"${name}"`,
          5,
        );
        for (const it of items) {
          const v = it.volumeInfo ?? {};
          if (!isHis(v.authors ?? [])) continue;
          if (!norm(v.title ?? "").includes(norm(main))) continue;
          if (v.description) {
            b.description = String(v.description).slice(0, 1200);
            b.source = "Google Books";
            if (v.infoLink) b.link = v.infoLink;
          }
          if (!b.subtitle && v.subtitle) b.subtitle = v.subtitle;
          if (b.description) break;
        }
      }),
    );

    return NextResponse.json({ books: top });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while looking for books." },
      { status: 500 },
    );
  }
}
