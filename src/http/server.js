import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { AuthenticationError, verifyTelegramInitData } from "../auth/telegram.js";
import { handleTelegramUpdate } from "../telegram/webhook.js";

const JSON_LIMIT = 100_000;
const MIME_TYPES = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".svg", "image/svg+xml"]]);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    const error = new Error("Content-Type must be application/json."); error.statusCode = 415; throw error;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > JSON_LIMIT) { const error = new Error("Request body is too large."); error.statusCode = 413; throw error; }
  }
  try { return body ? JSON.parse(body) : {}; } catch { const error = new Error("Request body must be valid JSON."); error.statusCode = 400; throw error; }
}

function authenticate(request, config, now) {
  if (config.mode === "demo") return { id: config.demoUserId, firstName: "Demo" };
  return verifyTelegramInitData(request.headers["x-telegram-init-data"], config.telegramBotToken, { now });
}

function endpointPath(url) { return url.pathname.replace(/^\/api/, "") || "/"; }

function createRateLimiter({ limit = 120, intervalMs = 60_000 } = {}) {
  const buckets = new Map();
  return (identity) => {
    const current = Date.now();
    const bucket = buckets.get(identity) || { since: current, count: 0 };
    if (current - bucket.since >= intervalMs) { bucket.since = current; bucket.count = 0; }
    bucket.count += 1; buckets.set(identity, bucket);
    if (bucket.count > limit) { const error = new Error("Too many requests. Try again shortly."); error.statusCode = 429; throw error; }
  };
}

async function serveStatic(request, response, publicDirectory) {
  const requested = request.url === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
  const safePath = path.resolve(publicDirectory, `.${requested}`);
  if (!safePath.startsWith(`${path.resolve(publicDirectory)}${path.sep}`)) return false;
  try {
    const content = await fs.readFile(safePath);
    response.writeHead(200, { "content-type": MIME_TYPES.get(path.extname(safePath)) || "application/octet-stream", "x-content-type-options": "nosniff" });
    response.end(content); return true;
  } catch { return false; }
}

export function createAppServer({ config, store, now = Date.now, publicDirectory = path.resolve("public") }) {
  const rateLimit = createRateLimiter();
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/health") return json(response, 200, { ok: true, mode: config.mode });

      if (url.pathname === "/telegram/webhook") {
        if (config.mode !== "production") return json(response, 404, { error: "Not found." });
        if (request.method !== "POST" || request.headers["x-telegram-bot-api-secret-token"] !== config.webhookSecret) return json(response, 401, { error: "Unauthorized." });
        await handleTelegramUpdate(await readJson(request), config);
        return json(response, 200, { ok: true });
      }

      if (!url.pathname.startsWith("/api/")) {
        if (request.method === "GET" && await serveStatic(request, response, publicDirectory)) return;
        return json(response, 404, { error: "Not found." });
      }
      const principal = authenticate(request, config, now());
      rateLimit(principal.id);
      const route = endpointPath(url);

      if (request.method === "GET" && route === "/today") return json(response, 200, store.getToday(principal.id, now()));
      if (request.method === "GET" && route === "/settings") return json(response, 200, store.getSettings(principal.id));
      if (request.method === "GET" && route === "/summary/week") return json(response, 200, store.getWeek(principal.id, now(), url.searchParams.get("weekOf") || undefined));
      if (request.method === "GET" && route === "/journal") {
        return json(response, 200, store.getWeek(principal.id, now(), url.searchParams.get("weekOf") || undefined));
      }
      if (request.method === "GET" && route === "/journal/day") return json(response, 200, store.getDay(principal.id, url.searchParams.get("date")));

      const mutations = new Map([
        ["PUT /today/workout", (body) => store.saveWorkout(principal.id, now(), body)],
        ["PUT /today/nutrition", (body) => store.saveNutrition(principal.id, now(), body)],
        ["PUT /settings", (body) => store.saveSettings(principal.id, body)],
        ["POST /onboarding", () => store.completeOnboarding(principal.id)],
      ]);
      const mutation = mutations.get(`${request.method} ${route}`);
      if (mutation) {
        const body = await readJson(request);
        const result = store.runIdempotent(principal.id, `${request.method} ${route}`, request.headers["idempotency-key"], body, () => mutation(body));
        return json(response, result.status, result.body);
      }
      return json(response, 404, { error: "Not found." });
    } catch (error) {
      const status = error instanceof AuthenticationError ? 401 : error.statusCode || (error instanceof RangeError ? 400 : 500);
      if (status >= 500) console.error(`Unhandled request error: ${error.message}`);
      return json(response, status, { error: status === 401 ? "Unauthorized." : status >= 500 ? "An unexpected error occurred." : error.message });
    }
  });
}
