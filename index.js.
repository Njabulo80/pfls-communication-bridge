
import { DurableObject } from "cloudflare:workers";

const VERSION = "0.3";
const DASHBOARD_ORIGIN = "https://njabulo80.github.io";

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

function authorized(request, env) {
  const secret = env.PFLS_BRIDGE_SECRET;
  const header = request.headers.get("Authorization") || "";
  const supplied = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!secret || supplied.length !== secret.length) return false;

  let difference = 0;
  for (let i = 0; i < secret.length; i++) {
    difference |= secret.charCodeAt(i) ^ supplied.charCodeAt(i);
  }

  return difference === 0;
}

export class PFLSState extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/save") {
      const record = await request.json();
      await this.ctx.storage.put("latest_heartbeat", record);
      return json({ saved: true });
    }

    if (request.method === "GET" && url.pathname === "/read") {
      const record = await this.ctx.storage.get("latest_heartbeat");
      return json({ found: !!record, heartbeat: record || null });
    }

    return json({ error: "Not found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get("Origin") || "";

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": DASHBOARD_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    if (method === "GET" && path === "/api/health") {
      return json({
        service: "PFLS Communication Bridge",
        version: VERSION,
        status: "ONLINE",
        authentication_configured: !!env.PFLS_BRIDGE_SECRET,
        persistent_storage: !!env.PFLS_STATE,
        mt5_connected: false,
        trading_enabled: false,
        timestamp: new Date().toISOString()
      });
    }

    if (origin && origin !== DASHBOARD_ORIGIN) {
      return json({ error: "Origin not allowed" }, 403);
    }

    if (method === "POST" && path === "/api/ea/heartbeat") {
      if (!authorized(request, env)) {
        return json({ error: "Unauthorized" }, 401);
      }

      try {
        const raw = await request.text();

        if (raw.length > 8000) {
          return json({ error: "Request too large" }, 413);
        }

        const body = JSON.parse(raw);

        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json({ error: "Invalid heartbeat" }, 400);
        }

        const record = {
          received_at: new Date().toISOString(),
          ea_version: String(body.ea_version || "unknown").slice(0, 40),
          symbol: String(body.symbol || "unknown").slice(0, 40),
          timeframe: String(body.timeframe || "unknown").slice(0, 20),
          status: String(body.status || "HEARTBEAT_RECEIVED").slice(0, 40),
          terminal_connected: body.terminal_connected === true
        };

        const id = env.PFLS_STATE.idFromName("pfls-main-status");
        const stub = env.PFLS_STATE.get(id);

        const saved = await stub.fetch(
          "https://p fls-state/save".replace(" ", ""),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record)
          }
        );

        if (!saved.ok) {
          return json({ error: "Storage failed" }, 500);
        }

        return json({
          accepted: true,
          stored: true,
          mt5_connected: false,
          message: "Heartbeat stored successfully",
          received_at: record.received_at
        });
      } catch (error) {
        return json({ error: "Invalid heartbeat request" }, 400);
      }
    }

    if (method === "GET" && path === "/api/dashboard/status") {
      const id = env.PFLS_STATE.idFromName("pfls-main-status");
      const stub = env.PFLS_STATE.get(id);

      const result = await stub.fetch("https://p fls-state/read".replace(" ", ""));
      const data = await result.json();

      const heartbeat = data.heartbeat;
      const age = heartbeat
        ? Date.now() - new Date(heartbeat.received_at).getTime()
        : null;

      return json({
        service: "PFLS Communication Bridge",
        version: VERSION,
        storage_available: true,
        ea_heartbeat_received: !!heartbeat,
        ea_online: age !== null && age >= 0 && age <= 90000,
        heartbeat: heartbeat,
        timestamp: new Date().toISOString()
      }, 200, DASHBOARD_ORIGIN);
    }

    return json({
      service: "PFLS Communication Bridge",
      version: VERSION,
      error: "Endpoint not found"
    }, 404);
  }
};
