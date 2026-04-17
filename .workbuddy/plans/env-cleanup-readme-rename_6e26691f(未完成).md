---
name: env-cleanup-readme-rename
overview: 清理 .env.example（移除废弃变量和泄露的真实值、保留纯示例）、重写 README（文艺风格+规范文档）、为项目取一个不超过7字的文艺名字
---

<plan_result>
<req>

## 产品概述

对项目进行品牌化升级：清理环境变量安全隐患、重写 README 文档、为项目起一个文艺的名字（不超过7个字）。

## 核心需求

### 1. 环境变量同步与安全清理

- **移除已废弃变量**：`.env.example` 中仍包含和风天气 (`HEFENG_WEATHER_API_KEY`) 配置，server.js 已迁移到 Open-Meteo，该变量 0 引用，应删除
- **消除敏感信息泄露**：
- `HEFENG_WEATHER_API_KEY=d06c16642e374d468551d277c7ed4607` — 真实 Key 暴露
- `DELETE_PASSWORD=leemuzi` — 真实密码暴露
- 推广链接含真实 partner ID（GetYourGuide `?customer_id=7JREU1P`）
- **保留示例性质**：所有值必须为占位符/示例值，不得包含真实密钥或密码
- **与 server.js 实际使用保持一致**：仅列出代码中 `readEnv()` 引用过的变量

### 2. 重新设计 README

当前问题：

- 名称无特色（"Travel Guide Generator"）
- 环境变量段引用 Windows 绝对路径 `C:\Users\lee\Desktop\ai\share\.env.example`
- 缺少天气 API 说明（Open-Meteo）、高德地图说明、部署说明
- 风格偏工程文档，缺乏旅行产品感

新 README 要求：

- 使用新项目名
- 包含功能亮点、技术栈、环境变量说明（安全）、API 文档、部署指南
- 整体风格兼顾专业性和旅行产品的文艺气质

### 3. 项目命名

- 好听、有文艺感
- 不超过 7 个汉字
- 需同步更新：README 标题、package.json name/description、index.html title（可选）
</req>
<tech>

## 技术方案

纯文档/配置修改，无需新依赖或架构变更。

### 改动范围

| 文件 | 变更类型 | 内容 |
| --- | --- | --- |
| `.env.example` | 重写 | 移除废弃变量 + 所有值改为占位符 |
| `README.md` | 重写 | 全新设计，使用新项目名 |
| `package.json` | 微调 | 更新 name 和 description 字段 |
| `index.html` | 可选 | 更新 `<title>` 标签 |


### server.js 实际使用的环境变量清单（用于 .env.example 对齐）

**必需变量：**

- `PORT` — 服务端口
- `POSTGRES_URL` / `DATABASE_URL` / `NEON_DATABASE_URL` — PostgreSQL 连接串
- `OPENAI_BASEURL` / `baseurl` — AI 模型接口地址
- `OPENAI_APIKEY` / `apikey` — AI 模型密钥
- `OPENAI_MODELNAME` / `modelname` — 模型名称
- `DELETE_PASSWORD` — 删除接口密码

**可选变量：**

- `PROMOTIONS_JSON` — 广告卡片 JSON
- `BOOKING_PROMO_*` (title/desc/url/cta ×4) — Booking 推广
- `GETYOURGUIDE_PROMO_*` (×4) — GetYourGuide 推广
- `MEITUAN_PROMO_*` (×4) — 美团推广
- `DATACARD_PROMO_*` (×4) — 流量卡推广
- `GEOCODE_USER_AGENT` — 地理编码 UA（有默认值）
- `AMAP_API_KEY` / `AMAP_WEB_KEY` — 高德地图

**内置常量（无需配置）：**

- Open-Meteo 天气 API（免费无需 Key）
- GYG_PARTNER_ID = "7JREU1P"（硬编码在 server.js:37）
</tech>
<design framework="HTML" component="">
<description>本任务主要是文档和配置文件的修改，不涉及 UI 页面设计。README 的排版采用 Markdown 标准格式，注重层次清晰和阅读体验。整体风格定位为简洁、文艺、专业的旅行产品技术文档。</description>
<style_keywords>简洁, 文艺, 清晰层次, 专业</style_keywords>
<font_system fontFamily="system-ui">
<heading size="28px" weight="700"></heading>
<subheading size="18px" weight="600"></subheading>
<body size="14px" weight="400"></body>
</font_system>
<color_system>
<primary_colors>
<color>#1a1a2e</color>
<color>#16213e</color>
</primary_colors>
<background_colors>
<color>#ffffff</color>
<color>#f8f9fa</color>
</background_colors>
<text_colors>
<color>#333333</color>
<color>#666666</color>
</text_colors>
<functional_colors>
<color>#e74c3c</color>
<color="#27ae60</color>
</functional_colors>
</color_system>
</design>
<todolist>
<item id="clean-env-example" deps="">重写 .env.example：移除废弃 HEFENG 变量，所有值替换为占位符，与 server.js 实际引用完全对齐</item>
<item id="rewrite-readme" deps="clean-env-example">重新设计并重写 README.md：使用新项目名，完整功能介绍、环境变量说明、API 文档、部署指南</item>
<item id="update-pkg-meta" deps="">更新 package.json 的 name/description 为新项目名，同步更新 index.html title</item>
</todolist>
</plan_result>