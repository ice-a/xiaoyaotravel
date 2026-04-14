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
const VERCEL_ANALYTICS_FILE = path.join(ROOT, "node_modules", "@vercel", "analytics", "dist", "index.mjs");
const TEMPLATE_COUNT = 10;

const POSTGRES_URL = readEnv(["POSTGRES_URL", "DATABASE_URL", "NEON_DATABASE_URL", "postgres_url", "database_url"]);
const DELETE_PASSWORD = readEnv(["DELETE_PASSWORD", "delete_password"]);
const PROMOTIONS_JSON = readEnv(["PROMOTIONS_JSON", "promotions_json"]);
const GEOCODE_USER_AGENT = readEnv(["GEOCODE_USER_AGENT", "geocode_user_agent"]) || "travel-guide-app/1.0";
const GYG_PARTNER_ID = "7JREU1P";

let pgPool;
let dbReadyPromise;

const TEXT = {
  unknownError: "未知错误",
  missingPostgres: "缺少 POSTGRES_URL（或 DATABASE_URL）。",
  missingModelEnv: "缺少模型环境变量：baseurl、apikey、modelname。",
  modelEmpty: "模型返回了空内容。",
  modelRequestFailed: "模型请求失败。",
  geocodeQueryEmpty: "q 不能为空。",
  locationEmpty: "location 不能为空。",
  daysInvalid: "days 必须是 1 到 14 之间的整数。",
  idEmpty: "id 不能为空。",
  apiRouteNotFound: "API 路由不存在。",
  deletePasswordNotConfigured: "服务端未配置删除密码。",
  deletePasswordRequired: "删除操作需要密码。",
  deletePasswordInvalid: "删除密码错误。",
  internalServerError: "服务器内部错误。",
  notFound: "Not Found",
  transportWalk: "步行",
  transportMetroBus: "地铁/公交",
  transportMetroWalk: "地铁/步行",
  transportWalkMetro: "步行/地铁",
  noteCheckIn: "先办理入住",
  cityCenter: "城市中心",
  routeTitle: ({ day }) => `第 ${day} 天交通路线`,
  dayTitle: ({ day }) => `第 ${day} 天`,
  hotelName: ({ location }) => `${location}酒店`,
  stationName: ({ location }) => `${location}高铁站`,
  coreSpot: ({ location }) => `${location}核心景点`,
  landmarkDistrict: ({ location }) => `${location}地标片区`,
  nightArea: ({ location }) => `${location}夜游片区`,
  duration40min: "40分钟",
  duration25min: "25分钟",
  duration20min: "20分钟",
  duration30min: "30分钟",
  aroundPriceRange: ({ lo, hi }) => `约${lo}-${hi}元`,
  guideTitle: ({ location, days }) => `${location}${days}天旅游攻略`,
  guideSummary: ({ location, days }) => `${location}${days}天行程建议`,
  bestSeason: "四季皆宜",
  travelStyle: "自由行",
  prep: ({ location }) => `出发前建议确认 ${location} 的天气、交通和预约要求。`,
  audience: "适合第一次去、想快速做计划的游客。",
  departureAdvice: "建议早上出发，尽早处理行李和第一站安排。",
  systemPrompt: "你是旅行规划师，只返回严格 JSON。",
  promptIntro: "你是专业旅游规划师，请生成可执行、预算友好的旅游攻略。",
  promptLanguage: ({ lang }) => `请使用以下语言生成内容：${lang === "en" ? "English" : "简体中文"}。`,
  promptLocation: ({ location }) => `地点：${location}`,
  promptDays: ({ days }) => `天数：${days}天`,
  promptBudget: ({ budgetHint }) => `预算限制（优先参考历史价格，避免高价）：${budgetHint}`,
  promptBudgetLineTransport: ({ value }) => `transport 建议不超过 ${value} 元`,
  promptBudgetLineHotel: ({ value }) => `hotel 建议不超过 ${value} 元`,
  promptBudgetLineFood: ({ value }) => `food 建议不超过 ${value} 元`,
  promptBudgetLineMisc: ({ value }) => `misc 建议不超过 ${value} 元`,
  promptEconomy: "请尽量给经济/中档方案，不要推荐昂贵酒店。",
  promptReferenceSpots: ({ spots }) => `用户提供了以下参考景点（仅供参考，若景点不存在或距目的地太远请忽略）：${spots}`,
  promptJsonOnly: "只返回严格 JSON，不要 Markdown。",
  startupLog: ({ port }) => `旅游攻略应用已启动：http://localhost:${port}`,
};

