---
name: slogan-and-user-system
overview: 两大功能：(1) 网页添加品牌 Slogan；(2) 完整用户管理系统——username+key 登录、服务端收藏/打卡/评分、个人面板、攻略底部评分展示
design:
  architecture:
    framework: html
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 900
    subheading:
      size: 16px
      weight: 700
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#0d9488"
      - "#0f766e"
      - "#d97706"
    background:
      - "#f9f8f5"
      - "#ffffff"
      - "#f0fdfa"
    text:
      - "#1c1917"
      - "#78716c"
    functional:
      - "#16a34a"
      - "#dc2626"
      - "#3b82f6"
todos:
  - id: slogan-ui
    content: 在 index.html 添加 Slogan 横幅区域（toolbar 下方）+ 升级首页空状态为品牌欢迎页
    status: completed
  - id: db-migration
    content: server.js 新增 3 张表（users / user_favorites / user_checkins / guide_ratings）+ 认证中间件 + 登录/用户 API
    status: completed
  - id: auth-frontend
    content: index.html 新增登录模态框组件 + topbar 用户入口 + JS 认证逻辑（localStorage 会话 + API Key header 注入）
    status: completed
  - id: favorites-server
    content: 实现服务端收藏 API + 前端收藏交互改为调用 API（未登录降级提示）
    status: completed
  - id: checkin-server
    content: 实现服务端打卡 API + 前端打卡改为调用 API（必须登录，未登录禁用+提示）
    status: completed
  - id: user-panel
    content: 实现用户信息面板（topbar 下拉卡片：收藏列表、打卡统计、退出登录）+ /api/user/profile 聚合接口
    status: completed
  - id: rating-aggregate
    content: 重构评分系统为多用户聚合 + 前端评分区展示平均分/分布/星级占比条
    status: completed
  - id: env-docs
    content: 更新 .env.example 和 README.md 文档（新增认证相关说明）
    status: completed
---

## 产品概述

对「逍遥游」项目进行两大功能升级：(1) 在首页添加品牌 Slogan，强化品牌古风调性；(2) 实现完整的用户管理系统，支持 username + key 轻量登录、服务端收藏/打卡、用户信息面板和聚合评分展示。

## 核心需求

### 需求 1：网页 Slogan 展示

- 在 topbar 下方或首页空状态区域添加逍遥游品牌 Slogan
- Slogan 风格为古风诗词（如「且将新火试新茶，诗酒趁年华」）
- 视觉上与现有品牌色系（teal/amber）融合，不破坏布局
- 首页空状态区域从纯功能提示升级为带品牌感的欢迎页

### 需求 2：用户管理系统

**2.1 登录机制**

- 用户只需记住 username + key（API Key 模式），无需注册流程
- 登录后前端持久化 token（localStorage 存 username+key 的 hash 作为会话标识）
- 后端通过 API Key 验证身份，每次请求在 header 中传递认证信息
- Topbar 右侧增加用户头像/登录入口

**2.2 用户收藏（服务端化）**

- 当前收藏存在 localStorage（最多5个），改为服务端存储
- 新增 `user_favorites` 表：user_id + guide_id + created_at
- 收藏操作需登录；未登录时显示「登录后收藏」提示
- 收藏上限可放宽（不再限制5个）

**2.3 打卡绑定用户**

- 打卡当前存在 localStorage（`checkin_${guideId}`），改为服务端存储
- 打卡操作**必须登录**，未登录时打卡按钮提示「登录后打卡」
- 新增 `user_checkins` 表：user_id + guide_id + slot_key + checked + created_at
- 保留进度条计算逻辑（服务端查询）

**2.4 个人信息面板**

- 点击 Topbar 用户头像展开下拉面板，包含：
- 用户名显示
- 我的收藏列表（点击跳转到对应攻略）
- 打卡统计（总打卡数、最近打卡的攻略）
- 退出登录按钮
- 新增 `/api/user/profile` 端点返回聚合数据
- 新增 `/api/user/favorites` 收藏 CRUD
- 新增 `/api/user/checkins` 打卡查询/提交

**2.5 评分聚合展示**

- 当前评分只存单条 `_rating`（覆盖式），改为多用户聚合
- 新增 `guide_ratings` 表：guide_id + user_id + rating + created_at
- 攻略底部评分区展示：平均分 + 评分人数分布 + 星级占比条
- 已评分用户显示其评分（不可重复评）
- 未评分用户仍可正常评分

