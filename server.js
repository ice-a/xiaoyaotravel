const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { randomUUID, createHash } = require("node:crypto");
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
const BOOKING_PROMO_TITLE = readEnv(["BOOKING_PROMO_TITLE", "booking_promo_title"]);
const BOOKING_PROMO_DESC = readEnv(["BOOKING_PROMO_DESC", "booking_promo_desc"]);
const BOOKING_PROMO_URL = readEnv(["BOOKING_PROMO_URL", "booking_promo_url"]);
const BOOKING_PROMO_CTA = readEnv(["BOOKING_PROMO_CTA", "booking_promo_cta"]);
const GETYOURGUIDE_PROMO_TITLE = readEnv(["GETYOURGUIDE_PROMO_TITLE", "getyourguide_promo_title"]);
const GETYOURGUIDE_PROMO_DESC = readEnv(["GETYOURGUIDE_PROMO_DESC", "getyourguide_promo_desc"]);
const GETYOURGUIDE_PROMO_URL = readEnv(["GETYOURGUIDE_PROMO_URL", "getyourguide_promo_url"]);
const GETYOURGUIDE_PROMO_CTA = readEnv(["GETYOURGUIDE_PROMO_CTA", "getyourguide_promo_cta"]);
const MEITUAN_PROMO_TITLE = readEnv(["MEITUAN_PROMO_TITLE", "meituan_promo_title"]);
const MEITUAN_PROMO_DESC = readEnv(["MEITUAN_PROMO_DESC", "meituan_promo_desc"]);
const MEITUAN_PROMO_URL = readEnv(["MEITUAN_PROMO_URL", "meituan_promo_url"]);
const MEITUAN_PROMO_CTA = readEnv(["MEITUAN_PROMO_CTA", "meituan_promo_cta"]);
const DATACARD_PROMO_TITLE = readEnv(["DATACARD_PROMO_TITLE", "datacard_promo_title"]);
const DATACARD_PROMO_DESC = readEnv(["DATACARD_PROMO_DESC", "datacard_promo_desc"]);
const DATACARD_PROMO_URL = readEnv(["DATACARD_PROMO_URL", "datacard_promo_url"]);
const DATACARD_PROMO_CTA = readEnv(["DATACARD_PROMO_CTA", "datacard_promo_cta"]);
const GEOCODE_USER_AGENT = readEnv(["GEOCODE_USER_AGENT", "geocode_user_agent"]) || "travel-guide-app/1.0";
const GYG_PARTNER_ID = "7JREU1P";

// ── Auth: SHA256 hash + user cache ──
function sha256(str) {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

const userCache = new Map(); // username -> { id, keyHash }
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCachedUser(username) {
  const entry = userCache.get(username);
  if (entry && Date.now() - entry.ts < USER_CACHE_TTL) return entry.user;
  userCache.delete(username);
  return null;
}

function setCachedUser(username, user) {
  userCache.set(username, { user, ts: Date.now() });
}

// Cleanup every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userCache) {
    if (now - entry.ts > USER_CACHE_TTL * 2) userCache.delete(key);
  }
}, 300000).unref();