function text(key, params) {
  const value = TEXT[key] ?? key;
  return typeof value === "function" ? value(params || {}) : value;
}

function readEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

function parsePromotions(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildPromotions() {
  const promotions = [];
  const pushPromo = (promo) => {
    const url = String(promo?.url || "").trim();
    if (!url) return;
    promotions.push({
      id: String(promo?.id || `promo-${promotions.length + 1}`),
      title: String(promo?.title || "").trim(),
      subtitle: String(promo?.subtitle || "").trim(),
      url,
      ctaText: String(promo?.ctaText || "").trim(),
    });
  };

  parsePromotions(PROMOTIONS_JSON).forEach(pushPromo);

  promotions.push({
    id: "booking-default",
    title: "Booking.com 酒店预订",
    subtitle: "全球海量酒店，低价保障",
    url: "https://www.booking.com/index.html?aid=1662037",
    ctaText: "立即查看"
  });

  return promotions;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, contentType) {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(payload);
}

function getContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".mjs": return "application/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".map": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function toErrorMessage(error) {
  if (!error) return text("unknownError");
  const message = error.message || String(error);
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return message;

  const parts = [];
  if (cause.code) parts.push(`code=${cause.code}`);
  if (cause.errno) parts.push(`errno=${cause.errno}`);
  if (cause.address) parts.push(`address=${cause.address}`);
  if (cause.port) parts.push(`port=${cause.port}`);
  return parts.length ? `${message} (${parts.join(", ")})` : message;
}

function buildKey(location, days) {
  return `${String(location || "").trim()}::${Number(days)}`;
}

function buildGuideId() {
  if (typeof randomUUID === "function") return randomUUID();
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseTemplateId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > TEMPLATE_COUNT) return null;
  return numeric;
}

function randomTemplateId() {
  return Math.floor(Math.random() * TEMPLATE_COUNT) + 1;
}

function stableTemplateIdByKey(key) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
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
    transport: String(step.transport || text("transportWalk")).trim(),
    line: String(step.line || "").trim(),
    duration: String(step.duration || "").trim(),
    note: String(step.note || "").trim(),
  };
}

function fallbackRoutes(location, itinerary, days) {
  const base = Array.isArray(itinerary) ? itinerary : [];
  return Array.from({ length: days }).map((_, index) => {
    const dayData = base[index] || {};
    const day = index + 1;
    const hotel = text("hotelName", { location });
    const morning = String(dayData.morning || text("coreSpot", { location })).trim();
    const afternoon = String(dayData.afternoon || text("landmarkDistrict", { location })).trim();
    const evening = String(dayData.evening || text("nightArea", { location })).trim();

    return {
      day,
      title: String(dayData.theme || text("routeTitle", { day })).trim(),
      steps: [
        { from: text("stationName", { location }), to: hotel, transport: text("transportMetroBus"), line: "", duration: text("duration40min"), note: text("noteCheckIn") },
        { from: hotel, to: morning, transport: text("transportMetroWalk"), line: "", duration: text("duration25min"), note: "" },
        { from: morning, to: afternoon, transport: text("transportMetroBus"), line: "", duration: text("duration20min"), note: "" },
        { from: afternoon, to: evening, transport: text("transportWalkMetro"), line: "", duration: text("duration20min"), note: "" },
        { from: evening, to: hotel, transport: text("transportMetroWalk"), line: "", duration: text("duration30min"), note: "" },
      ],
    };
  });
}

