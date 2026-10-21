import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return NextResponse.json(
    { error: "Workspace switching while logged in is disabled. Please log out and sign in to the desired company workspace." },
    { status: 403 }
  );
}
