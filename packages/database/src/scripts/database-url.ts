const replaceDatabaseName = (databaseUrl: string, nextDatabaseName: string): string => {
  const url = new URL(databaseUrl);
  const currentPath = url.pathname.replace(/^\//, "");

  if (!currentPath) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  url.pathname = `/${nextDatabaseName}`;
  return url.toString();
};

export const getDatabaseUrl = (): string =>
  process.env.DATABASE_URL ?? "mysql://postbot:postbot@localhost:3307/postbot";

export const getTestDatabaseName = (databaseUrl: string = getDatabaseUrl()): string => {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");

  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  return databaseName.endsWith("_test") ? databaseName : `${databaseName}_test`;
};

export const getTestDatabaseUrl = (databaseUrl: string = getDatabaseUrl()): string =>
  replaceDatabaseName(databaseUrl, getTestDatabaseName(databaseUrl));

export const getRootDatabaseUrl = (databaseUrl: string = getDatabaseUrl()): string =>
  replaceDatabaseName(databaseUrl, "mysql");