async function authenticateUser(req) {
  const key = req.headers["x-user-key"];
  const username = req.headers["x-username"];
  if (!key || !username) return null;
  // Check memory cache first
  const cached = getCachedUser(String(username));
  if (cached && cached.key_hash === String(key)) return cached;
  // Fallback to DB
  try {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, username, nickname, key_hash FROM users WHERE username = $1 LIMIT 1`,
      [String(username)]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.key_hash !== String(key)) return null;
    const user = { id: row.id, username: row.username, nickname: row.nickname };
    setCachedUser(String(username), { ...user, key_hash: String(key) });
    return user;
  } catch { return null; }
}

// ── Simple in-memory rate limiter ──
const rateLimitStore = new Map();
function rateLimit(ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.resetAt > windowMs) {
    rateLimitStore.set(ip, { count: 1, resetAt: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}
// Cleanup rate limit store every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.resetAt > 120000) rateLimitStore.delete(key);
  }
}, 300000).unref();

// 高德地图 API configuration
const AMAP_API_KEY = readEnv(["AMAP_API_KEY", "amap_api_key"]) || "";
const AMAP_WEB_KEY = readEnv(["AMAP_WEB_KEY", "amap_web_key"]) || AMAP_API_KEY;

// Open-Meteo 天气 API（免费、无需 API Key）
// 文档: https://open-meteo.com/en/docs
const OPEN_METEO_API_BASE = "https://api.open-meteo.com/v1";
const GEOCODING_API_BASE = "https://geocoding-api.open-meteo.com/v1";

// WMO 天气现象代码 → 中文映射
const WMO_CODE_MAP = {
  0: "晴", 1: "晴", 2: "多云", 3: "阴",
  45: "雾", 48: "雾凇",
  51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪",
  80: "阵雨", 81: "强阵雨", 82: "暴雨",
  85: "阵雪", 86: "大阵雪",
  95: "雷暴", 96: "雷暴伴冰雹", 99: "大雷暴伴冰雹",
};

// 风向角度 → 中文方位（8方位）
function windDegToDirection(deg) {
  if (deg == null || isNaN(deg)) return "";
  const directions = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  const idx = Math.round(((Number(deg) % 360 + 360) % 360) / 45) % 8;
  return directions[idx];
}

// 风速(km/h) → 蒲福风级(0-12)
function windKmhToScale(kmh) {
  if (kmh == null || isNaN(kmh)) return "";
  const s = Number(kmh);
  if (s < 1) return "0";
  if (s < 6) return "1";
  if (s < 12) return "2";
  if (s < 20) return "3";
  if (s < 29) return "4";
  if (s < 39) return "5";
  if (s < 50) return "6";
  if (s < 62) return "7";
  if (s < 75) return "8";
  if (s < 89) return "9";
  if (s < 103) return "10";
  if (s < 118) return "11";
  return "12";
}

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
  weatherApiNotConfigured: "天气服务暂时不可用。",
  weatherLocationNotFound: "无法找到指定位置，请尝试更具体的城市名。",
  weatherApiFailed: "获取天气数据失败。",
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
  promptStyle: ({ style }) => `旅行风格偏好：${style}。请根据该风格重点推荐相关景点和活动。`,
  promptBudgetLevel: ({ level }) => {
    const map = {
      "穷游": "用户预算非常有限，请优先推荐免费景点、公共交通、经济型住宿和路边摊美食，尽量压缩总花费。",
      "经济": "用户偏好经济实惠的方案，请推荐性价比高的选择，避免不必要的高消费。",
      "舒适": "用户追求舒适体验但不过度消费，请推荐品质适中、体验好的方案。",
      "豪华": "用户预算充裕，请推荐高品质酒店、精品餐厅和深度体验项目，不用太在意价格。",
    };
    return map[level] || "";
  },
  promptTravelers: ({ travelers }) => {
    const map = {
      "1": "独自出行，推荐适合单人游览的景点，注意安全和社交便利。",
      "2": "情侣/双人出行，推荐浪漫氛围的场所和双人活动。",
      "3-4": "家庭/小团出游（3-4人），注意行程适合老人小孩，推荐家庭友好型活动。",
      "5+": "朋友团（5人+），推荐适合团体参与的活动，注意交通和用餐安排。",
    };
    return map[travelers] || "";
  },
  promptBudgetModeEconomy: "## 预算模式：经济版\n请生成极致省钱方案：优先免费景点、公共交通、经济型住宿（青旅/快捷酒店）、路边摊和本地小吃。总预算控制在最低范围。",
  promptBudgetModeComfort: "## 预算模式：舒适版\n请生成品质体验方案：推荐中高档酒店、精品餐厅、深度体验项目（如包车一日游、私人导游）。不用太在意价格，注重体验和舒适度。",
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

  // Parse legacy JSON promotions for backward compatibility
  parsePromotions(PROMOTIONS_JSON).forEach(pushPromo);

  // Add individual promotions if configured
  if (BOOKING_PROMO_URL) {
    promotions.push({
      id: "booking",
      title: BOOKING_PROMO_TITLE || "Booking.com 酒店预订",
      subtitle: BOOKING_PROMO_DESC || "全球海量酒店，低价保障",
      url: BOOKING_PROMO_URL,
      ctaText: BOOKING_PROMO_CTA || "立即查看"
    });
  }

  if (GETYOURGUIDE_PROMO_URL) {
    promotions.push({
      id: "getyourguide",
      title: GETYOURGUIDE_PROMO_TITLE || "GetYourGuide 景点玩乐",
      subtitle: GETYOURGUIDE_PROMO_DESC || "发现当地热门体验和景点门票",
      url: GETYOURGUIDE_PROMO_URL,
      ctaText: GETYOURGUIDE_PROMO_CTA || "立即探索"
    });
  }

  if (MEITUAN_PROMO_URL) {
    promotions.push({
      id: "meituan",
      title: MEITUAN_PROMO_TITLE || "美团美食",
      subtitle: MEITUAN_PROMO_DESC || "本地美食优惠，外卖团购一应俱全",
      url: MEITUAN_PROMO_URL,
      ctaText: MEITUAN_PROMO_CTA || "查看美食"
    });
  }

  if (DATACARD_PROMO_URL) {
    promotions.push({
      id: "datacard",
      title: DATACARD_PROMO_TITLE || "境外流量卡",
      subtitle: DATACARD_PROMO_DESC || "出国旅游必备，高速流量不限量",
      url: DATACARD_PROMO_URL,
      ctaText: DATACARD_PROMO_CTA || "了解详情"
    });
  }

  return promotions;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function sanitizePostgresUrl(url) {
  if (!url) return url;
  try {
    // Node.js pg 库不支持 channel_binding 参数，需要移除
    const parsed = new URL(url);
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    // 若 URL 解析失败则原样返回
    return url;
  }
}

async function getPool() {
  if (!POSTGRES_URL) throw new Error(text("missingPostgres"));

  if (!pgPool) {
    const safeUrl = sanitizePostgresUrl(POSTGRES_URL);
    pgPool = new Pool({ connectionString: safeUrl, ssl: { rejectUnauthorized: false } });
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

      // User tables
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          key_hash TEXT NOT NULL,
          nickname TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ
        );
      `);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS user_favorites (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, guide_id)
        );
      `);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS user_checkins (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
          slot_key TEXT NOT NULL,
          checked BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, guide_id, slot_key)
        );
      `);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS guide_ratings (
          id SERIAL PRIMARY KEY,
          guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(guide_id, user_id)
        );
      `);
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
    // 天气数据透传（不参与 normalize，仅透传给前端展示）
    _weather: payload._weather || null,
  };
}

function extractJson(textValue) {
  const trimmed = String(textValue || "").trim();
  if (!trimmed) throw new Error(text("modelEmpty"));
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function buildPrompt(location, days, budgetCaps, weatherData, preferences = {}) {
  const budgetHint = [
    text("promptBudgetLineTransport", { value: Math.round(budgetCaps.transport) }),
    text("promptBudgetLineHotel", { value: Math.round(budgetCaps.hotel) }),
    text("promptBudgetLineFood", { value: Math.round(budgetCaps.food) }),
    text("promptBudgetLineMisc", { value: Math.round(budgetCaps.misc) }),
  ].join("，");

  // 格式化天气摘要注入 prompt
  let weatherHint = "";
  if (weatherData && Array.isArray(weatherData.daily) && weatherData.daily.length) {
    const lines = ["## 目的地天气预报（未来7天）"];
    weatherData.daily.slice(1, 8).forEach(day => {
      const temp = `${day.tempMin}°~${day.tempMax}°`;
      const rain = Number(day.precip || 0) > 0 ? ` 降水${day.precip}mm` : "";
      const uv = Number(day.uvIndex || 0) >= 3 ? ` 紫外线强(UV${day.uvIndex})` : "";
      const wind = day.windScaleDay ? ` ${day.windDirDay || ""}${day.windScaleDay}级` : "";
      lines.push(`- ${day.date}：${day.textDay || day.textNight || "未知"} ${temp}${wind}${rain}${uv}`);
    });
    weatherHint = lines.join("\n");
  }

  // 用户偏好注入
  const prefLines = [];
  if (preferences.style) prefLines.push(text("promptStyle", { style: preferences.style }));
  if (preferences.budgetLevel) prefLines.push(text("promptBudgetLevel", { level: preferences.budgetLevel }));
  if (preferences.travelers) prefLines.push(text("promptTravelers", { travelers: preferences.travelers }));
  if (preferences.budgetMode === "economy") prefLines.push(TEXT.promptBudgetModeEconomy);
  if (preferences.budgetMode === "comfort") prefLines.push(TEXT.promptBudgetModeComfort);
  const preferencesHint = prefLines.length ? "\n## 用户偏好\n" + prefLines.join("\n") : "";

  return [
    text("promptIntro"),
    text("promptLocation", { location }),
    text("promptDays", { days }),
    text("promptBudget", { budgetHint }),
    text("promptEconomy"),
    weatherHint,
    preferencesHint,
    "## 内容要求",
    "请生成一份实用、详细、可执行的旅行攻略，要求如下：",
    "1. **行程安排**：每天上午/下午/晚上必须填写具体景点名称（不是泛泛描述），并给出时间估算，例如「09:00-12:00 游览西湖苏堤」",
    "2. **美食推荐**：给出具体店铺名或菜系风格，不要只写「当地美食」，例如「知味观（百年老店，招牌小笼）」",
    "3. **住宿建议**：给出具体区域或参考酒店档次，例如「建议住西湖区快捷酒店，约200-300元/晚」",
    "4. **贴士（tips）**：结合当地实际情况，给出防坑提醒、预约规则、避雷建议，例如「故宫需提前7天在官网实名预约，周一闭馆」",
    "5. **天气相关**：根据上面的天气预报，合理安排行程（如雨天优先安排室内景点、夏季避开中午高温时段户外游览）",
    "6. **路线（routes）**：steps 中的 from/to 填写具体地点名，duration 填写具体时间（如「步行20分钟」或「地铁25分钟」），note 填写换乘注意事项",
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

async function generateGuide(location, days, budgetCaps, weatherData, preferences) {
  const baseUrl = (readEnv(["OPENAI_BASEURL", "baseurl"]) || "").replace(/\/+$/, "");
  const apiKey = readEnv(["OPENAI_APIKEY", "apikey"]);
  const modelName = readEnv(["OPENAI_MODELNAME", "modelname"]);
  if (!baseUrl || !apiKey || !modelName) throw new Error(text("missingModelEnv"));

  const prompt = buildPrompt(location, days, budgetCaps, weatherData, preferences);

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
  const preferences = {
    style: String(options.style || "").trim(),
    budgetLevel: String(options.budgetLevel || "").trim(),
    travelers: String(options.travelers || "").trim(),
    budgetMode: String(options.budgetMode || "").trim(),
  };
  const hasPreferences = preferences.style || preferences.budgetLevel || preferences.travelers || preferences.budgetMode;

  if (useCache && !hasPreferences) {
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

  // 先获取天气数据，融合到 AI Prompt（Open-Meteo 免费无需 Key）
  let weatherData = null;
  try {
    weatherData = await getWeatherData(location);
  } catch (err) {
    console.warn("[weather-warn] 无法获取天气数据，将继续生成攻略：", err.message);
  }

  const budgetCaps = await getBudgetGuidance(pool, location);
  const content = await generateGuide(location, days, budgetCaps, weatherData, preferences);
  // Attach preferences to content for display
  content._preferences = preferences;
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

  // 使用 Open-Meteo Geocoding API（支持中文搜索）
  const url = `${GEOCODING_API_BASE}/search?name=${encodeURIComponent(query.trim())}&count=1&language=zh&format=json`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
      const item = data.results[0];
      return {
        lat: Number(item.latitude),
        lng: Number(item.longitude),
        name: String(item.name || query),
      };
    }
  } catch (err) {
    console.warn("[geocode-warn] Open-Meteo Geocoding 失败，尝试 Nominatim fallback:", err.message);
  }

  // Fallback: OpenStreetMap Nominatim（对中文支持较差，但作为兜底保留）
  const variants = [query.trim()];
  const t = query.trim();
  if (!t.includes("市") && !t.includes("县") && !t.includes("区")) {
    variants.push(`${t}市`, `${t}市 中国`);
  }
  if (!t.includes("中国") && !t.includes("China")) {
    variants.push(`${t} 中国`);
  }

  for (const q of variants) {
    const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    try {
      const response = await fetch(fallbackUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": GEOCODE_USER_AGENT,
        },
      });
      const data = await response.json().catch(() => []);
      if (Array.isArray(data) && data.length) {
        const item = data[0];
        return {
          lat: Number(item.lat),
          lng: Number(item.lon),
          name: String(item.display_name || ""),
        };
      }
    } catch {
      // fall through
    }
  }

  return null;
}

async function getWeatherData(location) {
  // Step 1: 地理编码获取坐标（Open-Meteo Geocoding，支持中文）
  const geoData = await geocodeByQuery(location);
  if (!geoData) {
    throw new Error(`${text("weatherLocationNotFound")}: ${location}`);
  }

  const { lat, lng } = geoData;

  // Step 2: 调用 Open-Meteo 7天预报 API（免费、无需 Key）
  const weatherUrl = `${OPEN_METEO_API_BASE}/forecast?latitude=${lat}&longitude=${lng}`
    + `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,windspeed_10m_max,winddirection_10m_dominant,uv_index_max,relative_humidity_2m_max`
    + `&timezone=auto&forecast_days=7`;

  const response = await fetch(weatherUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`天气API请求失败 (HTTP ${response.status})`);
  }

  const weatherData = await response.json();

  if (!weatherData.daily || !weatherData.daily.time || !weatherData.daily.time.length) {
    throw new Error("天气数据为空");
  }

  // Step 3: 将 Open-Meteo 格式转换为原有前端兼容格式
  const daily = weatherData.daily;
  return {
    location: {
      name: location,
      lat,
      lng,
    },
    updateTime: new Date().toISOString(),
    daily: daily.time.map((date, i) => ({
      date: date,
      tempMax: daily.temperature_2m_max[i],
      tempMin: daily.temperature_2m_min[i],
      textDay: WMO_CODE_MAP[daily.weather_code[i]] || "未知",
      textNight: WMO_CODE_MAP[daily.weather_code[i]] || "未知",
      windDirDay: windDegToDirection(daily.winddirection_10m_dominant[i]),
      windScaleDay: windKmhToScale(daily.windspeed_10m_max[i]),
      humidity: daily.relative_humidity_2m_max[i] ?? null,
      precip: daily.precipitation_sum[i],
      uvIndex: daily.uv_index_max[i] ?? null,
    })),
  };
}

/**
 * 高德地图路线规划：获取两点间真实交通时间和路线
 * 文档：https://lbs.amap.com/api/webservice/guide/api/direction
 */
async function amapGeocode(address, city) {
  if (!AMAP_WEB_KEY) return null;
  const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&city=${encodeURIComponent(city || "")}&key=${AMAP_WEB_KEY}&output=JSON`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "1" && data.geocodes && data.geocodes.length) {
      const loc = data.geocodes[0].location; // "lng,lat"
      const [lng, lat] = loc.split(",").map(Number);
      return { lng, lat, formattedAddress: data.geocodes[0].formatted_address };
    }
  } catch (err) {
    console.warn("[amap-geocode] failed:", err.message);
  }
  return null;
}

