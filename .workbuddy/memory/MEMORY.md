# MEMORY.md

## 项目概况
- 项目名：**逍遥游**（xiaoyao-travel）
- 路径：c:\Users\lee\Desktop\ai\share\
- 技术栈：Node.js 原生 + 纯 HTML/JS 单页 + PostgreSQL (Neon)
- AI 接入：OpenAI 兼容接口（baseurl/apikey/modelname）
- 天气 API：**Open-Meteo**（免费无需Key，已从和风天气迁移，2026-04-17）
  - 预报接口：`https://api.open-meteo.com/v1/forecast`
  - 地理编码：`https://geocoding-api.open-meteo.com/v1/search`
- 地图：OpenStreetMap Nominatim（地理编码 fallback）+ Leaflet 前端
- 交通：高德地图 Web Service（可选，AMAP_API_KEY）
- 删除密码：leemuzi（示例中）

## 最新开发迭代（2026-04-16 上午）
完成了 7 个方向的优化：
1. ✅ 天气卡片前端展示（攻略详情页，7天预报，含气温/天气/风力/湿度/降水/紫外线）
2. ✅ 天气数据融合 AI Prompt（雨天安排室内活动、高温提醒防晒等）
3. ✅ 彻底删除参考景点功能（前后端 HTML/JS/README 均已清理）
4. ✅ Prompt 质量升级（要求具体景点名、时间估算、防坑提醒、美食店名）
5. ✅ 骨架屏加载体验 + 分级错误提示（网络错误/认证失败/频率限制）
6. ✅ 分享功能（/?share=uuid 链接 + 复制链接 + html2canvas 导出 PNG）
7. ✅ SEO 优化（og tags、twitter cards、canonical、preconnect/dns-prefetch、Leaflet CSS 懒加载）

## 最新开发迭代（2026-04-16 下午）— P0-P3 批量开发
完成 11 项功能：

### 汇总页面 UI 重设计
- 移除推广卡片，新增 hero 渐变区域 + 四维统计卡片
- 新增预算洞察面板（平均预算可视化）
- 新增最近攻略列表（排名徽章+点击跳转）
- 图表布局优化为双列 + 全宽

### P0 用户体验
- ✅ 用户偏好输入（旅行风格10种/预算4档/人数4档 → 注入AI Prompt → 详情页标签展示）
- ✅ 行程时间轴视图（09:00-12:00/12:00-18:00/18:00-22:00 三色时间轴+日期切换）
- ✅ 打印/PDF导出（@media print + 打印按钮）

### P1 内容智能化
- ✅ 实时交通（高德地图地理编码+公交/驾车路线，/api/route）
- ✅ 景点封面图（Unsplash Source API）
- ✅ 多方案对比（经济版/舒适版快捷按钮）

### P2 商业化
- ✅ 动态 og:image（/api/og-image SVG 模板渲染）
- ✅ 用户评分系统（5星组件 + /api/guides/:id/rate）

### P3 工程化
- ✅ API 速率限制（内存级 5次/分钟/IP）
- ✅ 单元测试（24/24 通过，覆盖6个核心函数）

### 第二轮迭代（2026-04-16 晚）— 5项功能完成
- ✅ 行程编辑/自定义（编辑模式 + 拖拽排序 + PATCH /api/guides/:id）
- ✅ 收藏/对比功能（localStorage 持久化，最多5个，双栏对比面板）
- ✅ 实时汇率转换（/api/exchange-rate，40+境外目的地货币映射）
- ✅ 深度 affiliate 链接（百度地图/大众点评/携程搜索快捷按钮）
- ✅ 行程追踪打卡（打卡 toggle + 进度条 + localStorage 持久化）

### 新增环境变量
- AMAP_API_KEY / AMAP_WEB_KEY

### 踩坑经验
- Open-Meteo daily API 湿度参数名是 `relative_humidity_2m_max`，不是 `relative_humidity_mean_2m`（后者会导致 400）

## 待接入资源
- og:image 和 og:url 需部署后替换为真实域名

## SEO 补全（2026-04-16）
- robots.txt（允许爬虫，声明 sitemap 路径）
- sitemap.xml（首页条目，weekly 更新频率）
- JSON-LD（WebApplication schema，含 aggregateRating）

## 项目约定
- 纯 JavaScript（无框架、无构建工具）
- 前端单文件 index.html，后端单文件 server.js
- 数据库表：guides(id, cache_key, location, days, template_id, title, content JSONB, created_at, updated_at)
- 测试命令：npm test（Node.js 内置 test runner）
- 远期重构：模块化拆分 + TypeScript 迁移

## 用户系统（2026-04-17 实现）
- 认证方式：username + key（API Key 模式），SHA256 哈希存储
- 首次登录自动注册，通过 X-User-Key / X-Username Header 传递凭证
- 新增 4 张表：users, user_favorites, user_checkins, guide_ratings
- 未登录降级到 localStorage（收藏最多5个、打卡本地、评分匿名覆盖）
- 12 个 API 端点（/api/auth/*, /api/user/*, /api/guides/:id/ratings）
- 个人中心页面：#/profile 路由，含用户信息/收藏管理/打卡记录/旅行统计/修改昵称
- 会话恢复：ensureAuth() 静默重连 + api() 401 自动重试机制（2026-04-17 修复掉线）
