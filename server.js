const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const INDEX_FILE = path.join(ROOT, "index.html");
const TEMPLATE_COUNT = 10;

const MONGODB_URI = readEnv(["MONGODB_URI", "mongodb_uri"]);
const MONGODB_DB = readEnv(["MONGODB_DB", "mongodb_db"]) || "travel_guides";
const COLLECTION_NAME = readEnv(["MONGODB_COLLECTION", "mongodb_collection"]) || "guides";
const DELETE_PASSWORD = readEnv(["DELETE_PASSWORD", "delete_password"]);

let mongoClient;
let collectionPromise;

function readEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
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
  const message = error.message || String(error);
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return message;

  const details = [];
  if (cause.code) details.push(`code=${cause.code}`);
  if (cause.errno) details.push(`errno=${cause.errno}`);
  if (cause.address) details.push(`address=${cause.address}`);
  if (cause.port) details.push(`port=${cause.port}`);
  return details.length ? `${message} (${details.join(", ")})` : message;
}

function buildKey(location, days) {
  return `${location}-${days}天`;
}

function escapeRegex(source) {
  return String(source).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTemplateId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > TEMPLATE_COUNT) {
    return null;
  }
  return n;
}

function randomTemplateId() {
  return Math.floor(Math.random() * TEMPLATE_COUNT) + 1;
}

function stableTemplateIdByKey(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return (hash % TEMPLATE_COUNT) + 1;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

async function getCollection() {
  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI.");
  }

  if (!collectionPromise) {
    mongoClient = new MongoClient(MONGODB_URI);
    collectionPromise = mongoClient.connect().then((client) => {
      const db = client.db(MONGODB_DB);
      return db.collection(COLLECTION_NAME);
    });
  }

  return collectionPromise;
}

function normalizeGuidePayload(payload, location, days) {
  const itinerary = Array.isArray(payload.itinerary) ? payload.itinerary.slice(0, days) : [];

  return {
    title: payload.title || `${location}${days}天旅游攻略`,
    summary: payload.summary || `${location} ${days} 天行程建议`,
    bestSeason: payload.bestSeason || "四季皆宜",
    travelStyle: payload.travelStyle || "自由行",
    prep: payload.prep || `出发前请确认 ${location} 的天气、交通和预约信息。`,
    audience: payload.audience || "适合第一次去、想快速安排行程的人",
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 8) : [],
    foods: Array.isArray(payload.foods) ? payload.foods.slice(0, 6) : [],
    hotels: Array.isArray(payload.hotels) ? payload.hotels.slice(0, 6) : [],
    itinerary,
    budget: {
      transport: payload.budget?.transport || "待补充",
      hotel: payload.budget?.hotel || "待补充",
      food: payload.budget?.food || "待补充",
      misc: payload.budget?.misc || "待补充"
    },
    tips: Array.isArray(payload.tips) ? payload.tips.slice(0, 8) : []
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Model returned empty content.");

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

async function generateGuide(location, days) {
  const baseUrl = (readEnv(["OPENAI_BASEURL", "baseurl"]) || "").replace(/\/+$/, "");
  const apiKey = readEnv(["OPENAI_APIKEY", "apikey"]);
  const modelName = readEnv(["OPENAI_MODELNAME", "modelname"]);

  if (!baseUrl || !apiKey || !modelName) {
    throw new Error("Missing model env vars: baseurl, apikey, modelname.");
  }

  const prompt = [
    "你是专业旅行策划师，请根据用户给出的地点和天数输出一份可执行的旅游攻略。",
    `地点：${location}`,
    `天数：${days}天`,
    "请只输出 JSON，不要输出 Markdown，不要解释。",
    "JSON 结构必须包含以下字段：",
    "{",
    '  "title": "字符串",',
    '  "summary": "字符串",',
    '  "bestSeason": "字符串",',
    '  "travelStyle": "字符串",',
    '  "prep": "字符串",',
    '  "audience": "字符串",',
    '  "tags": ["字符串"],',
    '  "foods": ["字符串"],',
    '  "hotels": ["字符串"],',
    '  "itinerary": [',
    '    { "theme": "字符串", "morning": "字符串", "afternoon": "字符串", "evening": "字符串" }',
    "  ],",
    '  "budget": { "transport": "字符串", "hotel": "字符串", "food": "字符串", "misc": "字符串" },',
    '  "tips": ["字符串"]',
    "}",
    "itinerary 数量必须与天数一致，预算建议请给出人民币区间。"
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
        temperature: 0.7,
        messages: [
          { role: "system", content: "You are a travel planner. Return strict JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });
  } catch (error) {
    throw new Error(`Failed to reach model API (${baseUrl}/chat/completions). Check baseurl/apikey/modelname and outbound network. ${toErrorMessage(error)}`);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.message || "Model request failed.");
  }

  const message = result.choices?.[0]?.message?.content;
  const parsed = extractJson(message);
  return normalizeGuidePayload(parsed, location, days);
}

async function ensureTemplateId(collection, doc) {
  const current = parseTemplateId(doc.templateId);
  if (current) return { ...doc, templateId: current };

  const templateId = stableTemplateIdByKey(doc.key || "");
  await collection.updateOne({ key: doc.key }, { $set: { templateId, updatedAt: new Date().toISOString() } });
  return { ...doc, templateId };
}

async function listGuides(locationFilter) {
  const collection = await getCollection();
  const query = {};
  if (locationFilter) {
    query.location = { $regex: escapeRegex(locationFilter), $options: "i" };
  }

  const docs = await collection
    .find(query, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();

  const normalized = [];
  for (const doc of docs) {
    const withTemplate = await ensureTemplateId(collection, doc);
    normalized.push({ ...withTemplate, source: "cache" });
  }
  return normalized;
}

async function getOrCreateGuide(location, days) {
  const collection = await getCollection();
  const key = buildKey(location, days);

  const existing = await collection.findOne({ key }, { projection: { _id: 0 } });
  if (existing) {
    const normalized = await ensureTemplateId(collection, existing);
    return { item: { ...normalized, source: "cache" }, cached: true };
  }

  const content = await generateGuide(location, days);
  const now = new Date().toISOString();
  const templateId = randomTemplateId();
  const doc = {
    key,
    location,
    days,
    templateId,
    title: content.title,
    content,
    createdAt: now,
    updatedAt: now
  };

  await collection.updateOne({ key }, { $set: doc }, { upsert: true });
  return { item: { ...doc, source: "generated" }, cached: false };
}

async function deleteGuide(key, password) {
  if (!DELETE_PASSWORD) {
    return { ok: false, statusCode: 503, error: "Delete password is not configured on server." };
  }
  if (!password) {
    return { ok: false, statusCode: 401, error: "Password is required for delete." };
  }
  if (password !== DELETE_PASSWORD) {
    return { ok: false, statusCode: 403, error: "Invalid delete password." };
  }

  const collection = await getCollection();
  const result = await collection.deleteOne({ key });
  return { ok: true, deleted: result.deletedCount > 0 };
}

async function handleApi(req, res, url) {
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

    if (!location) {
      sendJson(res, 400, { error: "location cannot be empty." });
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 14) {
      sendJson(res, 400, { error: "days must be an integer between 1 and 14." });
      return;
    }

    const result = await getOrCreateGuide(location, days);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/guides/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/guides/".length) || "").trim();
    const body = await readBody(req);
    const password = String(body.password || "");

    if (!key) {
      sendJson(res, 400, { error: "key cannot be empty." });
      return;
    }

    const result = await deleteGuide(key, password);
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
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});
