import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Run neon deploy locally or set DATABASE_URL in the deployment environment.",
  );
}

// Neon's DATABASE_URL uses PgBouncer; keep one connection per warm Node instance.
export const sql =
  globalThis.__munshiSql ??
  postgres(databaseUrl, {
    ssl: true,
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
    max_lifetime: 60 * 5,
  });

// Reuse the pool when Next.js reloads server modules during development.
if (process.env.NODE_ENV !== "production") {
  globalThis.__munshiSql = sql;
}
