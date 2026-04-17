---
name: travel-guide-summary-and-future
overview: 对 travel-guide-generator 项目进行全面代码总结，梳理已实现功能、架构特点、代码质量评估，并给出分优先级的后续开发方向建议。
todos:
  - id: code-summary
    content: 完成项目代码全面总结（架构/功能栈/数据流/设计模式/优缺点评估）
    status: completed
  - id: dev-directions
    content: 输出继续开发的方向建议（按优先级排序，涵盖UX/内容/商业化/技术/智能5个维度共15项）
    status: completed
    dependencies:
      - code-summary
---

## 产品概述

Travel Guide Generator（旅游攻略生成器）—— 一款基于 AI 的旅行规划 Web 应用。用户输入目的地和游玩天数，系统自动调用 AI 生成完整旅游攻略，包含每日行程、预算建议、景点地图、交通路线、美食推荐和实用贴士等。

## 核心功能总结

### 已实现功能清单（24项）

**核心引擎层：**

- AI 攻略生成：OpenAI 兼容接口，结构化 JSON 输出（title/summary/itinerary/routes/spots/budget/tips）
- 缓存机制：`{location}::{days}` 为 cache_key，命中缓存秒开
- 智能预算优化：基于历史数据 P50 百分位数自动压制高价推荐
- 天气融合系统：和风天气 API + Nominatim 地理编码，7天预报注入 AI Prompt

**展示交互层：**

- 每日行程卡片（上午/下午/晚上三段式，支持点击联动地图）
- 交通路线规划（侧边栏每日路线步骤详情）
- Leaflet 景点地图（动态地理编码解析坐标）
- 预算四宫格（交通/住宿/餐饮/杂费）
- 天气预报卡片横滚条（气温/天气现象/风力/湿度/降水/紫外线）
- 美食/住宿/贴士三列信息卡 + 推广位内嵌

**用户运营层：**

- 历史记录管理（浏览/搜索筛选/地点标签过滤/密码保护删除）
- 分享功能（`/?share=uuid` 链接 / 复制链接 / html2canvas PNG 截图）
- Markdown 导出下载
- 汇总统计页（ECharts 饼图+柱状图：热门地点/天数分布/标签分布）
- 10种视觉模板样式系统
- 中英双语 UI 框架

**变现推广层：**

- Booking.com 酒店 Affiliate（AID: 1662037）
- GetYourGuide 景点 Affiliate（PID: 7JREU1P）
- 美团美食推广
- 境外流量卡/SIM 卡推广
- Google AdSense 广告接入

**工程化层：**

- SEO 全套（meta/og/twitter cards/JSON-LD/robots.txt/sitemap.xml）
- 骨架屏 Shimmer 动画加载
- 分级错误提示（网络/认证/频率限制/通用）
- 响应式设计（900px/600px 两断点移动端适配）
- Vercel Analytics 流量分析
- 资源预优化（preconnect/dns-prefetch/CSS print懒加载）

## 继续开发方向建议

基于当前代码成熟度和市场竞品分析，以下为按优先级排序的开发方向：

### 方向一：用户体验深化（高优先级）

1. **行程编辑/自定义** —— 允许用户在 AI 生成后手动修改每日行程（拖拽排序、增删景点、调整时间），让攻略从"只读"变为"可编辑"
2. **收藏/对比功能** —— 用户可收藏多个攻略方案进行侧边对比（如"3天版 vs 5天版"的预算和时间差异）
3. **打印友好视图** —— 优化打印 CSS，支持生成适合打印的 PDF 版攻略（出行时离线查看）

### 方向二：内容丰富度提升（高优先级）

4. **景点图片集成** —— 在行程卡片中嵌入景点图片（可用 Unsplash API 或 Wikimedia Commons），大幅提升视觉吸引力
5. **实时汇率转换** —— 针对境外游场景，集成汇率 API 自动将预算换算为当地货币
6. **用户评价/评分系统** —— 允许用户对生成的攻略打分并提交反馈，形成 UGC 内容沉淀