async function amapDirection(origin, destination, mode) {
  if (!AMAP_WEB_KEY) return null;
  const originStr = `${origin.lng},${origin.lat}`;
  const destStr = `${destination.lng},${destination.lat}`;

  // mode: 1=公交, 0=驾车, 2=步行, 3=骑行
  const strategy = mode === "1" ? "0" : ""; // 公交：最快
  const url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${originStr}&destination=${destStr}&city=&strategy=${strategy}&key=${AMAP_WEB_KEY}&output=JSON&extensions=base`;

  try {
    if (mode === "1") {
      // 公交/地铁
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === "1" && data.route && data.route.transits && data.route.transits.length) {
        const transit = data.route.transits[0];
        const durationMin = Math.round(Number(transit.duration) / 60);
        const segments = (transit.segments || []).map(seg => {
          const walking = seg.walking;
          const bus = seg.bus;
          const parts = [];
          if (walking && walking.distance && Number(walking.distance) > 0) {
            parts.push(`步行${Math.round(Number(walking.distance))}米`);
          }
          if (bus && bus.buslines && bus.buslines.length) {
            const line = bus.buslines[0];
            parts.push(line.name || line.passname || "公交");
          }
          return parts.join(" → ");
        }).filter(Boolean);
        return {
          duration: `${durationMin}分钟`,
          distance: data.route.distance ? `${(Number(data.route.distance) / 1000).toFixed(1)}公里` : "",
          mode: "公交/地铁",
          steps: segments,
          cost: transit.cost ? `${transit.cost}元` : "",
        };
      }
    }
    // 驾车作为 fallback
    const driveUrl = `https://restapi.amap.com/v3/direction/driving?origin=${originStr}&destination=${destStr}&key=${AMAP_WEB_KEY}&output=JSON`;
    const response = await fetch(driveUrl);
    const data = await response.json();
    if (data.status === "1" && data.route && data.route.paths && data.route.paths.length) {
      const path = data.route.paths[0];
      const durationMin = Math.round(Number(path.duration) / 60);
      const taxiCost = path.taxi_cost || "";
      return {
        duration: `${durationMin}分钟`,
        distance: `${(Number(path.distance) / 1000).toFixed(1)}公里`,
        mode: "驾车",
        steps: (path.steps || []).slice(0, 3).map(s => s.instruction || "").filter(Boolean),
        cost: taxiCost ? `${taxiCost}元` : "",
      };
    }
  } catch (err) {
    console.warn("[amap-direction] failed:", err.message);
  }
  return null;
}