function normalizeRoutes(rawRoutes, location, itinerary, days) {
  if (!Array.isArray(rawRoutes) || !rawRoutes.length) return fallbackRoutes(location, itinerary, days);

  const normalized = rawRoutes
    .map((route, index) => {
      if (!route || typeof route !== "object") return null;
      const day = Number(route.day) || index + 1;
      const steps = Array.isArray(route.steps) ? route.steps.map((step) => normalizeRouteStep(step)).filter(Boolean) : [];
      if (!steps.length) return null;
      return {
        day,
        title: String(route.title || text("routeTitle", { day })).trim(),
        steps,
      };
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
        lng: Number.isFinite(lng) ? lng : null,
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeBudgetText(value) {
  return String(value || "").trim() || "-";
}

function parsePriceMax(textValue) {
  const raw = String(textValue || "").toLowerCase();
  if (!raw) return null;

  const matches = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(w|万|k|千)?/g;
  let match;
  while ((match = pattern.exec(raw))) {
    let numeric = Number(match[1]);
    const unit = match[2];
    if (unit === "w" || unit === "万") numeric *= 10000;
    else if (unit === "k" || unit === "千") numeric *= 1000;
    if (Number.isFinite(numeric)) matches.push(numeric);
  }

  if (!matches.length) return null;
  return Math.max(...matches);
}

function toAffordableRange(cap) {
  const high = Math.max(150, Math.round(cap / 10) * 10);
  const low = Math.max(80, Math.round((high * 0.65) / 10) * 10);
  return text("aroundPriceRange", { lo: low, hi: high });
}

function applyBudgetCaps(budget, caps) {
  const output = { ...budget };
  for (const key of ["transport", "hotel", "food", "misc"]) {
    const cap = Number(caps?.[key]);
    const textValue = normalizeBudgetText(output[key]);
    if (!Number.isFinite(cap) || cap <= 0) {
      output[key] = textValue;
      continue;
    }

    const parsed = parsePriceMax(textValue);
    if (parsed && parsed > cap * 1.25) output[key] = toAffordableRange(cap);
    else if (textValue === "-" || !textValue) output[key] = toAffordableRange(cap);
    else output[key] = textValue;
  }
  return output;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getPool() {
  if (!POSTGRES_URL) throw new Error(text("missingPostgres"));

  if (!pgPool) {
    pgPool = new Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
  }

  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS guides (
          id TEXT PRIMARY KEY,
          cache_key TEXT NOT NULL,
          location TEXT NOT NULL,
          days INTEGER NOT NULL,
          template_id INTEGER,
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
      const numeric = parsePriceMax(row[key]);
      if (Number.isFinite(numeric)) samples[key].push(numeric);
    }
  }

  function percentile(values, ratio) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
    return sorted[index];
  }

  return {
    transport: percentile(samples.transport, 0.5) || 500,
    hotel: percentile(samples.hotel, 0.5) || 600,
    food: percentile(samples.food, 0.5) || 220,
    misc: percentile(samples.misc, 0.5) || 260,
  };
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
      misc: normalizeBudgetText(payload.budget?.misc),
    },
    caps
  );

  return {
    title: payload.title || text("guideTitle", { location, days }),
    summary: payload.summary || text("guideSummary", { location, days }),
    bestSeason: payload.bestSeason || text("bestSeason"),
    travelStyle: payload.travelStyle || text("travelStyle"),
    prep: payload.prep || text("prep", { location }),
    audience: payload.audience || text("audience"),
    departureAdvice: payload.departureAdvice || text("departureAdvice"),
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 8) : [],
    foods: Array.isArray(payload.foods) ? payload.foods.slice(0, 6) : [],
    hotels: Array.isArray(payload.hotels) ? payload.hotels.slice(0, 6) : [],
    itinerary,
    routes,
    spots,
    budget,
    tips: Array.isArray(payload.tips) ? payload.tips.slice(0, 8) : [],
  };
}

