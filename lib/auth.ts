import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createDefaultRuleSet } from "@/lib/defaults";
import { readDatabase, updateDatabase } from "@/lib/storage";
import type { AuthEvent, User, UserRole } from "@/lib/types";

const sessionCookieName = "apr_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 14;
const superAdminAccessEmails = [
  "superadmin@example.com",
  "arbbearings.marketing@gmail.com"
];

type SessionMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) {
    return false;
  }
  const derived = scryptSync(password, salt, 64);
  const original = Buffer.from(originalHash, "hex");
  if (derived.length !== original.length) {
    return false;
  }
  return timingSafeEqual(derived, original);
}

export function isSuperAdminAccessEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const envSuperAdmin = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  if (envSuperAdmin) {
    const list = envSuperAdmin.split(",").map((item) => item.trim());
    if (list.includes(normalized)) {
      return true;
    }
  }
  return superAdminAccessEmails.includes(normalized);
}

function getSessionTokenSuffix(token: string) {
  return token.slice(-8);
}

function buildAuthEvent(
  user: User,
  token: string,
  type: AuthEvent["type"],
  metadata?: SessionMetadata
): AuthEvent {
  return {
    id: randomUUID(),
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    companyName: user.companyName,
    userRole: user.role,
    type,
    sessionTokenSuffix: getSessionTokenSuffix(token),
    ipAddress: metadata?.ipAddress?.trim() || "Unknown",
    userAgent: metadata?.userAgent?.trim() || "Unknown device",
    createdAt: new Date().toISOString()
  };
}

export function extractRequestMetadata(request: Request): SessionMetadata {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const realIp = request.headers.get("x-real-ip") || "";
  const ipAddress = forwardedFor.split(",")[0]?.trim() || realIp.trim() || "Unknown";
  const userAgent = request.headers.get("user-agent") || "Unknown device";

  return { ipAddress, userAgent };
}

export async function registerUser(input: {
  name: string;
  email: string;
  companyName: string;
  password: string;
}) {
  return updateDatabase(async (database) => {
    const existing = database.users.find(
      (user) => user.email.toLowerCase() === input.email.toLowerCase()
    );

    if (existing) {
      throw new Error("An account with this email already exists.");
    }

    const role: UserRole =
      database.users.length === 0 || isSuperAdminAccessEmail(input.email) ? "super_admin" : "user";

    const user: User = {
      id: randomUUID(),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      companyName: input.companyName.trim(),
      passwordHash: hashPassword(input.password),
      role,
      canSendManualReminders: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    database.users.push(user);

    if (role === "super_admin") {
      const defaults = createDefaultRuleSet(user.id);
      database.reminderRules.push(...defaults.rules);
      database.templates.push(...defaults.templates);
      database.dispatchSettings.push(defaults.dispatchSettings);
      database.cashDiscountPolicies.push(...defaults.cashDiscountPolicies);
    }

    return user;
  });
}

export async function createSession(userId: string, metadata?: SessionMetadata) {
  const token = randomBytes(32).toString("hex");
  await updateDatabase((database) => {
    const user = database.users.find((entry) => entry.id === userId);
    const createdAt = new Date().toISOString();

    database.sessions.push({
      token,
      userId,
      ipAddress: metadata?.ipAddress?.trim() || "Unknown",
      userAgent: metadata?.userAgent?.trim() || "Unknown device",
      lastSeenAt: createdAt,
      createdAt,
      expiresAt: new Date(Date.now() + sessionDurationMs).toISOString()
    });

    if (user) {
      database.authEvents.push(buildAuthEvent(user, token, "login", metadata));
      database.auditLogs.push({
        id: randomUUID(),
        ownerId: user.id,
        timestamp: createdAt,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        role: user.role,
        action: "Login",
        status: "success",
        details: metadata?.ipAddress?.trim() || "Unknown"
      });
    }
  });
  return token;
}

export async function destroySession(token: string, metadata?: SessionMetadata) {
  await updateDatabase((database) => {
    const session = database.sessions.find((entry) => entry.token === token);
    const user = session
      ? database.users.find((entry) => entry.id === session.userId) ?? null
      : null;

    if (user) {
      database.authEvents.push(buildAuthEvent(user, token, "logout", metadata));
      database.auditLogs.push({
        id: randomUUID(),
        ownerId: user.id,
        timestamp: new Date().toISOString(),
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        role: user.role,
        action: "Logout",
        status: "success",
        details: metadata?.ipAddress?.trim() || "Unknown"
      });
    }

    database.sessions = database.sessions.filter((session) => session.token !== token);
  });
}

export async function authenticateUser(email: string, password: string) {
  const database = await readDatabase();
  const user = database.users.find((entry) => entry.email === email.trim().toLowerCase());

  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Email or password is incorrect.");
  }

  if (isSuperAdminAccessEmail(user.email) && user.role !== "super_admin") {
    const updatedAt = new Date().toISOString();

    await updateDatabase((currentDatabase) => {
      const currentUser = currentDatabase.users.find((entry) => entry.id === user.id);

      if (currentUser) {
        currentUser.role = "super_admin";
        currentUser.canSendManualReminders = true;
        currentUser.updatedAt = updatedAt;
      }
    });

    return {
      ...user,
      role: "super_admin" as const,
      canSendManualReminders: true,
      updatedAt
    };
  }

  return user;
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (!token) {
    return null;
  }

  const database = await readDatabase();
  const session = database.sessions.find(
    (entry) => entry.token === token && new Date(entry.expiresAt) > new Date()
  );

  if (!session) {
    return null;
  }

  return database.users.find((user) => user.id === session.userId) ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export function isAdminUser(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "admin" || user?.role === "super_admin";
}

export async function requireAdminUser() {
  const user = await requireUser();

  if (!isAdminUser(user)) {
    redirect("/dashboard?error=Admin%20access%20required");
  }

  return user;
}

export function attachSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + sessionDurationMs)
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  });
  return response;
}