### 方向三：商业化增强（中优先级）

7. **PDF 高级导出付费版** —— 生成排版精美的 PDF 攻略（含封面/目录/图片），作为增值服务
8. **深度 affiliate 链接** —— 在每个具体景点/餐厅旁嵌入更细粒度的预订链接（如大众点评团购、携程门票）
9. **多租户/白标版本** —— 支持旅行社/博主以自定义品牌嵌入到自己的网站中

### 方向四：技术架构升级（中优先级）

10. **代码模块化拆分** —— 将 server.js（1085行）拆分为 routes/services/db 层，index.html 中 JS 抽取为独立模块
11. **速率限制与安全加固** —— 对 AI 调用接口增加 rate limiting，添加请求体大小校验和 JSON Schema 校验
12. **测试体系搭建** —— 核心逻辑的单元测试（generateGuide/getBudgetGuidance/normalizeGuidePayload）+ API 集成测试

### 方向五：智能能力扩展（长期规划）

13. **多模态攻略生成** —— 接入图片生成模型，为每个目的地生成封面图或景点示意图
14. **个性化推荐引擎** —— 基于用户历史行为（偏好文化/自然/美食等类型）调整 Prompt 策略
15. **实时协作/分享** —— 多人共同编辑一份攻略（类似 Google Docs 协作模式），适合家庭/朋友一起规划旅行

## 当前技术栈

| 层级 | 技术 | 文件 |
| --- | --- | --- |
| 后端 | Node.js 原生 `http` 模块（零框架） | server.js (1085行) |
| 前端 | 纯 HTML + 原生 JS + CSS（单文件） | index.html (914行) |
| 数据库 | PostgreSQL（Neon Serverless） | pg 库 |
| AI | OpenAI 兼容接口（longcat.chat / LongCat-Flash-Lite） | fetch 调用 |
| 天气 | 和风天气 QWeather Dev API v7 | fetch 调用 |
| 地图 | Leaflet 1.9.4 + OpenStreetMap Nominatim | CDN 引入 |
| 图表 | ECharts 5.x | CDN 引入 |
| 截图 | html2canvas 1.4.1 | CDN 引入 |
| 部署 | Vercel Serverless Functions | vercel.json |


## 架构特点

- **零框架依赖**：不使用 Express/Koa/React/Vue 等框架
- **前后端各单文件**：server.js + index.html 即是全部代码
- **同构路由**：API 路由 `/api/*` 和静态文件路由在同一 HTTP Server
- **连接池复用**：PostgreSQL 单例 Pool，建表 Promise 只执行一次
- **优雅降级**：天气获取失败不影响攻略生成；地图坐标解析失败显示城市中心

## 数据流架构

```
用户输入地点+天数 → POST /api/guides
                         ↓
                   检查缓存(cache_key)
                    ↓命中        ↓未命中
               直接返回      getWeatherData() → getBudgetGuidance()
                                  ↓                  ↓
                            buildPrompt() ← 天气摘要+预算上限
                                  ↓
                          generateGuide() → AI API
                                  ↓
                      normalizeGuidePayload() → 存DB
                                  ↓
                          返回 { item, cached }
```

## 关键设计模式

- **Repository Pattern**: `getPool()` / `listGuides()` / `getOrCreateGuide()` 封装 DB 操作
- **Strategy Pattern**: `normalizeRoutes()` 有 fallback 策略，`readEnv()` 多 key 回退
- **Builder Pattern**: `buildPrompt()` 组装 prompt 片段，`buildPromotions()` 组装推广列表
- **Null Object Pattern**: `fallbackRoutes()` 无路线时提供默认路线
- **Adapter Pattern**: `normalizeGuidePayload()` 将 AI 不规则输出规范化

## Agent Extensions 使用计划

### SubAgent

- **code-explorer**
- Purpose: 深度探索项目代码结构和实现细节，为后续开发方向提供精准的代码上下文
- Expected outcome: 已完成全面代码分析，覆盖 server.js 全部 1085 行和 index.html 全部 914 行