# Travel Guide Generator

一个纯单语言的旅行攻略生成器，前端为单页静态页面，后端为 `Node.js` 服务，支持历史记录、景点地图、广告位配置和健康检查接口。

## 功能

- 生成并保存旅行攻略
- 查看历史记录、按地点筛选、删除记录
- 展示每日行程、预算、路线和景点地图
- 展示可配置广告卡片列表
- 保留 Google 统计/追踪与 Vercel Analytics 注入

## 环境变量

参考 `C:\Users\lee\Desktop\ai\share\.env.example`

```env
PORT=3000
POSTGRES_URL=postgresql://user:password@host/dbname?sslmode=require
PROMOTIONS_JSON=[{"title":"酒店优惠","desc":"限时活动","url":"https://example.com/deal"}]
GEOCODE_USER_AGENT=travel-guide-app/1.0
baseurl=https://api.openai.com/v1
apikey=your_api_key
modelname=gpt-4o-mini
DELETE_PASSWORD=your_delete_password
```

- `PORT`：服务端口，默认 `3000`
- `POSTGRES_URL`：PostgreSQL 连接串
- `PROMOTIONS_JSON`：广告卡片列表，格式为 `[{"title":"xx","desc":"","url":"https://..."}]`
- `GEOCODE_USER_AGENT`：地理编码请求的 `User-Agent`
- `baseurl` / `apikey` / `modelname`：模型接口配置
- `DELETE_PASSWORD`：删除历史记录接口密码

## 启动

```bash
npm install
npm start
```

如果 `3000` 端口被占用，服务会自动回退到下一个可用端口。

## API

### `GET /api/health`

返回服务健康状态。

### `GET /api/config`

返回前端配置：

- `promotions`

### `GET /api/guides`

返回历史攻略列表。

查询参数：

- `location`：按地点过滤

### `POST /api/guides`

生成并保存攻略。

请求体：

```json
{
  "location": "杭州",
  "days": 2,
  "useCache": true,
  "referenceSpots": ["西湖", "灵隐寺"]
}
```

### `GET /api/geocode`

地理编码查询。

查询参数：

- `q`：地点或景点名称
- `city`：可选城市上下文

### `DELETE /api/guides/:id`

删除指定攻略。

请求体：

```json
{
  "password": "your_delete_password"
}
```

## 静态资源

服务会直接托管以下静态资源类型：

- `index.html`
- `js` / `mjs` / `css`
- `png` / `jpg` / `jpeg` / `svg` / `webp` / `ico`
- `json` / `txt` / `map`

前端通过 `GET /api/config` 读取广告卡片配置。
