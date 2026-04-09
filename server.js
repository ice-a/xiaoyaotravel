const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { randomUUID } = require("node:crypto");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const INDEX_FILE = path.join(ROOT, "index.html");
const TEMPLATE_COUNT = 10;

const POSTGRES_URL = readEnv(["POSTGRES_URL", "DATABASE_URL", "NEON_DATABASE_URL", "postgres_url", "database_url"]);
const DELETE_PASSWORD = readEnv(["DELETE_PASSWORD", "delete_password"]);
const COUPON_URL = readEnv(["COUPON_URL", "MEITUAN_COUPON_URL", "coupon_url", "meituan_coupon_url"]);
const GEOCODE_USER_AGENT = readEnv(["GEOCODE_USER_AGENT", "geocode_user_agent"]) || "travel-guide-app/1.0";

let pgPool;
let dbReadyPromise;

function readEnv(keys) {
  for (const key of keys) {
    const v = process.env[key];
    if (v) return v;
  }
  return "";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, contentType) {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(payload);
}

function toErrorMessage(error) {
  if (!error) return "Unknown error";
  const msg = error.message || String(error);
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return msg;
  const parts = [];
  if (cause.code) parts.push(`code=${cause.code}`);
  if (cause.errno) parts.push(`errno=${cause.errno}`);
  if (cause.address) parts.push(`address=${cause.address}`);
  if (cause.port) parts.push(`port=${cause.port}`);
  return parts.length ? `${msg} (${parts.join(", ")})` : msg;
}

function buildKey(location, days) {
  return `${location}-${days}天`;
}

function buildGuideId() {
  if (typeof randomUUID === "function") return randomUUID();
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseTemplateId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > TEMPLATE_COUNT) return null;
  return n;
}

function randomTemplateId() {
  return Math.floor(Math.random() * TEMPLATE_COUNT) + 1;
}

function stableTemplateIdByKey(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return (hash % TEMPLATE_COUNT) + 1;
}

function normalizeRouteStep(step) {
  if (!step || typeof step !== "object") return null;
  const from = String(step.from || "").trim();
  const to = String(step.to || "").trim();
  if (!from || !to) return null;
  return {
    from,
    to,
    transport: String(step.transport || "步行").trim(),
    line: String(step.line || "").trim(),
    duration: String(step.duration || "").trim(),
    note: String(step.note || "").trim()
  };
}

function fallbackRoutes(location, itinerary, days) {
  const base = Array.isArray(itinerary) ? itinerary : [];
  return Array.from({ length: days }).map((_, i) => {
    const day = base[i] || {};
    const idx = i + 1;
    const hotel = `${location}酒店`;
    return {
      day: idx,
      title: String(day.theme || `Day ${idx} 交通路线`).trim(),
      steps: [
        { from: `${location}高铁站`, to: hotel, transport: "地铁/公交", line: "", duration: "40分钟", note: "先办理入住" },
        { from: hotel, to: String(day.morning || `${location}核心景点`).trim(), transport: "地铁/步行", line: "", duration: "25分钟", note: "" },
        { from: String(day.morning || `${location}核心景点`).trim(), to: String(day.afternoon || `${location}地标街区`).trim(), transport: "地铁/公交", line: "", duration: "20分钟", note: "" },
        { from: String(day.afternoon || `${location}地标街区`).trim(), to: String(day.evening || `${location}夜游区`).trim(), transport: "步行/地铁", line: "", duration: "20分钟", note: "" },
        { from: String(day.evening || `${location}夜游区`).trim(), to: hotel, transport: "地铁/步行", line: "", duration: "30分钟", note: "" }
      ]
    };
  });
}

function normalizeRoutes(rawRoutes, location, itinerary, days) {
  if (!Array.isArray(rawRoutes) || !rawRoutes.length) return fallbackRoutes(location, itinerary, days);
  const normalized = rawRoutes
    .map((route, i) => {
      if (!route || typeof route !== "object") return null;
      const day = Number(route.day) || i + 1;
      const steps = Array.isArray(route.steps) ? route.steps.map(normalizeRouteStep).filter(Boolean) : [];
      if (!steps.length) return null;
      return { day, title: String(route.title || `Day ${day} 交通路线`).trim(), steps };
    })
    .filter(Boolean)
    .slice(0, days);
  return normalized.length ? normalized : fallbackRoutes(location, itinerary, days);
}

