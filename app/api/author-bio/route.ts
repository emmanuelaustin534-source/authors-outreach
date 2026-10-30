import { NextResponse } from "next/server";
import { researchBio } from "../../../lib/bio";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { authorName } = await req.json();
    if (!process.env.GEMINI_API_KEY || !process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY or TAVILY_API_KEY is missing." },
        { status: 500 },
      );
    }
    const bio = await researchBio(String(authorName || ""));
    return NextResponse.json({ bio });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong while researching the background." },
      { status: 500 },
    );
  }
}
