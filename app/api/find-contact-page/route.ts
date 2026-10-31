import { NextResponse } from "next/server";
import { findAuthorSite } from "../../../lib/contact";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { authorName, bookTitle } = await req.json();

    if (!process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "TAVILY_API_KEY is missing" },
        { status: 500 },
      );
    }

    const site = await findAuthorSite(authorName || "", bookTitle || "");
    return NextResponse.json(site);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while looking for the website." },
      { status: 500 },
    );
  }
}