function extractJson(textValue) {
  const trimmed = String(textValue || "").trim();
  if (!trimmed) throw new Error(text("modelEmpty"));
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function buildPrompt(location, days, budgetCaps) {
  const budgetHint = [
    text("promptBudgetLineTransport", { value: Math.round(budgetCaps.transport) }),
    text("promptBudgetLineHotel", { value: Math.round(budgetCaps.hotel) }),
    text("promptBudgetLineFood", { value: Math.round(budgetCaps.food) }),
    text("promptBudgetLineMisc", { value: Math.round(budgetCaps.misc) }),
  ].join("，");

  const validSpots = [];

  const spotsLine = validSpots.length
    ? text("promptReferenceSpots", { spots: validSpots.join("、") })
    : null;

  return [
    text("promptIntro"),
    text("promptLocation", { location }),
    text("promptDays", { days }),
    text("promptBudget", { budgetHint }),
    text("promptEconomy"),
    text("promptJsonOnly"),
    "{",
    '  "title": "string",',
    '  "summary": "string",',
    '  "bestSeason": "string",',
    '  "travelStyle": "string",',
    '  "prep": "string",',
    '  "audience": "string",',
    '  "departureAdvice": "string",',
    '  "tags": ["string"],',
    '  "foods": ["string"],',
    '  "hotels": ["string"],',
    '  "itinerary": [{ "theme": "string", "morning": "string", "afternoon": "string", "evening": "string" }],',
    '  "routes": [{ "day": 1, "title": "string", "steps": [{ "from": "string", "to": "string", "transport": "string", "line": "string", "duration": "string", "note": "string" }] }],',
    '  "spots": [{ "name": "string", "day": 1, "note": "string", "lat": 0, "lng": 0 }],',
    '  "budget": { "transport": "string", "hotel": "string", "food": "string", "misc": "string" },',
    '  "tips": ["string"]',
    "}",
  ].filter(Boolean).join("\n");
}

async function generateGuide(location, days, budgetCaps) {
  const baseUrl = (readEnv(["OPENAI_BASEURL", "baseurl"]) || "").replace(/\/+$/, "");
  const apiKey = readEnv(["OPENAI_APIKEY", "apikey"]);
  const modelName = readEnv(["OPENAI_MODELNAME", "modelname"]);
  if (!baseUrl || !apiKey || !modelName) throw new Error(text("missingModelEnv"));

  const prompt = buildPrompt(location, days, budgetCaps);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.45,
        messages: [
          { role: "system", content: text("systemPrompt") },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (error) {
    throw new Error(`Failed to reach model API (${baseUrl}/chat/completions). ${toErrorMessage(error)}`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || text("modelRequestFailed"));
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
    updatedAt: row.updated_at,
  };
}

async function ensureTemplateId(pool, guide) {
  const current = parseTemplateId(guide.templateId);
  if (current) return guide;
  const templateId = stableTemplateIdByKey(guide.key || "");
  const now = new Date().toISOString();
  await pool.query(`UPDATE guides SET template_id = $1, updated_at = $2 WHERE id = $3`, [templateId, now, guide.id]);
  return { ...guide, templateId, updatedAt: now };
}

async function listGuides(locationFilter) {
  const pool = await getPool();
  const values = [];
  const whereParts = [];

  if (locationFilter) {
    values.push(`%${locationFilter}%`);
    whereParts.push(`location ILIKE $${values.length}`);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
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

  const output = [];
  for (const row of rows) {
    const guide = await ensureTemplateId(pool, rowToGuide(row));
    output.push({ ...guide, source: "cache" });
  }
  return output;
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
      const guide = await ensureTemplateId(pool, rowToGuide(rows[0]));
      return { item: { ...guide, source: "cache" }, cached: true };
    }
  }

  const budgetCaps = await getBudgetGuidance(pool, location);
  const content = await generateGuide(location, days, budgetCaps);
  const now = new Date().toISOString();
  const id = buildGuideId();
  const templateId = randomTemplateId();
  const title = String(content.title || text("guideTitle", { location, days }));

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
      source: "generated",
    },
    cached: false,
  };
}

async function geocodeByQuery(query) {
  if (!query) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": GEOCODE_USER_AGENT,
      },
    });
    const data = await response.json().catch(() => []);
    if (!Array.isArray(data) || !data.length) return null;

    const item = data[0];
    return {
      lat: Number(item.lat),
      lng: Number(item.lon),
      name: String(item.display_name || ""),
    };
  } catch {
    return null;
  }
}

