# Travel Guide Generator

一个前端页面 + Node.js API 的小项目：输入地点和天数，生成旅游攻略并存储到 MongoDB。  
缓存键规则固定为：`地点-X天`（例如 `东京-3天`）。

## 功能

- 选择地点 + 天数生成旅游攻略
- 打开网页自动读取 MongoDB 历史记录
- 命中缓存直接返回，不重复调用大模型
- 大模型调用兼容 OpenAI API 规范
- 内置 10 套前端模板：新生成时随机选 1 套，并固定绑定该攻略

## 环境变量

复制 `.env.example` 为 `.env`，并填写以下值：

```env
PORT=3000

MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=travel_guides
MONGODB_COLLECTION=guides

baseurl=https://api.openai.com/v1
apikey=your_api_key
modelname=gpt-4o-mini
DELETE_PASSWORD=your_delete_password
```

其中大模型变量名按你的要求支持：

- `baseurl`
- `apikey`
- `modelname`
- `DELETE_PASSWORD`（删除历史攻略时必填）

## 启动

```bash
npm install
npm start
```

启动后访问：

`http://localhost:3000`

## API

### `GET /api/guides`

获取 MongoDB 中最近 20 条攻略（按更新时间倒序）。

### `POST /api/guides`

请求体：

```json
{
  "location": "东京",
  "days": 3
}
```

返回：

- `cached: true`：命中 MongoDB 缓存
- `cached: false`：新调用模型生成并写入 MongoDB
- `item.templateId`：该攻略绑定的模板编号（1-10）

### `DELETE /api/guides/:key`

删除指定 key 的历史攻略（例如 `DELETE /api/guides/东京-3天`）。  
请求体：

```json
{
  "password": "your_delete_password"
}
```

说明：

- 服务端未配置 `DELETE_PASSWORD` 时会拒绝删除
- 密码错误会返回 403
- 搜索历史不需要密码

## 数据结构（核心字段）

```json
{
  "key": "东京-3天",
  "location": "东京",
  "days": 3,
  "templateId": 7,
  "title": "东京3天旅游攻略",
  "content": {
    "summary": "...",
    "itinerary": [],
    "budget": {}
  },
  "createdAt": "2026-04-08T00:00:00.000Z",
  "updatedAt": "2026-04-08T00:00:00.000Z"
}
```

## 部署说明（Vercel / Cloudflare）

### 部署前环境变量

在部署平台中先配置以下变量：

- `MONGODB_URI`
- `MONGODB_DB`
- `MONGODB_COLLECTION`
- `baseurl`
- `apikey`
- `modelname`
- `DELETE_PASSWORD`

### 方案 A：部署到 Vercel（推荐）

1. 将项目推送到 GitHub。
2. 打开 Vercel，点击 `Add New -> Project`，导入该仓库。
3. Framework Preset 选择 `Other`。
4. 按上面清单添加环境变量。
5. 点击部署。

如果你希望所有路由都由 `server.js` 处理，可以在项目根目录新增 `vercel.json`：

```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "server.js" }
  ]
}
```

### 方案 B：部署到 Cloudflare

当前项目是 Node.js 原生 HTTP 服务（`node:http`），并使用了 MongoDB Node 驱动。
这套实现不能直接运行在 Cloudflare Workers 运行时，通常需要改造后再上云。

可行做法：

1. 保持应用部署在 Vercel，域名接入 Cloudflare（DNS/代理）。
2. 将后端改造成 Workers 兼容方案（例如 Hono + fetch 风格的数据访问），再部署到 Cloudflare Workers/Pages。