## 技术栈

- **后端**：Node.js 原生 (http) + PostgreSQL (pg) — 与现有架构完全一致
- **前端**：纯 HTML/CSS/JS 单页应用 — 保持现状
- **数据库**：PostgreSQL (Neon)，新增 3 张表
- **认证**：API Key 模式（username + key 哈希验证），JWT 替代方案过重

## 技术架构

### 认证机制设计

采用 **API Key 简单认证**，无需引入 JWT 库：

```
前端 localStorage 存储: { username: "xxx", keyHash: sha256(username+key) }
每次 API 请求 Header: X-User-Key: <keyHash>, X-Username: <username>
后端中间件: 从 DB 查询 user，比对 hash(key_hash, SHA256(user_key))
```

**为什么不用 JWT**：

- 项目无 npm 依赖管理偏好（仅用 dotenv + pg）
- 引入 jsonwebtoken 增加依赖体积
- API Key 模式对单页应用足够安全（key 不暴露在前端代码中）

### 数据库设计（新增 3 张表）

```sql
-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- UUID
  username TEXT UNIQUE NOT NULL,
  key_hash TEXT NOT NULL,        -- SHA256(key) 存储哈希
  nickname TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 用户收藏
CREATE TABLE user_favorites (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, guide_id)
);

-- 用户打卡
CREATE TABLE user_checkins (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,          -- "0-morning", "0-afternoon" 等
  checked BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, guide_id, slot_key)
);

-- 攻略评分（多用户聚合）
CREATE TABLE guide_ratings (
  id SERIAL PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guide_id, user_id)
);
```

### API 端点设计（新增）

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| POST | /api/auth/login | username + key 登录 | 否 |
| GET | /api/auth/me | 获取当前用户信息 | 是 |
| GET | /api/user/profile | 用户面板数据聚合 | 是 |
| POST | /api/user/favorites | 添加收藏 | 是 |
| DELETE | /api/user/favorites/:guideId | 取消收藏 | 是 |
| GET | /api/user/favorites | 收藏列表 | 是 |
| POST | /api/user/checkins | 提交/切换打卡 | 是 |
| GET | /api/user/checkins/:guideId | 某攻略打卡状态 | 是 |
| POST | /api/guides/:id/rate | 评分（改写为多用户） | 可选(未登录匿名) |
| GET | /api/guides/:id/ratings | 评分聚合数据 | 否 |


### 前端状态扩展

```javascript
// S 对象新增字段
const S = {
  ...existing,
  user: null,              // { id, username, nickname } 或 null
  userCheckins: {},         // { [guideId]: { [slotKey]: bool } }
  userPanelOpen: false,     // 面板开关
};
```

## 实现策略

### 性能与兼容性考虑

1. **认证中间件轻量化**：在 handleApi 入口处提取 header，查一次 users 表（内存缓存热点用户）
2. **评分聚合预计算**：`GET /api/guides/:id/ratings` 用 SQL AVG/GROUP BY 实时计算（评分量不大时够快）；后续可加 materialized view
3. **向后兼容**：所有新增 API 为增量式，原有 `/api/guides` 接口不变；打卡/收藏对未登录用户降级到 localStorage 提示
4. **数据库迁移**：在 getPool() 的 dbReadyPromise 中执行 CREATE TABLE IF NOT EXISTS

本任务涉及现有 HTML 页面的改造和用户系统 UI 组件的新增。保持项目现有的设计语言（teal + amber 配色、圆角卡片、毛玻璃导航栏），新增的用户系统 UI 组件融入 topbar 区域，登录弹窗和用户面板采用模态框/下拉面板形式。

**Slogan 设计**：在 toolbar-row 和 loc-strip 之间插入品牌 Slogan 横幅区域，使用渐变背景 + 古风诗句竖排或横排居中，视觉上连接顶部导航和内容区域。

**登录界面**：简洁的模态框（username + key 两个输入框），品牌风格统一。

**用户面板**：Topbar 右侧用户头像点击后展开下拉卡片，含收藏列表、打卡统计、退出按钮。

## SubAgent

### code-explorer

- **Purpose**: 在实现过程中快速定位代码插入点和验证改动影响范围
- **Expected outcome**: 精确定位 server.js 中 API 路由插入位置、index.html 中 UI 组件插入位置、CSS 样式追加位置