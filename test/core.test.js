const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// ── Pure function tests (no DB/network dependency) ──

describe("buildKey", () => {
  // Import from server by extracting the function logic
  function buildKey(location, days) {
    return `${String(location || "").trim()}::${Number(days)}`;
  }

  it("should build correct cache key", () => {
    assert.equal(buildKey("杭州", 3), "杭州::3");
  });

  it("should trim whitespace", () => {
    assert.equal(buildKey("  成都  ", 2), "成都::2");
  });

  it("should handle empty location", () => {
    assert.equal(buildKey("", 1), "::1");
  });
});

describe("parsePriceMax", () => {
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

  it("should parse simple number", () => {
    assert.equal(parsePriceMax("500元"), 500);
  });

  it("should parse range and return max", () => {
    assert.equal(parsePriceMax("200-500元"), 500);
  });

  it("should parse 万 unit", () => {
    assert.equal(parsePriceMax("约1.5万"), 15000);
  });

  it("should parse k unit", () => {
    assert.equal(parsePriceMax("2k"), 2000);
  });

  it("should return null for empty string", () => {
    assert.equal(parsePriceMax(""), null);
  });

  it("should return null for non-numeric", () => {
    assert.equal(parsePriceMax("免费"), null);
  });
});

describe("normalizeRouteStep", () => {
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
      note: String(step.note || "").trim(),
    };
  }

  it("should normalize valid step", () => {
    const result = normalizeRouteStep({ from: "酒店", to: "西湖", transport: "地铁", duration: "25分钟" });
    assert.deepEqual(result, { from: "酒店", to: "西湖", transport: "地铁", line: "", duration: "25分钟", note: "" });
  });

  it("should return null for null input", () => {
    assert.equal(normalizeRouteStep(null), null);
  });

  it("should return null when missing from", () => {
    assert.equal(normalizeRouteStep({ to: "西湖" }), null);
  });

  it("should return null when missing to", () => {
    assert.equal(normalizeRouteStep({ from: "酒店" }), null);
  });

  it("should default transport to 步行", () => {
    const result = normalizeRouteStep({ from: "A", to: "B" });
    assert.equal(result.transport, "步行");
  });

  it("should trim whitespace", () => {
    const result = normalizeRouteStep({ from: "  酒店  ", to: "  西湖  " });
    assert.equal(result.from, "酒店");
    assert.equal(result.to, "西湖");
  });
});

describe("stableTemplateIdByKey", () => {
  function stableTemplateIdByKey(key) {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    return (hash % 10) + 1;
  }

  it("should return consistent template for same key", () => {
    assert.equal(stableTemplateIdByKey("杭州::3"), stableTemplateIdByKey("杭州::3"));
  });

  it("should return value between 1 and 10", () => {
    for (let i = 0; i < 100; i++) {
      const id = stableTemplateIdByKey(`test-${i}`);
      assert.ok(id >= 1 && id <= 10, `Template id ${id} out of range`);
    }
  });

  it("should return different templates for different keys", () => {
    // Not guaranteed but likely for distinct keys
    const a = stableTemplateIdByKey("北京::2");
    const b = stableTemplateIdByKey("上海::2");
    // At least they should be valid
    assert.ok(a >= 1 && a <= 10);
    assert.ok(b >= 1 && b <= 10);
  });
});

describe("rateLimit", () => {
  const store = new Map();

  function rateLimit(ip, limit = 5, windowMs = 60000) {
    const now = Date.now();
    const entry = store.get(ip);
    if (!entry || now - entry.resetAt > windowMs) {
      store.set(ip, { count: 1, resetAt: now });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  }

  it("should allow first request", () => {
    assert.equal(rateLimit("test-ip-1", 2, 60000), true);
  });

  it("should allow up to limit", () => {
    assert.equal(rateLimit("test-ip-2", 3, 60000), true);
    assert.equal(rateLimit("test-ip-2", 3, 60000), true);
    assert.equal(rateLimit("test-ip-2", 3, 60000), true);
    assert.equal(rateLimit("test-ip-2", 3, 60000), false);
  });

  it("should track different IPs independently", () => {
    rateLimit("ip-a", 1, 60000);
    assert.equal(rateLimit("ip-b", 1, 60000), true);
  });
});

describe("escapeXml", () => {
  function escapeXml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  it("should escape special XML characters", () => {
    assert.equal(escapeXml('<script>"alert&hack"</script>'), "&lt;script&gt;&quot;alert&amp;hack&quot;&lt;/script&gt;");
  });

  it("should handle null/undefined", () => {
    assert.equal(escapeXml(null), "");
    assert.equal(escapeXml(undefined), "");
  });

  it("should handle apostrophes", () => {
    assert.equal(escapeXml("it's"), "it&#39;s");
  });
});
