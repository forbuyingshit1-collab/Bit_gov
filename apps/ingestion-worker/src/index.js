function jobType(cron) {
  return cron === "0 19 * * 6" ? "weekly_reconciliation" : "daily_sync";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "bit-gov-ingestion",
        environment: env.APP_ENV,
      });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async scheduled(controller, env) {
    await env.INGESTION_QUEUE.send({
      type: jobType(controller.cron),
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
      schemaVersion: 1,
    });
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const runId = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      try {
        await env.DB.prepare(
          `INSERT INTO sync_runs
             (id, run_type, status, started_at, source_count, accepted_count, duplicate_count, quarantine_count)
           VALUES (?, ?, 'queued', ?, 0, 0, 0, 0)`,
        )
          .bind(runId, message.body.type, startedAt)
          .run();
        message.ack();
      } catch (error) {
        console.error("Unable to register ingestion run", { runId, message: String(error) });
        message.retry();
      }
    }
  },
};