async function getRealtimeRoute(fromName, toName, cityName) {
  if (!AMAP_WEB_KEY) return null;

  // 并行地理编码
  const [origin, destination] = await Promise.all([
    amapGeocode(fromName, cityName),
    amapGeocode(toName, cityName),
  ]);

  if (!origin || !destination) return null;

  // 优先公交/地铁，fallback 驾车
  const transit = await amapDirection(origin, destination, "1");
  if (transit) return transit;

  const driving = await amapDirection(origin, destination, "0");
  return driving;
}

async function deleteGuide(id, password) {
  if (!DELETE_PASSWORD) return { ok: false, statusCode: 503, error: text("deletePasswordNotConfigured") };
  if (!password) return { ok: false, statusCode: 401, error: text("deletePasswordRequired") };
  if (password !== DELETE_PASSWORD) return { ok: false, statusCode: 403, error: text("deletePasswordInvalid") };

  const pool = await getPool();
  const result = await pool.query(`DELETE FROM guides WHERE id = $1`, [id]);
  return { ok: true, deleted: result.rowCount > 0 };
}

// Exchange rate cache (refresh every hour)
let exchangeRateCache = { data: null, fetchedAt: 0 };
const EXCHANGE_RATE_TTL = 3600000; // 1 hour

async function getExchangeRates() {
  const now = Date.now();
  if (exchangeRateCache.data && now - exchangeRateCache.fetchedAt < EXCHANGE_RATE_TTL) {
    return exchangeRateCache.data;
  }
  try {
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/CNY");
    if (!response.ok) throw new Error(`Exchange API returned ${response.status}`);
    const data = await response.json();
    if (data?.rates) {
      exchangeRateCache = { data: data.rates, fetchedAt: now };
      return data.rates;
    }
  } catch (err) {
    console.warn("[exchange-rate] failed:", err.message);
  }
  return exchangeRateCache.data || null;
}

