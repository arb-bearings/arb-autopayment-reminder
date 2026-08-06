import { MongoClient, type Db } from "mongodb";

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
      serverSelectionTimeoutMS: 5000,
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

export async function getMongoDatabase(): Promise<Db> {
  const client = await getClientPromise();
  const mongoDatabaseName = process.env.MONGODB_DB || "auto-payment-reminder";
  return client.db(mongoDatabaseName);
}
