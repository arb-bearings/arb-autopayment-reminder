import { NextResponse } from "next/server";
import {
  attachSessionCookie,
  authenticateUser,
  createSession,
  extractRequestMetadata
} from "@/lib/auth";
import { ACTIVE_COMPANY_COOKIE, normalizeCompanyCode } from "@/lib/company-workspace";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const companyParam = String(formData.get("company") || "ARB").trim();
  const companyCode = normalizeCompanyCode(companyParam);

  try {
    const user = await authenticateUser(email, password, companyCode);
    const token = await createSession(user.id, extractRequestMetadata(request), companyCode);
    const response = NextResponse.redirect(new URL("/dashboard", request.url), { status: 303 });

    // Set session cookie
    attachSessionCookie(response, token);

    // Set workspace cookie so getCurrentUser knows which company is active
    response.cookies.set(ACTIVE_COMPANY_COOKIE, companyCode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14 // 14 days
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