function normalizeSpots(spots) {
  if (!Array.isArray(spots)) return [];
  return spots
    .map((spot) => {
      if (!spot || typeof spot !== "object") return null;
      const name = String(spot.name || "").trim();
      if (!name) return null;
      const lat = Number(spot.lat);
      const lng = Number(spot.lng);
      return {
        name,
        day: Number(spot.day) || null,
        note: String(spot.note || "").trim(),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeBudgetText(value) {
  return String(value || "").trim() || "-";
}

function parsePriceMax(text) {
  const raw = String(text || "").toLowerCase();
  if (!raw) return null;
  const nums = [];
  const re = /(\d+(?:\.\d+)?)\s*(w|万|k|千)?/g;
  let m;
  while ((m = re.exec(raw))) {
    let n = Number(m[1]);
    const unit = m[2];
    if (unit === "w" || unit === "万") n *= 10000;
    else if (unit === "k" || unit === "千") n *= 1000;
    if (Number.isFinite(n)) nums.push(n);
  }
  if (!nums.length) return null;
  return Math.max(...nums);
}

function toAffordableRange(cap) {
  const hi = Math.max(150, Math.round(cap / 10) * 10);
  const lo = Math.max(80, Math.round((hi * 0.65) / 10) * 10);
  return `约${lo}-${hi}元`;
}

function applyBudgetCaps(budget, caps) {
  const out = { ...budget };
  for (const k of ["transport", "hotel", "food", "misc"]) {
    const cap = Number(caps?.[k]);
    const text = normalizeBudgetText(out[k]);
    if (!Number.isFinite(cap) || cap <= 0) {
      out[k] = text;
      continue;
    }
    const parsed = parsePriceMax(text);
    if (parsed && parsed > cap * 1.25) out[k] = toAffordableRange(cap);
    else if (text === "-" || !text) out[k] = toAffordableRange(cap);
    else out[k] = text;
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getPool() {
  if (!POSTGRES_URL) throw new Error("Missing POSTGRES_URL (or DATABASE_URL).");
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS guides (
          id TEXT PRIMARY KEY,
          cache_key TEXT NOT NULL,
          location TEXT NOT NULL,
          days INTEGER NOT NULL,
          template_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
      `);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_guides_cache_key ON guides (cache_key);`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_guides_location ON guides (location);`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_guides_updated_at ON guides (updated_at DESC);`);
    })();
  }
  await dbReadyPromise;
  return pgPool;
}

async function getBudgetGuidance(pool, location) {
  async function queryRows(byLocation) {
    if (byLocation) {
      return pool.query(
        `
          SELECT content->'budget'->>'transport' AS transport,
                 content->'budget'->>'hotel' AS hotel,
                 content->'budget'->>'food' AS food,
                 content->'budget'->>'misc' AS misc
          FROM guides
          WHERE location = $1
          ORDER BY updated_at DESC
          LIMIT 80
        `,
        [location]
      );
    }
    return pool.query(
      `
        SELECT content->'budget'->>'transport' AS transport,
               content->'budget'->>'hotel' AS hotel,
               content->'budget'->>'food' AS food,
               content->'budget'->>'misc' AS misc
        FROM guides
        ORDER BY updated_at DESC
        LIMIT 200
      `
    );
  }

  let rows = (await queryRows(true)).rows;
  if (!rows.length) rows = (await queryRows(false)).rows;

  const samples = { transport: [], hotel: [], food: [], misc: [] };
  for (const row of rows) {
    for (const key of Object.keys(samples)) {
      const n = parsePriceMax(row[key]);
      if (Number.isFinite(n)) samples[key].push(n);
    }
  }

  function percentile(arr, p) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)));
    return s[idx];
  }

  const caps = {
    transport: percentile(samples.transport, 0.5) || 500,
    hotel: percentile(samples.hotel, 0.5) || 600,
    food: percentile(samples.food, 0.5) || 220,
    misc: percentile(samples.misc, 0.5) || 260
  };
  return caps;
}

