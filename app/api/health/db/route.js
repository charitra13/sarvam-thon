import { randomUUID } from "node:crypto";
import { sql } from "../../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const value = randomUUID();
    const result = await sql.begin(async (tx) => {
      await tx`
        create temporary table munshi_db_health_check (
          value text not null
        ) on commit drop
      `;
      await tx`insert into munshi_db_health_check (value) values (${value})`;
      const [row] = await tx`
        select now() as database_time, value
        from munshi_db_health_check
      `;

      if (row?.value !== value) {
        throw new Error("Database round-trip verification failed.");
      }

      return row;
    });

    return Response.json(
      { ok: true, databaseTime: result.database_time, roundTrip: true },
      { headers },
    );
  } catch {
    return Response.json(
      { ok: false, error: "Database health check failed." },
      { status: 503, headers },
    );
  }
}
