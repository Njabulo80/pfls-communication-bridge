
import { DurableObject } from "cloudflare:workers";

const VERSION = "0.5";
const DASHBOARD_ORIGIN = "https://njabulo80.github.io";
const HEARTBEAT_TIMEOUT_MS = 90000;

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

  if (!secret || supplied.length !== secret.length)
    return false;

  let difference = 0;

  for (let i = 0; i < secret.length; i++) {
    difference |= secret.charCodeAt(i) ^ supplied.charCodeAt(i);
  }

  return difference === 0;
}

async function readHeartbeat(env) {
  const id = env.PFLS_STATE.idFromName("pfls-main-status");
  const stub = env.PFLS_STATE.get(id);

  const result = await stub.fetch(
    "https://pfls-state/read"
  );

  if (!result.ok)
    throw new Error("Heartbeat storage unavailable");

  const data = await result.json();

  return data.heartbeat || null;
}

function heartbeatStatus(heartbeat) {
  const age = heartbeat
    ? Date.now() - new Date(heartbeat.received_at).getTime()
    : null;

  const online =
    age !== null &&
    age >= 0 &&
    age <= HEARTBEAT_TIMEOUT_MS;

  return {
    ea_heartbeat_received: !!heartbeat,
    ea_online: online,
    mt5_connected:
      online && heartbeat.terminal_connected === true,
    heartbeat: heartbeat,
    heartbeat_age_ms: age
  };
}

