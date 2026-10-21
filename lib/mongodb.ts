import { MongoClient, type Db } from "mongodb";
import { normalizeCompanyCode, type CompanyCode } from "@/lib/company-workspace";

declare global {
  var __mongoClientPromise__: Promise<MongoClient> | undefined;
}

function getClientPromise() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI. Add it to your environment variables.");
  }

  if (!global.__mongoClientPromise__) {
    const promise = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      retryWrites: true,
      retryReads: true
    }).connect();

    promise.catch((err) => {
      console.error("MongoDB connection failed, clearing cache:", err);
      global.__mongoClientPromise__ = undefined;
    });

    global.__mongoClientPromise__ = promise;
  }

  return global.__mongoClientPromise__;
}

export function getDatabaseNameForCompany(companyCode?: string): string {
  const code = normalizeCompanyCode(companyCode || "");
  if (code === "LUB") {
    return process.env.MONGODB_DB_LUBRICANTS || "auto-payment-reminder-lubricants";
  }
  return process.env.MONGODB_DB || "auto-payment-reminder";
}

export async function getMongoDatabase(companyCode?: string): Promise<Db> {
  const client = await getClientPromise();
  const mongoDatabaseName = getDatabaseNameForCompany(companyCode);
  return client.db(mongoDatabaseName);
}
