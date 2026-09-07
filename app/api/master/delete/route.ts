import { NextResponse } from "next/server";
import { requireSuperAdminUser } from "@/lib/access-control";
import { getCompanyWorkspaceContext, getCompanyWorkspaceId } from "@/lib/company-workspace";
import { deleteStoredWorkbook } from "@/lib/excel";
import { updateDatabase } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await requireSuperAdminUser();
  const workspaceId = getCompanyWorkspaceId(user.companyName);

  try {
    await deleteStoredWorkbook(workspaceId, "master");

    await updateDatabase((database) => {
      const { sharedOwnerIds } = getCompanyWorkspaceContext(database, user.companyName);
      database.masterContacts = database.masterContacts.filter(
        (entry) => !sharedOwnerIds.has(entry.ownerId)
      );
    });

    return NextResponse.redirect(
      new URL(
        "/dashboard/master?message=Master%20workbook%20deleted.%20You%20can%20upload%20a%20fresh%20file%20now.",
        request.url
      ),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Master workbook deletion failed.";
    return NextResponse.redirect(
      new URL(`/dashboard/master?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
