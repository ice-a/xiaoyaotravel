---
name: travel-guide-next-iteration
overview: 对旅游攻略生成器进行新一轮开发迭代，涵盖天气功能前端接入+AI融合、清理参考景点代码、Prompt质量优化、UX交互提升、分享功能、SEO/性能优化共6个方向。（2026-04-16 补全：robots.txt、sitemap.xml、JSON-LD）
todos:
  - id: weather-detail-display
    content: 在攻略详情页新增天气卡片区域，调用 /api/weather 展示未来7天预报（气温、天气、风力、湿度、降水、紫外线）
    status: completed
  - id: weather-prompt-integration
    content: 在后端 getOrCreateGuide 中先获取天气数据，融合到 AI Prompt 中（雨天提醒室内活动、紫外线提醒防晒等）
    status: completed
    dependencies:
      - weather-detail-display
  - id: remove-reference-spots
    content: 彻底删除参考景点功能：前端 HTML 移除相关 DOM、后端删除 validSpots 代码、README 清理字段描述
    status: completed
  - id: prompt-optimization
    content: 优化 buildPrompt() prompt 内容，要求更具体的景点名称、防坑建议、预算分项、时间估算等
    status: completed
  - id: skeleton-screen-ux
    content: 实现骨架屏加载状态，替代当前纯 disabled + 文字，提升生成过程中的视觉体验
    status: completed
  - id: share-link-feature
    content: 实现分享功能：新增 /api/share/:id 路由、支持 /?share=uuid 分享模式、生成分享图片（html2canvas 导出 PNG）
    status: completed
  - id: seo-optimization
    content: 完善 SEO meta 信息（og:tags、description、canonical）、添加 dns-prefetch 预连接、优化前端资源加载
    status: completed
---

## Product Overview

旅游攻略生成器（travel-guide-generator）是一款基于 AI 的旅行规划工具，支持生成、保存、浏览旅游攻略，并展示景点地图、预算、行程路线等。

## Core Features

### 1. 天气功能（两者都要）

- **攻略详情页展示天气**：在攻略详情区域新增天气卡片，展示目的地未来7天天气预报（最高/最低气温、白天天气、夜间天气、风力、湿度、降水概率、紫外线指数）
- **AI Prompt 融入天气**：在生成攻略前先调用 `/api/weather` 获取天气数据，将未来7天天气摘要作为上下文注入 AI Prompt，让 AI 的行程建议更贴合实际天气（如，雨天安排室内活动、紫外线强提醒防晒等）

### 2. 参考景点功能 - 彻底删除

- 删除前端 HTML 中的 `reference-spots-panel` div 和相关 DOM
- 删除 `initFormUi()` 中已有的 remove 逻辑
- 删除后端 `buildPrompt()` 中的 `validSpots` 相关代码
- 清理 README.md 中的 `referenceSpots` 字段描述
- 清理前端 JS 中的相关变量

### 3. 攻略内容质量 - Prompt 优化

- 扩充 `buildPrompt()` prompt 内容，增加更丰富的行程细节要求
- 要求 AI 输出景点距离估算、门票信息、预约提醒
- 要求行程安排更贴合季节和天气特征
- 要求贴士更具体（不只给通用建议，要结合当地实际）

### 4. 用户体验优化

- 生成过程中展示加载骨架屏（Skeleton Screen），替代当前纯 disabled + 文字状态
- 优化错误提示，区分网络错误、API 错误、生成失败等不同场景
- 生成成功后平滑滚动到攻略内容区域

### 5. 分享功能

- 新增 `/api/share/:id` 接口（GET），返回攻略的公开静态数据（不含敏感信息）
- 前端新增"生成分享链接"按钮，点击生成带 ID 的 URL（如 `/?share=uuid`）
- 分享页面（`/?share=uuid`）直接渲染攻略内容，无需登录/历史记录
- 支持生成分享图片（利用 html2canvas 将攻略卡片导出为 PNG 图片）

### 6. SEO / 性能优化

