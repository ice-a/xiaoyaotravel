# Travel Guide Generator

旅游攻略生成器（Node.js + 单页前端）：
- 输入地点和天数，生成旅游攻略
- 支持缓存命中 / 强制重生成
- 历史记录支持同地点多条
- 状态页支持多维统计（含最近 7 天 / 30 天）
- 地图使用 OpenStreetMap（Leaflet）展示景点位置

## Database

已切换为 **Neon PostgreSQL**（Vercel 推荐）：
- 环境变量优先读取 `POSTGRES_URL`
- 兼容读取 `DATABASE_URL` / `NEON_DATABASE_URL`
- 服务启动后会自动创建 `guides` 表和索引

## Environment

参考 `.env.example`：

```env
PORT=3000
POSTGRES_URL=postgresql://user:password@host/dbname?sslmode=require

baseurl=https://api.openai.com/v1
apikey=your_api_key
modelname=gpt-4o-mini

DELETE_PASSWORD=your_delete_password
```

## Run

```bash
npm install
npm start
```

打开 `http://localhost:3000`

## API

### GET `/api/guides`

查询历史攻略。

可选参数：
- `location`：按地点模糊筛选

### POST `/api/guides`

创建攻略或命中缓存。

请求体：

```json
{
  "location": "成都",
  "days": 2,
  "useCache": true
}
```

说明：
- `useCache=true`：优先命中缓存
- `useCache=false`：跳过缓存，直接重生成并入库

### DELETE `/api/guides/:id`

删除历史记录（也兼容旧 `key` 删除）。

请求体：

```json
{
  "password": "your_delete_password"
}
```

## Vercel + Neon

在 Vercel Project 环境变量里至少配置：
- `POSTGRES_URL`（来自 Vercel Neon 集成）
- `baseurl`
- `apikey`
- `modelname`
- `DELETE_PASSWORD`