export class PFLSState extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/save") {
      const record = await request.json();

      await this.ctx.storage.put(
        "latest_heartbeat",
        record
      );

      return json({ saved: true });
    }

    if (request.method === "GET" && url.pathname === "/read") {
      const record = await this.ctx.storage.get("latest_heartbeat");
      const snapshot = await this.ctx.storage.get("latest_account_snapshot");
      return json({
        found: !!record,
        heartbeat: record || null,
        snapshot_found: !!snapshot,
        snapshot: snapshot || null
      });
    }

    if (request.method === "POST" && url.pathname === "/save-snapshot") {
      const snapshot = await request.json();
      await this.ctx.storage.put("latest_account_snapshot", snapshot);
      return json({ saved: true });
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

    // Browser preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":
            origin === DASHBOARD_ORIGIN || origin === "null" ? origin : DASHBOARD_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // Public health endpoint
    if (method === "GET" && path === "/api/health") {
      try {
        const heartbeat = await readHeartbeat(env);

        return json({
          service: "PFLS Communication Bridge",
          version: VERSION,
          status: "ONLINE",
          authentication_configured: !!env.PFLS_BRIDGE_SECRET,
          persistent_storage: !!env.PFLS_STATE,
          ...heartbeatStatus(heartbeat),
          trading_enabled: false,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        return json({
          service: "PFLS Communication Bridge",
          version: VERSION,
          status: "ONLINE",
          authentication_configured: !!env.PFLS_BRIDGE_SECRET,
          persistent_storage: false,
          ea_heartbeat_received: false,
          ea_online: false,
          mt5_connected: false,
          trading_enabled: false,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Authenticated read-only MT5 account snapshot ingestion.
    if (method === "POST" && path === "/api/mt5/snapshot") {
      if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);
      try {
        const raw = await request.text();
        if (raw.length > 64000) return json({ error: "Snapshot too large" }, 413);
        const body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid snapshot" }, 400);
        if (body.account_type !== "DEMO") return json({ error: "Demo accounts only" }, 403);
        if (!Array.isArray(body.open_positions) || !Array.isArray(body.recent_deals)) return json({ error: "Missing account arrays" }, 400);

        const snapshot = {
          received_at: new Date().toISOString(),
          collector_version: String(body.collector_version || "unknown").slice(0, 20),
          account_type: "DEMO",
          account_login: Number(body.account_login) || 0,
          account_currency: String(body.account_currency || "").slice(0, 12),
          account_server: String(body.account_server || "").slice(0, 100),
          broker_company: String(body.broker_company || "").slice(0, 100),
          balance: Number(body.balance) || 0,
          equity: Number(body.equity) || 0,
          margin: Number(body.margin) || 0,
          free_margin: Number(body.free_margin) || 0,
          margin_level: Number(body.margin_level) || 0,
          floating_profit: Number(body.floating_profit) || 0,
          terminal_connected: body.terminal_connected === true,
          symbol: String(body.symbol || "").slice(0, 40),
          snapshot_time: String(body.snapshot_time || "").slice(0, 40),
          open_positions: body.open_positions.slice(0, 100),
          recent_deals: body.recent_deals.slice(-100)
        };
        const id = env.PFLS_STATE.idFromName("pfls-main-status");
        const stub = env.PFLS_STATE.get(id);
        const saved = await stub.fetch("https://pfls-state/save-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot)
        });
        if (!saved.ok) return json({ error: "Snapshot storage failed" }, 500);
        return json({ accepted: true, stored: true, account_type: "DEMO",
          positions_count: snapshot.open_positions.length,
          deals_count: snapshot.recent_deals.length,
          received_at: snapshot.received_at });
      } catch (error) {
        return json({ error: "Invalid snapshot request" }, 400);
      }
    }

    // Authenticated mobile read endpoint. This token cannot write account data.
    if (method === "GET" && path === "/api/mobile/snapshot") {
      const readToken = env.PFLS_MOBILE_READ_TOKEN || "";
      const header = request.headers.get("Authorization") || "";
      const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!readToken || supplied.length !== readToken.length)
        return json({ error: "Unauthorized" }, 401, origin === "null" ? "null" : DASHBOARD_ORIGIN);
      let difference = 0;
      for (let i = 0; i < readToken.length; i++)
        difference |= readToken.charCodeAt(i) ^ supplied.charCodeAt(i);
      if (difference !== 0)
        return json({ error: "Unauthorized" }, 401, origin === "null" ? "null" : DASHBOARD_ORIGIN);
      try {
        const id = env.PFLS_STATE.idFromName("pfls-main-status");
        const stub = env.PFLS_STATE.get(id);
        const result = await stub.fetch("https://pfls-state/read");
        const data = await result.json();
        return json({ found: !!data.snapshot_found, snapshot: data.snapshot || null,
          timestamp: new Date().toISOString() }, 200, origin === "null" ? "null" : DASHBOARD_ORIGIN);
      } catch (error) {
        return json({ error: "Snapshot unavailable" }, 500, origin === "null" ? "null" : DASHBOARD_ORIGIN);
      }
    }

    // Restrict browser-origin requests
    if (origin && origin !== DASHBOARD_ORIGIN) {
      return json({ error: "Origin not allowed" }, 403);
    }

    // Authenticated EA heartbeat
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

        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body)
        ) {
          return json({ error: "Invalid heartbeat" }, 400);
        }

        const record = {
          received_at: new Date().toISOString(),
          ea_version: String(
            body.ea_version || "unknown"
          ).slice(0, 40),
          symbol: String(
            body.symbol || "unknown"
          ).slice(0, 40),
          timeframe: String(
            body.timeframe || "unknown"
          ).slice(0, 20),
          status: String(
            body.status || "HEARTBEAT_RECEIVED"
          ).slice(0, 40),
          terminal_connected:
            body.terminal_connected === true
        };

        const id = env.PFLS_STATE.idFromName(
          "pfls-main-status"
        );

        const stub = env.PFLS_STATE.get(id);

        const saved = await stub.fetch(
          "https://pfls-state/save",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(record)
          }
        );

        if (!saved.ok) {
          return json({ error: "Storage failed" }, 500);
        }

        return json({
          accepted: true,
          stored: true,
          message: "Heartbeat stored successfully",
          ...heartbeatStatus(record),
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        return json({
          error: "Invalid heartbeat request"
        }, 400);
      }
    }

    // Dashboard status
    if (
      method === "GET" &&
      path === "/api/dashboard/status"
    ) {
      try {
        const heartbeat = await readHeartbeat(env);

        return json({
          service: "PFLS Communication Bridge",
          version: VERSION,
          storage_available: true,
          ...heartbeatStatus(heartbeat),
          timestamp: new Date().toISOString()
        }, 200, DASHBOARD_ORIGIN);

      } catch (error) {
        return json({
          service: "PFLS Communication Bridge",
          version: VERSION,
          storage_available: false,
          ea_heartbeat_received: false,
          ea_online: false,
          mt5_connected: false,
          heartbeat: null,
          timestamp: new Date().toISOString()
        }, 500, DASHBOARD_ORIGIN);
      }
    }

    return json({
      service: "PFLS Communication Bridge",
      version: VERSION,
      error: "Endpoint not found"
    }, 404);
  }
};
