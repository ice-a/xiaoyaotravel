<div align="center">

# 🌊 逍遥游

**「且夫天地之间，物各有主。惟江上之清风，与山间之明月。」**

AI 驱动的智能旅行攻略生成器 —— 输入目的地，即刻获得完整行程规划

[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql)](https://neon.tech)
[![License](https://img.shields.io/badge/License-MIT-green)](#)

</div>

---

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| 🤖 **AI 智能生成** | 输入目的地与天数，自动生成包含景点、美食、交通的完整攻略 |
| 🌤️ **天气融合** | 基于 Open-Meteo 的 7 天天气预报，雨天推荐室内活动，高温提醒防晒 |
| 🕐 **行程时间轴** | 按时段划分的可视化时间轴（上午/下午/晚间），支持拖拽编辑 |
| 🗺️ **景点地图** | 基于 Leaflet + OpenStreetMap 的交互式景点标注地图 |
| 📊 **多方案对比** | 一键生成经济版 / 舒适版攻略，横向对比选择最优方案 |
| 💱 **实时汇率** | 40+ 境外目的地货币自动换算 |
| 🔗 **分享导出** | 生成分享链接、复制到剪贴板、导出 PNG 海报、打印 / PDF |
| ⭐ **用户评分** | 5 星评分 + 多用户聚合展示（平均分 / 星级分布） |
| ✅ **行程打卡** | 服务端存储打卡记录，跨设备同步进度 |
| ❤️ **收藏功能** | 收藏心仪攻略，登录后云端持久化 |
| 🔐 **用户系统** | 用户名 + 密钥轻量登录，首次使用自动注册 |
| 👤 **个人面板** | 一站式查看收藏列表、打卡统计、个人信息 |

## 🛠️ 技术栈

- **后端**：Node.js（原生，无框架）+ PostgreSQL（Neon）
- **前端**：纯 HTML / CSS / JavaScript（无构建工具）
- **AI**：OpenAI 兼容接口（可对接任意大模型）
- **天气**：Open-Meteo（免费，无需 API Key）
- **地图**：Leaflet + OpenStreetMap Nominatim
- **交通**：高德地图 Web Service（可选）
- **部署**：Vercel

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-username/xiaoyao-travel.git
cd xiaoyao-travel
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的数据库连接串和 AI 模型配置：

```env
POSTGRES_URL=postgresql://user:password@host/dbname?sslmode=require
baseurl=https://api.openai.com/v1
apikey=your_api_key_here
modelname=gpt-4o-mini
DELETE_PASSWORD=your_password_here
```

### 4. 启动服务

```bash
npm start
```

访问 `http://localhost:3000` 即可使用。

## ⚙️ 环境变量

### 必需

| 变量 | 说明 | 示例 |
|------|------|------|
| `POSTGRES_URL` | PostgreSQL 连接串 | `postgresql://...` |
| `baseurl` | AI 模型 API 地址 | `https://api.openai.com/v1` |
| `apikey` | AI 模型 API Key | `sk-...` |
| `modelname` | 模型名称 | `gpt-4o-mini` |

### 可选

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `DELETE_PASSWORD` | 删除攻略的验证密码 | `（未设置则禁止删除）` |
| `GEOCODE_USER_AGENT` | 地理编码 User-Agent | `travel-guide-app/1.0` |
| `AMAP_API_KEY` | 高德地图 Key（实时交通） | — |
| `AMAP_WEB_KEY` | 高德地图 Web Service Key | — |

> 完整示例见 [`.env.example`](.env.example)

## 🌐 部署

### Vercel（推荐）

1. Fork 本仓库到 GitHub
2. 在 [Vercel](https://vercel.com) 中导入项目
3. 添加环境变量（参考上方表格）
4. 部署完成

> 项目已包含 `vercel.json` 配置文件，无需额外设置。

### 其他平台

本项目为标准 Node.js 应用，可部署至任何支持 Node.js 的平台（Railway、Render、Fly.io 等），需确保：
- Node.js ≥ 18
- 可访问 PostgreSQL 数据库
- 设置环境变量

## 📡 API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/config` | 前端配置（推广卡片等） |
| `GET` | `/api/guides` | 攻略列表（支持 `?location=` 筛选） |
| `POST` | `/api/guides` | 生成并保存攻略 |
| `GET` | `/api/guides/:id` | 攻略详情 |
| `PATCH` | `/api/guides/:id` | 编辑攻略 |
| `DELETE` | `/api/guides/:id` | 删除攻略（需密码） |
| `POST` | `/api/guides/:id/rate` | 评分（登录用户存独立记录） |
| `GET` | `/api/guides/:id/ratings` | 评分聚合数据（平均分/分布/当前用户评分） |
| `POST` | `/api/auth/login` | 用户登录（自动注册） |
| `GET` | `/api/auth/me` | 验证会话 |
| `GET` | `/api/user/profile` | 用户面板聚合数据（收藏+打卡+评分统计） |
| `GET` | `/api/user/favorites` | 收藏列表 |
| `POST` | `/api/user/favorites` | 添加收藏 |
| `DELETE` | `/api/user/favorites/:guideId` | 取消收藏 |
| `POST` | `/api/user/checkins` | 提交/切换打卡 |
| `GET` | `/api/user/checkins/:guideId` | 某攻略打卡状态 |
| `GET` | `/api/weather` | 天气预报（Open-Meteo） |
| `GET` | `/api/exchange-rate` | 实时汇率 |
| `GET` | `/api/route` | 实时交通路线（高德） |
| `GET` | `/api/geocode` | 地理编码 |

## 🧪 测试

```bash
npm test
```

## 👤 用户系统

### 认证机制

采用 **API Key 轻量认证**模式，无需传统注册流程：

1. **首次登录**：输入用户名 + 密钥（Key），系统自动创建账号
2. **密钥安全**：Key 经过 SHA256 哈希存储，前端只保留哈希值
3. **会话持久化**：通过 `localStorage` 保存登录状态，刷新页面不丢失
4. **请求鉴权**：每次 API 请求自动携带 `X-User-Key` / `X-Username` Header

### 数据同步

| 功能 | 未登录 | 已登录 |
|------|--------|--------|
| 收藏 | localStorage（最多5个） | 服务端云端存储，无上限 |
| 打卡 | localStorage（本地） | 服务端跨设备同步 |
| 评分 | 匿名评分（覆盖式） | 独立记录，参与聚合统计 |

## 📄 License

MIT