// Common overseas destinations mapped to currency codes
const DESTINATION_CURRENCY_MAP = {
  "东京": "JPY", "大阪": "JPY", "京都": "JPY", "北海道": "JPY", "冲绳": "JPY", "日本": "JPY",
  "首尔": "KRW", "釜山": "KRW", "济州": "KRW", "韩国": "KRW",
  "曼谷": "THB", "清迈": "THB", "普吉": "THB", "芭提雅": "THB", "泰国": "THB",
  "新加坡": "SGD",
  "吉隆坡": "MYR", "槟城": "MYR", "马来西亚": "MYR",
  "巴厘岛": "IDR", "印尼": "IDR",
  "河内": "VND", "胡志明": "VND", "越南": "VND",
  "马尼拉": "PHP", "长滩岛": "PHP", "菲律宾": "PHP",
  "纽约": "USD", "洛杉矶": "USD", "旧金山": "USD", "拉斯维加斯": "USD", "夏威夷": "USD", "美国": "USD",
  "伦敦": "GBP", "爱丁堡": "GBP", "英国": "GBP",
  "巴黎": "EUR", "罗马": "EUR", "米兰": "EUR", "巴塞罗那": "EUR", "柏林": "EUR", "欧洲": "EUR", "法国": "EUR", "意大利": "EUR", "西班牙": "EUR", "德国": "EUR",
  "悉尼": "AUD", "墨尔本": "AUD", "澳大利亚": "AUD", "澳洲": "AUD",
  "奥克兰": "NZD", "新西兰": "NZD",
  "迪拜": "AED", "阿联酋": "AED",
  "马尔代夫": "MVR",
  "斯里兰卡": "LKR",
  "尼泊尔": "NPR",
  "柬埔寨": "KHR", "金边": "KHR", "暹粒": "KHR",
  "老挝": "LAK", "琅勃拉邦": "LAK",
  "缅甸": "MMK",
  "文莱": "BND",
  "斐济": "FJD",
};

const CURRENCY_SYMBOLS = {
  "JPY": "¥", "KRW": "₩", "THB": "฿", "SGD": "S$", "MYR": "RM", "IDR": "Rp",
  "VND": "₫", "PHP": "₱", "USD": "$", "GBP": "£", "EUR": "€", "AUD": "A$",
  "NZD": "NZ$", "AED": "د.إ", "MVR": "Rf", "LKR": "Rs", "NPR": "Rs",
  "KHR": "៛", "LAK": "₭", "MMK": "K", "BND": "B$", "FJD": "FJ$",
};

