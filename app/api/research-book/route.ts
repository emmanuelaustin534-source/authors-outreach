import { NextResponse } from "next/server";
import { researchBook } from "../../../lib/book";

export async function POST(req: Request) {
  try {
    const { authorName, bookTitle } = await req.json();

    if (!process.env.GEMINI_API_KEY || !process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY or TAVILY_API_KEY is missing in .env.local" },
        { status: 500 },
      );
    }

    const info = await researchBook(authorName, bookTitle);
    return NextResponse.json(info);
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
      { error: "Something went wrong while researching the book." },
      { status: 500 },
    );
  }
}