async function deleteGuide(id, password) {
  if (!DELETE_PASSWORD) return { ok: false, statusCode: 503, error: text("deletePasswordNotConfigured") };
  if (!password) return { ok: false, statusCode: 401, error: text("deletePasswordRequired") };
  if (password !== DELETE_PASSWORD) return { ok: false, statusCode: 403, error: text("deletePasswordInvalid") };

  const pool = await getPool();
  const result = await pool.query(`DELETE FROM guides WHERE id = $1`, [id]);
  return { ok: true, deleted: result.rowCount > 0 };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "travel-guide-generator" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      promotions: buildPromotions(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/geocode") {
    const query = String(url.searchParams.get("q") || "").trim();
    const city = String(url.searchParams.get("city") || "").trim();
    if (!query) {
      sendJson(res, 400, { error: text("geocodeQueryEmpty") });
      return;
    }

    const full = city && !query.includes(city) ? `${query} ${city}` : query;
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
      sendJson(res, 400, { error: text("locationEmpty") });
      return;
    }

    if (!Number.isInteger(days) || days < 1 || days > 14) {
      sendJson(res, 400, { error: text("daysInvalid") });
      return;
    }

    const result = await getOrCreateGuide(location, days, { useCache });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/guides/")) {
    const body = await readBody(req);
    const id = decodeURIComponent(url.pathname.slice("/api/guides/".length) || "").trim();
    const password = String(body.password || "");

    if (!id) {
      sendJson(res, 400, { error: text("idEmpty") });
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

  sendJson(res, 404, { error: text("apiRouteNotFound") });
}

async function handleStatic(res, url) {
  if (url.pathname === "/favicon.ico") {
    sendText(res, 204, "", "image/x-icon");
    return;
  }

  if (url.pathname === "/assets/vercel-analytics.mjs") {
    const script = await fs.readFile(VERCEL_ANALYTICS_FILE, "utf8");
    sendText(res, 200, script, "application/javascript; charset=utf-8");
    return;
  }

  if (url.pathname !== "/" && url.pathname !== "/index.html") {
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const candidate = path.resolve(ROOT, relativePath);
    const relativeToRoot = path.relative(ROOT, candidate);
    const escapesRoot = relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot);

    if (escapesRoot) {
      sendText(res, 404, text("notFound"), "text/plain; charset=utf-8");
      return;
    }

    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) {
        sendText(res, 404, text("notFound"), "text/plain; charset=utf-8");
        return;
      }

      const content = await fs.readFile(candidate);
      sendText(res, 200, content, getContentType(candidate));
      return;
    } catch {
      sendText(res, 404, text("notFound"), "text/plain; charset=utf-8");
      return;
    }
  }

  const html = await fs.readFile(INDEX_FILE, "utf8");
  sendText(res, 200, html, "text/html; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const isApi = url.pathname.startsWith("/api/");

  try {
    if (isApi) {
      await handleApi(req, res, url);
      return;
    }

    await handleStatic(res, url);
  } catch (error) {
    const message = toErrorMessage(error);
    console.error("[server-error]", message, error);
    if (isApi) {
      sendJson(res, 500, { error: message || text("internalServerError") });
      return;
    }
    sendText(res, 500, message || text("internalServerError"), "text/plain; charset=utf-8");
  }
});

function listenWithFallback(startPort, attempts = 10) {
  let currentPort = Number(startPort) || 3000;

  const tryListen = (remaining) => {
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" && remaining > 0) {
        const nextPort = currentPort + 1;
        console.warn(`[server] Port ${currentPort} is in use, retrying on ${nextPort}`);
        currentPort = nextPort;
        tryListen(remaining - 1);
        return;
      }
      throw error;
    });

    server.listen(currentPort, () => {
      console.log(text("startupLog", { port: currentPort }));
    });
  };

  tryListen(attempts);
}

listenWithFallback(PORT);

process.on("SIGINT", async () => {
  if (pgPool) await pgPool.end();
  process.exit(0);
});