function detectCurrency(location) {
  if (!location) return null;
  const loc = String(location).trim();
  // Direct match
  if (DESTINATION_CURRENCY_MAP[loc]) return DESTINATION_CURRENCY_MAP[loc];
  // Partial match
  for (const [key, currency] of Object.entries(DESTINATION_CURRENCY_MAP)) {
    if (loc.includes(key) || key.includes(loc)) return currency;
  }
  return null;
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
    // Rate limiting: 5 requests per minute per IP
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(clientIp, 5, 60000)) {
      sendJson(res, 429, { error: "请求过于频繁，请稍后再试（每分钟最多5次生成请求）" });
      return;
    }
    const body = await readBody(req);
    const location = String(body.location || "").trim();
    const days = Number(body.days);
    const useCache = body.useCache !== false;
    const style = String(body.style || "").trim();
    const budgetLevel = String(body.budgetLevel || "").trim();
    const travelers = String(body.travelers || "").trim();
    const budgetMode = String(body.budgetMode || "").trim();

    if (!location) {
      sendJson(res, 400, { error: text("locationEmpty") });
      return;
    }

    if (!Number.isInteger(days) || days < 1 || days > 14) {
      sendJson(res, 400, { error: text("daysInvalid") });
      return;
    }

    const result = await getOrCreateGuide(location, days, { useCache, style, budgetLevel, travelers, budgetMode });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/guides/") && !url.pathname.includes("/rate")) {
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

  // Update guide content (edit mode)
  if (req.method === "PATCH" && url.pathname.match(/^\/api\/guides\/[^/]+$/) && !url.pathname.includes("/rate")) {
    const id = decodeURIComponent(url.pathname.slice("/api/guides/".length) || "").trim();
    if (!id) {
      sendJson(res, 400, { error: "id 不能为空" });
      return;
    }
    const body = await readBody(req);
    const newContent = body.content;
    if (!newContent || typeof newContent !== "object") {
      sendJson(res, 400, { error: "content 对象不能为空" });
      return;
    }
    try {
      const pool = await getPool();
      const { rows } = await pool.query(
        `SELECT content FROM guides WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!rows.length) {
        sendJson(res, 404, { error: "未找到该攻略" });
        return;
      }
      // Merge: keep existing fields, overlay with new ones
      const existing = rows[0].content || {};
      const merged = { ...existing, ...newContent, _rating: existing._rating, _weather: existing._weather, _preferences: existing._preferences };
      await pool.query(
        `UPDATE guides SET content = $1::jsonb, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(merged), new Date().toISOString(), id]
      );
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error("[patch-error]", error);
      sendJson(res, 500, { error: "保存失败" });
    }
    return;
  }

  // Rate a guide
  if (req.method === "POST" && url.pathname.match(/^\/api\/guides\/[^/]+\/rate$/)) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/guides\//, "").replace(/\/rate$/, "") || "").trim();
    if (!id) {
      sendJson(res, 400, { error: "id 不能为空" });
      return;
    }
    const body = await readBody(req);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      sendJson(res, 400, { error: "rating 必须是 1-5 的整数" });
      return;
    }
    try {
      const pool = await getPool();
      const { rows } = await pool.query(
        `SELECT content FROM guides WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!rows.length) {
        sendJson(res, 404, { error: "未找到该攻略" });
        return;
      }
      const content = rows[0].content || {};
      content._rating = { value: rating, ratedAt: new Date().toISOString() };
      await pool.query(
        `UPDATE guides SET content = $1::jsonb, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(content), new Date().toISOString(), id]
      );
      sendJson(res, 200, { ok: true, rating });
    } catch (error) {
      console.error("[rate-error]", error);
      sendJson(res, 500, { error: "评分失败" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/share/")) {
    await handleShare(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/weather") {
    const location = String(url.searchParams.get("location") || "").trim();
    if (!location) {
      sendJson(res, 400, { error: "location 参数不能为空" });
      return;
    }

    try {
      const weatherData = await getWeatherData(location);
      sendJson(res, 200, weatherData);
    } catch (error) {
      console.error("[weather-api-error]", error);
      sendJson(res, 500, { error: `${text("weatherApiFailed")}: ${error.message}` });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/route") {
    const from = String(url.searchParams.get("from") || "").trim();
    const to = String(url.searchParams.get("to") || "").trim();
    const city = String(url.searchParams.get("city") || "").trim();

    if (!from || !to) {
      sendJson(res, 400, { error: "from 和 to 参数不能为空" });
      return;
    }

    if (!AMAP_WEB_KEY) {
      sendJson(res, 503, { error: "服务器未配置高德地图 API Key。请在 .env 中设置 AMAP_API_KEY。" });
      return;
    }

    try {
      const route = await getRealtimeRoute(from, to, city);
      if (!route) {
        sendJson(res, 200, { available: false, message: "未能获取路线信息，使用 AI 估算路线。" });
        return;
      }
      sendJson(res, 200, { available: true, ...route });
    } catch (error) {
      console.error("[route-api-error]", error);
      sendJson(res, 500, { error: `路线查询失败: ${error.message}` });
    }
    return;
  }

  // Exchange rate API
  if (req.method === "GET" && url.pathname === "/api/exchange-rate") {
    try {
      const rates = await getExchangeRates();
      if (!rates) {
        sendJson(res, 503, { error: "汇率数据暂时不可用" });
        return;
      }
      const location = String(url.searchParams.get("location") || "").trim();
      const targetCurrency = String(url.searchParams.get("currency") || "").trim() || detectCurrency(location);
      if (!targetCurrency || !rates[targetCurrency]) {
        sendJson(res, 200, { available: false, currency: null, message: "无法识别目标货币" });
        return;
      }
      const rate = rates[targetCurrency];
      const symbol = CURRENCY_SYMBOLS[targetCurrency] || targetCurrency;
      sendJson(res, 200, { available: true, currency: targetCurrency, symbol, rate, location });
    } catch (error) {
      console.error("[exchange-error]", error);
      sendJson(res, 500, { error: "获取汇率失败" });
    }
    return;
  }

  // Dynamic OG image generation
  if (req.method === "GET" && url.pathname === "/api/og-image") {
    const guideId = String(url.searchParams.get("id") || "").trim();
    if (!guideId) {
      sendJson(res, 400, { error: "id 参数不能为空" });
      return;
    }

    try {
      const pool = await getPool();
      const { rows } = await pool.query(
        `SELECT location, days, title, content FROM guides WHERE id = $1 LIMIT 1`,
        [guideId]
      );

      if (!rows.length) {
        sendText(res, 404, "Not Found", "text/plain");
        return;
      }

      const row = rows[0];
      const location = row.location || "";
      const days = row.days || 0;
      const title = row.title || `${location}${days}天旅游攻略`;
      const content = row.content || {};
      const summary = String(content.summary || "").slice(0, 60);
      const tags = Array.isArray(content.tags) ? content.tags.slice(0, 3) : [];

      // Generate SVG-based OG image
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0d9488;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0f766e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" rx="0"/>
  <rect x="0" y="0" width="1200" height="630" fill="rgba(0,0,0,0.15)" rx="0"/>
  <text x="80" y="100" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,0.7)">AI Travel Guide Generator</text>
  <text x="80" y="180" font-family="sans-serif" font-size="48" font-weight="bold" fill="#ffffff">${escapeXml(title)}</text>
  <text x="80" y="240" font-family="sans-serif" font-size="20" fill="rgba(255,255,255,0.85)">${escapeXml(summary)}${summary.length >= 60 ? "..." : ""}</text>
  <text x="80" y="310" font-family="sans-serif" font-size="18" fill="rgba(255,255,255,0.6)">${escapeXml(location)} · ${days}天</text>
  ${tags.map((tag, i) => `<rect x="${80 + i * 120}" y="340" width="100" height="32" rx="16" fill="rgba(255,255,255,0.2)"/>
  <text x="${130 + i * 120}" y="362" font-family="sans-serif" font-size="14" fill="#ffffff" text-anchor="middle">${escapeXml(tag)}</text>`).join("\n  ")}
  <text x="80" y="590" font-family="sans-serif" font-size="14" fill="rgba(255,255,255,0.4)">travelguide.example.com</text>
</svg>`;

      sendText(res, 200, svg, "image/svg+xml");
    } catch (error) {
      console.error("[og-image-error]", error);
      sendText(res, 500, "Error generating OG image", "text/plain");
    }
    return;
  }

  // ══════════════════════════════════════
  // Auth & User System
  // ══════════════════════════════════════

  // POST /api/auth/login — username + key login (auto-register on first use)
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const key = String(body.key || "").trim();
    if (!username || !key) {
      sendJson(res, 400, { error: "用户名和密钥不能为空" });
      return;
    }
    try {
      const pool = await getPool();
      const keyHash = sha256(key);
      let { rows } = await pool.query(
        `SELECT id, username, nickname FROM users WHERE username = $1 LIMIT 1`,
        [username]
      );
      if (!rows.length) {
        // Auto-register new user
        const id = randomUUID();
        await pool.query(
          `INSERT INTO users (id, username, key_hash, nickname) VALUES ($1, $2, $3, $4)`,
          [id, username, keyHash, username]
        );
        rows = [{ id, username, nickname: username }];
      } else {
        // Verify key hash
        const existing = await pool.query(`SELECT key_hash FROM users WHERE username = $1`, [username]);
        if (existing.rows[0].key_hash !== keyHash) {
          sendJson(res, 401, { error: "密钥不正确" });
          return;
        }
        // Update last_login_at
        await pool.query(`UPDATE users SET last_login_at = NOW() WHERE username = $1`, [username]);
      }
      const user = rows[0];
      setCachedUser(username, { ...user, keyHash });
      sendJson(res, 200, { ok: true, user: { id: user.id, username: user.username, nickname: user.nickname } });
    } catch (error) {
      console.error("[auth-login-error]", error);
      sendJson(res, 500, { error: text("internalServerError") });
    }
    return;
  }

  // GET /api/auth/me — verify current session
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await authenticateUser(req);
    if (!user) {
      sendJson(res, 401, { error: "未登录或会话已过期", authenticated: false });
      return;
    }
    sendJson(res, 200, { ok: true, user, authenticated: true });
    return;
  }

  // GET /api/user/profile — aggregated user profile
  if (req.method === "GET" && url.pathname === "/api/user/profile") {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    try {
      const pool = await getPool();
      const [userRes, favRes, chkRes, rateRes] = await Promise.all([
        pool.query(`SELECT created_at FROM users WHERE id = $1`, [user.id]),
        pool.query(`
          SELECT f.id, f.guide_id, f.created_at, g.title, g.location, g.days
          FROM user_favorites f JOIN guides g ON f.guide_id = g.id
          WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 50
        `, [user.id]),
        pool.query(`
          SELECT COUNT(*)::int as total,
                 COUNT(DISTINCT guide_id)::int as guides_checked
          FROM user_checkins WHERE user_id = $1 AND checked = true
        `, [user.id]),
        pool.query(`
          SELECT COUNT(*)::int as total, COALESCE(AVG(rating), 0)::numeric(3,1) as avg_rating
          FROM guide_ratings WHERE user_id = $1
        `, [user.id])
      ]);
      const userData = { ...user, created_at: userRes.rows[0]?.created_at };
      sendJson(res, 200, {
        user: userData,
        favorites: favRes.rows,
        checkins: { total: chkRes.rows[0].total, guidesChecked: chkRes.rows[0].guides_checked },
        ratings: { total: rateRes.rows[0].total, avgRating: Number(rateRes.rows[0].avg_rating) },
      });
    } catch (error) {
      console.error("[profile-error]", error);
      sendJson(res, 500, { error: "获取用户信息失败" });
    }
    return;
  }

  // PUT /api/user/nickname — update user nickname
  if (req.method === "PUT" && url.pathname === "/api/user/nickname") {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    try {
      const body = await readBody(req);
      const nickname = String(body.nickname || "").trim().slice(0, 20);
      if (!nickname) { sendJson(res, 400, { error: "昵称不能为空" }); return; }
      const pool = await getPool();
      await pool.query(`UPDATE users SET nickname = $1 WHERE id = $2`, [nickname, user.id]);
      sendJson(res, 200, { ok: true, nickname });
    } catch (error) {
      console.error("[nickname-update-error]", error);
      sendJson(res, 500, { error: "修改昵称失败" });
    }
    return;
  }

  // ── Favorites CRUD ──

  // GET /api/user/favorites — list user's favorites
  if (req.method === "GET" && url.pathname === "/api/user/favorites") {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    try {
      const pool = await getPool();
      const { rows } = await pool.query(
        `SELECT f.guide_id, f.created_at, g.title, g.location, g.days
         FROM user_favorites f LEFT JOIN guides g ON f.guide_id = g.id
         WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
        [user.id]
      );
      sendJson(res, 200, { items: rows.map(r => ({ guideId: r.guide_id, title: r.title, location: r.location, days: r.days, createdAt: r.created_at })) });
    } catch (error) {
      console.error("[fav-list-error]", error);
      sendJson(res, 500, { error: "获取收藏列表失败" });
    }
    return;
  }

  // POST /api/user/favorites — add favorite
  if (req.method === "POST" && url.pathname === "/api/user/favorites") {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    const body = await readBody(req);
    const guideId = String(body.guideId || body.guide_id || "").trim();
    if (!guideId) { sendJson(res, 400, { error: "缺少 guideId" }); return; }
    try {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO user_favorites (user_id, guide_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, guideId]
      );
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error("[fav-add-error]", error);
      sendJson(res, 500, { error: "收藏失败" });
    }
    return;
  }

  // DELETE /api/user/favorites/:guideId — remove favorite
  if (req.method === "DELETE" && url.pathname.startsWith("/api/user/favorites/")) {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    const guideId = decodeURIComponent(url.pathname.slice("/api/user/favorites/".length)).trim();
    if (!guideId) { sendJson(res, 400, { error: "缺少 guideId" }); return; }
    try {
      const pool = await getPool();
      const result = await pool.query(`DELETE FROM user_favorites WHERE user_id = $1 AND guide_id = $2`, [user.id, guideId]);
      sendJson(res, 200, { ok: true, removed: result.rowCount > 0 });
    } catch (error) {
      console.error("[fav-del-error]", error);
      sendJson(res, 500, { error: "取消收藏失败" });
    }
    return;
  }

  // ── Check-ins ──

  // POST /api/user/checkins — toggle checkin
  if (req.method === "POST" && url.pathname === "/api/user/checkins") {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    const body = await readBody(req);
    const guideId = String(body.guideId || body.guide_id || "").trim();
    const slotKey = String(body.slotKey || body.slot_key || "").trim();
    if (!guideId || !slotKey) { sendJson(res, 400, { error: "缺少 guideId 或 slotKey" }); return; }
    try {
      const pool = await getPool();
      // Check current state
      const { rows } = await pool.query(
        `SELECT checked FROM user_checkins WHERE user_id = $1 AND guide_id = $2 AND slot_key = $3`,
        [user.id, guideId, slotKey]
      );
      const newState = rows.length ? !rows[0].checked : true;
      await pool.query(`
        INSERT INTO user_checkins (user_id, guide_id, slot_key, checked, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, guide_id, slot_key)
        DO UPDATE SET checked = $4, updated_at = NOW()
      `, [user.id, guideId, slotKey, newState]);
      sendJson(res, 200, { ok: true, checked: newState });
    } catch (error) {
      console.error("[checkin-error]", error);
      sendJson(res, 500, { error: "打卡操作失败" });
    }
    return;
  }

  // GET /api/user/checkins/:guideId — get checkins for a guide
  if (req.method === "GET" && url.pathname.match(/^\/api\/user\/checkins\/[^/]+$/)) {
    const user = await authenticateUser(req);
    if (!user) { sendJson(res, 401, { error: "请先登录" }); return; }
    const guideId = decodeURIComponent(url.pathname.slice("/api/user/checkins/".length)).trim();
    if (!guideId) { sendJson(res, 400, { error: "缺少 guideId" }); return; }
    try {
      const pool = await getPool();
      const { rows } = await pool.query(
        `SELECT slot_key, checked FROM user_checkins WHERE user_id = $1 AND guide_id = $2`,
        [user.id, guideId]
      );
      const map = {};
      rows.forEach(r => { map[r.slot_key] = r.checked; });
      sendJson(res, 200, { checkins: map });
    } catch (error) {
      console.error("[checkin-get-error]", error);
      sendJson(res, 500, { error: "获取打卡数据失败" });
    }
    return;
  }

  // ── Multi-user Ratings ──

  // Rewrite: POST /api/guides/:id/rate → store in guide_ratings table
  if (req.method === "POST" && url.pathname.match(/^\/api\/guides\/[^/]+\/rate$/)) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/guides\//, "").replace(/\/rate$/, "") || "").trim();
    if (!id) { sendJson(res, 400, { error: "id 不能为空" }); return; }
    const body = await readBody(req);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      sendJson(res, 400, { error: "rating 必须是 1-5 的整数" }); return;
    }

    // Optional: logged-in user
    const user = await authenticateUser(req);

    try {
      const pool = await getPool();

      // Verify guide exists
      const guideCheck = await pool.query(`SELECT 1 FROM guides WHERE id = $1`, [id]);
      if (!guideCheck.rows.length) { sendJson(res, 404, { error: "未找到该攻略" }); return; }

      if (user) {
        // Upsert into guide_ratings
        await pool.query(`
          INSERT INTO guide_ratings (guide_id, user_id, rating) VALUES ($1, $2, $3)
          ON CONFLICT (guide_id, user_id) DO UPDATE SET rating = $3
        `, [id, user.id, rating]);
      } else {
        // Anonymous: store as legacy _rating in content JSONB (backward compat)
        const { rows } = await pool.query(`SELECT content FROM guides WHERE id = $1 LIMIT 1`, [id]);
        const content = rows[0]?.content || {};
        content._rating = { value: rating, ratedAt: new Date().toISOString(), anonymous: true };
        await pool.query(`UPDATE guides SET content = $1::jsonb, updated_at = $2 WHERE id = $3`,
          [JSON.stringify(content), new Date().toISOString(), id]);
      }
      sendJson(res, 200, { ok: true, rating });
    } catch (error) {
      console.error("[rate-error]", error);
      sendJson(res, 500, { error: "评分失败" });
    }
    return;
  }

  // GET /api/guides/:id/ratings — aggregated rating data
  if (req.method === "GET" && url.pathname.match(/^\/api\/guides\/[^/]+\/ratings$/)) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/guides\//, "").replace(/\/ratings$/, "") || "").trim();
    if (!id) { sendJson(res, 400, { error: "id 不能为空" }); return; }
    try {
      const pool = await getPool();

      const [aggRows, distRows] = await Promise.all([
        // Aggregated stats
        pool.query(`
          SELECT COUNT(*)::int as total_count,
                 COALESCE(AVG(rating), 0)::numeric(2,1) as average,
                 ROUND(COUNT(*) FILTER (WHERE rating = 5)::float / NULLIF(COUNT(*), 0) * 100)::int as pct_5,
                 ROUND(COUNT(*) FILTER (WHERE rating = 4)::float / NULLIF(COUNT(*), 0) * 100)::int as pct_4,
                 ROUND(COUNT(*) FILTER (WHERE rating = 3)::float / NULLIF(COUNT(*), 0) * 100)::int as pct_3,
                 ROUND(COUNT(*) FILTER (WHERE rating = 2)::float / NULLIF(COUNT(*), 0) * 100)::int as pct_2,
                 ROUND(COUNT(*) FILTER (WHERE rating = 1)::float / NULLIF(COUNT(*), 0) * 100)::int as pct_1
          FROM guide_ratings WHERE guide_id = $1
        `, [id]),
        // Distribution per star
        pool.query(`
          SELECT rating, COUNT(*)::int as count
          FROM guide_ratings WHERE guide_id = $1 GROUP BY rating ORDER BY rating DESC
        `, [id])
      ]);

      const agg = aggRows.rows[0];
      const distribution = (distRows.rows || []).map(r => ({ rating: r.rating, count: r.count }));
      const currentUser = await authenticateUser(req);
      let myRating = null;

      if (currentUser) {
        const myRow = await pool.query(`SELECT rating FROM guide_ratings WHERE guide_id = $1 AND user_id = $2`, [id, currentUser.id]);
        if (myRow.rows.length) myRating = myRow.rows[0].rating;
      }

      sendJson(res, 200, {
        totalCount: agg.total_count || 0,
        average: Number(agg.average || 0),
        distribution,
        breakdown: [
          { star: 5, count: distribution.find(d => d.rating === 5)?.count || 0, percent: agg.pct_5 || 0 },
          { star: 4, count: distribution.find(d => d.rating === 4)?.count || 0, percent: agg.pct_4 || 0 },
          { star: 3, count: distribution.find(d => d.rating === 3)?.count || 0, percent: agg.pct_3 || 0 },
          { star: 2, count: distribution.find(d => d.rating === 2)?.count || 0, percent: agg.pct_2 || 0 },
          { star: 1, count: distribution.find(d => d.rating === 1)?.count || 0, percent: agg.pct_1 || 0 },
        ],
        myRating,
      });
    } catch (error) {
      console.error("[ratings-get-error]", error);
      sendJson(res, 500, { error: "获取评分数据失败" });
    }
    return;
  }

  sendJson(res, 404, { error: text("apiRouteNotFound") });
}

async function handleShare(req, res, url) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const id = decodeURIComponent(url.pathname.slice("/api/share/".length) || "").trim();
  if (!id) {
    sendJson(res, 400, { error: "id 不能为空" });
    return;
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, cache_key, location, days, title, content, created_at, updated_at
       FROM guides WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      sendJson(res, 404, { error: "未找到该攻略" });
      return;
    }

    const row = rows[0];
    sendJson(res, 200, {
      id: row.id,
      key: row.cache_key,
      location: row.location,
      days: Number(row.days),
      title: row.title,
      content: row.content || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("[share-error]", error);
    sendJson(res, 500, { error: "获取分享内容失败" });
  }
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
