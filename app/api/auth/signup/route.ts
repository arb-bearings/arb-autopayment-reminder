import { NextResponse } from "next/server";
import {
  attachSessionCookie,
  createSession,
  extractRequestMetadata,
  registerUser
} from "@/lib/auth";
import { ACTIVE_COMPANY_COOKIE, normalizeCompanyCode, SUPPORTED_COMPANIES } from "@/lib/company-workspace";

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const companyParam = String(formData.get("company") || "ARB").trim();
  const companyCode = normalizeCompanyCode(companyParam);
  const companyMeta = SUPPORTED_COMPANIES.find((c) => c.code === companyCode) ?? SUPPORTED_COMPANIES[0];

  if (!name || !email || password.length < 8) {
    return NextResponse.redirect(
      new URL("/signup?error=Please%20fill%20all%20fields%20and%20use%20an%208%20character%20password.", request.url),
      { status: 303 }
    );
  }

  try {
    const user = await registerUser(
      {
        name,
        email,
        companyName: companyMeta.fullName,
        password
      },
      companyCode
    );
    const token = await createSession(user.id, extractRequestMetadata(request), companyCode);
    const response = NextResponse.redirect(new URL("/dashboard", request.url), { status: 303 });
    
    attachSessionCookie(response, token);
    response.cookies.set(ACTIVE_COMPANY_COOKIE, companyCode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14 // 14 days
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signup failed.";
    return NextResponse.redirect(
      new URL(`/signup?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