function normalizeGuidePayload(payload, location, days, caps) {
  const itinerary = Array.isArray(payload.itinerary) ? payload.itinerary.slice(0, days) : [];
  const routes = normalizeRoutes(payload.routes, location, itinerary, days);
  const spots = normalizeSpots(payload.spots);
  const budget = applyBudgetCaps(
    {
      transport: normalizeBudgetText(payload.budget?.transport),
      hotel: normalizeBudgetText(payload.budget?.hotel),
      food: normalizeBudgetText(payload.budget?.food),
      misc: normalizeBudgetText(payload.budget?.misc)
    },
    caps
  );

  return {
    title: payload.title || `${location}${days}天旅游攻略`,
    summary: payload.summary || `${location} ${days} 天行程建议`,
    bestSeason: payload.bestSeason || "四季皆宜",
    travelStyle: payload.travelStyle || "自由行",
    prep: payload.prep || `出发前请确认 ${location} 的天气、交通和预约信息。`,
    audience: payload.audience || "适合第一次去、想快速安排行程的人群。",
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 8) : [],
    foods: Array.isArray(payload.foods) ? payload.foods.slice(0, 6) : [],
    hotels: Array.isArray(payload.hotels) ? payload.hotels.slice(0, 6) : [],
    itinerary,
    routes,
    spots,
    budget,
    tips: Array.isArray(payload.tips) ? payload.tips.slice(0, 8) : []
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Model returned empty content.");
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

async function generateGuide(location, days, budgetCaps) {
  const baseUrl = (readEnv(["OPENAI_BASEURL", "baseurl"]) || "").replace(/\/+$/, "");
  const apiKey = readEnv(["OPENAI_APIKEY", "apikey"]);
  const modelName = readEnv(["OPENAI_MODELNAME", "modelname"]);
  if (!baseUrl || !apiKey || !modelName) throw new Error("Missing model env vars: baseurl, apikey, modelname.");

  const budgetHint = [
    `transport 建议不超过 ${Math.round(budgetCaps.transport)} 元`,
    `hotel 建议不超过 ${Math.round(budgetCaps.hotel)} 元`,
    `food 建议不超过 ${Math.round(budgetCaps.food)} 元`,
    `misc 建议不超过 ${Math.round(budgetCaps.misc)} 元`
  ].join("，");

  const prompt = [
    "你是专业旅行策划师。请输出可执行、预算友好的旅游攻略。",
    `地点：${location}`,
    `天数：${days}天`,
    `预算限制（优先参考历史价格，避免高价）：${budgetHint}`,
    "请尽量给经济/中档方案，不要推荐昂贵酒店。",
    "只返回严格 JSON，不要 Markdown。",
    "{",
    '  "title": "string",',
    '  "summary": "string",',
    '  "bestSeason": "string",',
    '  "travelStyle": "string",',
    '  "prep": "string",',
    '  "audience": "string",',
    '  "tags": ["string"],',
    '  "foods": ["string"],',
    '  "hotels": ["string"],',
    '  "itinerary": [{ "theme": "string", "morning": "string", "afternoon": "string", "evening": "string" }],',
    '  "routes": [{ "day": 1, "title": "string", "steps": [{ "from": "string", "to": "string", "transport": "string", "line": "string", "duration": "string", "note": "string" }] }],',
    '  "spots": [{ "name": "string", "day": 1, "note": "string", "lat": 0, "lng": 0 }],',
    '  "budget": { "transport": "string", "hotel": "string", "food": "string", "misc": "string" },',
    '  "tips": ["string"]',
    "}"
  ].join("\n");

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.45,
        messages: [
          { role: "system", content: "You are a travel planner. Return strict JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });
  } catch (error) {
    throw new Error(`Failed to reach model API (${baseUrl}/chat/completions). ${toErrorMessage(error)}`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || "Model request failed.");
  const parsed = extractJson(result.choices?.[0]?.message?.content);
  return normalizeGuidePayload(parsed, location, days, budgetCaps);
}

function rowToGuide(row) {
  return {
    id: row.id,
    key: row.cache_key,
    location: row.location,
    days: Number(row.days),
    templateId: Number(row.template_id),
    title: row.title,
    content: row.content || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureTemplateId(pool, guide) {
  const cur = parseTemplateId(guide.templateId);
  if (cur) return guide;
  const templateId = stableTemplateIdByKey(guide.key || "");
  const now = new Date().toISOString();
  await pool.query(`UPDATE guides SET template_id = $1, updated_at = $2 WHERE id = $3`, [templateId, now, guide.id]);
  return { ...guide, templateId, updatedAt: now };
}

async function listGuides(locationFilter) {
  const pool = await getPool();
  const values = [];
  let where = "";
  if (locationFilter) {
    values.push(`%${locationFilter}%`);
    where = `WHERE location ILIKE $${values.length}`;
  }
  const { rows } = await pool.query(
    `
      SELECT id, cache_key, location, days, template_id, title, content, created_at, updated_at
      FROM guides
      ${where}
      ORDER BY updated_at DESC
      LIMIT 200
    `,
    values
  );
  const out = [];
  for (const row of rows) {
    const g = await ensureTemplateId(pool, rowToGuide(row));
    out.push({ ...g, source: "cache" });
  }
  return out;
}

async function getOrCreateGuide(location, days, options = {}) {
  const pool = await getPool();
  const key = buildKey(location, days);
  const useCache = options.useCache !== false;
  if (useCache) {
    const { rows } = await pool.query(
      `
        SELECT id, cache_key, location, days, template_id, title, content, created_at, updated_at
        FROM guides
        WHERE cache_key = $1
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [key]
    );
    if (rows.length) {
      const g = await ensureTemplateId(pool, rowToGuide(rows[0]));
      return { item: { ...g, source: "cache" }, cached: true };
    }
  }

  const budgetCaps = await getBudgetGuidance(pool, location);
  const content = await generateGuide(location, days, budgetCaps);
  const now = new Date().toISOString();
  const id = buildGuideId();
  const templateId = randomTemplateId();
  const title = String(content.title || `${location}${days}天旅游攻略`);

  await pool.query(
    `
      INSERT INTO guides (id, cache_key, location, days, template_id, title, content, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    `,
    [id, key, location, days, templateId, title, JSON.stringify(content), now, now]
  );

  return {
    item: {
      id,
      key,
      location,
      days,
      templateId,
      title,
      content,
      createdAt: now,
      updatedAt: now,
      source: "generated"
    },
    cached: false
  };
}

async function geocodeByQuery(query) {
  if (!query) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": GEOCODE_USER_AGENT
      }
    });
    const data = await response.json().catch(() => []);
    if (!Array.isArray(data) || !data.length) return null;
    const item = data[0];
    return {
      lat: Number(item.lat),
      lng: Number(item.lon),
      name: String(item.display_name || "")
    };
  } catch {
    return null;
  }
}

async function deleteGuide(id, password) {
  if (!DELETE_PASSWORD) return { ok: false, statusCode: 503, error: "Delete password is not configured on server." };
  if (!password) return { ok: false, statusCode: 401, error: "Password is required for delete." };
  if (password !== DELETE_PASSWORD) return { ok: false, statusCode: 403, error: "Invalid delete password." };
  const pool = await getPool();
  const result = await pool.query(`DELETE FROM guides WHERE id = $1 OR cache_key = $1`, [id]);
  return { ok: true, deleted: result.rowCount > 0 };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, { couponUrl: COUPON_URL || "" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/geocode") {
    const q = String(url.searchParams.get("q") || "").trim();
    const city = String(url.searchParams.get("city") || "").trim();
    if (!q) {
      sendJson(res, 400, { error: "q cannot be empty." });
      return;
    }
    const full = city && !q.includes(city) ? `${q} ${city}` : q;
    let point = await geocodeByQuery(full);
    if (!point && city) point = await geocodeByQuery(city);
    sendJson(res, 200, { point });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/guides") {
    const location = String(url.searchParams.get("location") || "").trim();
    const items = await listGuides(location);
    sendJson(res, 200, { items });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/guides") {
    const body = await readBody(req);
    const location = String(body.location || "").trim();
    const days = Number(body.days);
    const useCache = body.useCache !== false;
    if (!location) {
      sendJson(res, 400, { error: "location cannot be empty." });
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 14) {
      sendJson(res, 400, { error: "days must be an integer between 1 and 14." });
      return;
    }
    const result = await getOrCreateGuide(location, days, { useCache });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/guides/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/guides/".length) || "").trim();
    const body = await readBody(req);
    const password = String(body.password || "");
    if (!id) {
      sendJson(res, 400, { error: "id cannot be empty." });
      return;
    }
    const result = await deleteGuide(id, password);
    if (!result.ok) {
      sendJson(res, result.statusCode, { error: result.error });
      return;
    }
    sendJson(res, 200, { deleted: result.deleted });
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

async function handleStatic(res, url) {
  if (url.pathname === "/favicon.ico") {
    sendText(res, 204, "", "image/x-icon");
    return;
  }
  if (url.pathname !== "/" && url.pathname !== "/index.html") {
    sendText(res, 404, "Not Found", "text/plain; charset=utf-8");
    return;
  }
  const html = await fs.readFile(INDEX_FILE, "utf8");
  sendText(res, 200, html, "text/html; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await handleStatic(res, url);
  } catch (error) {
    const message = toErrorMessage(error);
    console.error("[server-error]", message, error);
    sendJson(res, 500, { error: message || "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Travel guide app running at http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  if (pgPool) await pgPool.end();
  process.exit(0);
});