- 完善 `index.html` 的 meta 信息（description、keywords、og:title、og:description、og:image）
- 添加 canonical URL
- 添加 `robots.txt` 和 `sitemap.xml`（如有必要）
- 前端资源懒加载优化（Leaflet、ECharts 按需加载）
- 添加 `preconnect` / `dns-prefetch` 预连接外部资源域名

## Tech Stack

- **前端框架**：纯 HTML + 原生 JavaScript（现有）
- **外部依赖**：Leaflet（地图）、ECharts（图表）、html2canvas（分享图片）
- **后端**：Node.js 原生（现有）
- **数据库**：PostgreSQL / Neon（现有）
- **天气 API**：和风天气（已配置 Key）
- **地图坐标**：OpenStreetMap Nominatim（现有）

## Implementation Approach

### 天气功能

**详情页展示**：在 `renderGuide()` 的 hero section 下方新增天气 section，调用 `/api/weather?location=xxx`，渲染 7 日天气预报卡片网格。使用已有的 `api()` 函数封装请求，与现有代码风格保持一致。

**Prompt 融合**：在 `POST /api/guides` 的 `getOrCreateGuide()` 函数中，先调用 `getWeatherData()` 获取天气，将天气摘要格式化为 prompt 文本片段，追加到 `buildPrompt()` 的 context 中传给 AI。

### 删除参考景点

**前端**：直接从 HTML 中移除 `reference-spots-panel` 相关 DOM 节点，无需 JS remove 逻辑。
**后端**：删除 `buildPrompt()` 中的 `validSpots` 相关代码片段。
**README**：移除 `referenceSpots` 字段描述。

### Prompt 优化

在 `buildPrompt()` 中追加更多结构化要求，比如：

- 要求 `morning/afternoon/evening` 字段必须有具体景点名称
- 贴士要包含当地特色注意事项（防坑、防宰客、预约规则）
- 路线要有合理的时间估算
- 预算要分项具体

### 骨架屏

生成过程中用 CSS + HTML 骨架组件替代纯文字加载状态，骨架使用与实际 UI 结构一致的结构（预算网格、行程卡片形状），提升感知体验。

### 分享功能

- `/api/share/:id`：GET 接口，从数据库按 id 查攻略，返回纯内容 JSON（不含敏感字段如 template_id）
- 分享链接格式：`/?share=uuid`，前端在 `applyHash()` 之前检测 URL query 参数
- 分享模式：不显示左侧表单、不显示历史记录条，专注展示攻略内容
- 分享图片：引入 html2canvas CDN，点击"分享图片"按钮将攻略主体区域导出为 PNG 并触发下载

### SEO

- `index.html` 的 `<head>` 中补充 meta description、og: 系列标签、twitter: 系列标签
- 添加 `dns-prefetch` 预连接 CDN 域名
- 添加 JSON-LD 结构化数据（Article / WebApplication）

## Architecture Design

### System Architecture

```
用户输入地点/天数
      │
      ▼
  生成请求 ──→ 检查缓存
                 │
          新生成 ──→ 获取天气数据
                        │
                        ▼
                   融合 Prompt ──→ AI 生成攻略
                                     │
                                     ▼
                              存入 PostgreSQL
                                     │
                                     ▼
                              返回攻略 + 缓存状态
                                     │
                                     ▼
                              渲染攻略详情页 + 天气卡片
```

### Data Flow (Weather)

```
/api/weather → getWeatherData() → Nominatim 地理编码 → 和风天气 API → 格式化返回
                    │                                        │
                    └────────── AI Prompt Context ◄──────────┘
```

## Directory Structure

```
project-root/
├── index.html      # [MODIFY] 新增天气展示区块、分享模式支持、SEO meta、骨架屏、删除参考景点 DOM
├── server.js       # [MODIFY] 天气数据融合到 prompt、新增 /api/share/:id 路由、优化 prompt 内容、删除 validSpots
├── README.md       # [MODIFY] 删除 referenceSpots 字段描述、更新 API 文档
└── public/         # [NEW] 静态资源目录（如 robots.txt）
```

# Agent Extensions

本项目暂不需要使用任何 Agent Extensions（技能/子代理/集成）。