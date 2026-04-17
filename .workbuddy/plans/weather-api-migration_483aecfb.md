---
name: weather-api-migration
overview: 将天气接口从和风天气 (QWeather) 迁移到 Open-Meteo（免费、无需API Key），同时优化地理编码以解决"南沙"等中文地名无法定位的问题，并修改 .env 和 server.js 中的相关代码。
todos:
  - id: replace-weather-config
    content: 替换 server.js 中和风天气环境变量为 Open-Meteo 常量，更新 TEXT 提示文案，移除 HEFENG 相关条件判断
    status: completed
  - id: replace-geocoding
    content: 重写 geocodeByQuery() 函数改用 Open-Meteo Geocoding API，添加中文搜索支持和 fallback
    status: completed
  - id: replace-weather-api
    content: 重写 getWeatherData() 函数改用 Open-Meteo Forecast API，实现 WMO code→中文映射、风向角度转换、风速转蒲福级
    status: completed
    dependencies:
      - replace-geocoding
  - id: fix-prompt-and-env
    content: 修复 buildPrompt() 中的天气字段名引用(fxDate→date)，清理 .env 中和风配置，验证完整链路
    status: completed
    dependencies:
      - replace-weather-api
---

## 产品概述

将当前的和风天气(QWeather) API 替换为 **Open-Meteo** 免费天气 API，解决两个核心问题：(1) 和风天气免费额度限制及中文地名解析失败（如"南沙"找不到）；(2) Nominatim 地理编码对中文支持差。

## 核心功能需求

1. 将天气数据源从和风天气切换到 **Open-Meteo**（完全免费、无需 API Key、无限调用）
2. 将地理编码从 Nominatim 切换到 **Open-Meteo Geocoding API**（内置中文搜索，支持 `language=zh`）
3. 保持现有前端天气展示组件不变，后端返回格式保持兼容（date/tempMax/tempMin/textDay/windDirDay/windScaleDay/humidity/precip/uvIndex）
4. 移除 .env 中和风天气相关配置项

## 技术栈

- 后端：Node.js 原生 http 模块（无框架），使用原生 `fetch`
- 天气 API：Open-Meteo (`https://api.open-meteo.com/v1/forecast`)
- 地理编码：Open-Meteo Geocoding (`https://geocoding-api.open-meteo.com/v1/search`)
- 前端：纯 HTML + 内联 JS（无需修改）

## 实现方案

### 核心变更策略

**Open-Meteo 的优势：**

- 完全免费，无需注册/API Key
- 全球覆盖，11km 分辨率
- 最多 16 天预报
- 自带地理编码接口，中文搜索支持好（`language=zh`）

**字段映射关系（Open-Meteo → 现有返回格式）：**

| 原有字段 | Open-Meteo 来源 | 转换逻辑 |
| --- | --- | --- |
| date | daily.time[i] | 直接映射 |
| tempMax | daily.temperature_2m_max[i] | 直接映射 |
| tempMin | daily.temperature_2m_min[i] | 直接映射 |
| textDay | daily.weather_code[i] | WMO code → 中文天气描述 |
| textNight | daily.weather_code[i] | 同上（夜间统一） |
| windDirDay | daily.winddirection_10m_dominant[i] | 角度→方位(如180→南风) |
| windScaleDay | daily.windspeed_10m_max[i] | km/h → 蒲福风级 |
| humidity | daily.relative_humidity_mean_2m[i] | 直接映射 |
| precip | daily.precipitation_sum[i] | 直接映射 |
| uvIndex | daily.uv_index_max[i] | 直接映射 |
| updateTime | response generationtime | 当前时间字符串 |


### 架构设计

```
用户请求 /api/weather?location=南沙
    ↓
geocodeByQuery("南沙") → Open-Meteo Geocoding API (language=zh)
    ↓ 返回 {lat:22.79, lng:113.54}
getWeatherData(lat, lng) → Open-Meteo Forecast API
    ↓ 返回 {daily:{time[], temperature_2m_max[], ...}}
格式化输出 → 兼容原有 {location, updateTime, daily:[{...}]}
```

## 目录结构变更

```
c:\Users\lee\Desktop\ai\share/
├── server.js          # [MODIFY] 核心改动文件
│   ├── ~64-66行       # 替换和风天气环境变量为 Open-Meteo 基础 URL 常量
│   ├── ~85-87行       # 更新天气错误提示文本
│   ├── ~826-863行     # geocodeByQuery() 改用 Open-Meteo Geocoding
│   ├── ~865-918行     # getWeatherData() 改用 Open-Meteo Forecast + WMO 映射
│   ├── ~783-789行     # 移除 if(HEFENG_WEATHER_API_KEY) 条件判断
│   └── ~1266-1284行   # /api/weather 接口移除 Key 检查
├── .env               # [MODIFY] 注释或删除和风天气配置
├── index.html         # [NO CHANGE] 前端代码完全兼容
```

## 关键代码结构

```js
// 新增常量
const OPEN_METEO_API_BASE = "https://api.open-meteo.com/v1";
const GEOCODING_API_BASE = "https://geocoding-api.open-meteo.com/v1";

// WMO weather_code → 中文映射
const WMO_CODE_MAP = {
  0:"晴", 1:"晴", 2:"多云", 3:"阴", 45:"雾", 48:"雾凇",
  51:"小毛毛雨", 53:"毛毛雨", 55:"大毛毛雨", 61:"小雨", 63:"中雨", 65:"大雨",
  71:"小雪", 73:"中雪", 75:"大雪", 80:"阵雨", 81:"强阵雨", 82:"暴雨",
  85:"阵雪", 86:"大阵雪", 95:"雷暴", 96:"雷暴伴冰雹", 99:"大雷暴伴冰雹"
};

// 风向角度→方位
function degToDirection(deg) { /* 北/东北/东/东南/南/西南/西/西北 */ }

// 风速(km/h)→蒲福级
function kmhToBeaufort(kmh) { /* 0-12级 */ }
```

## 执行注意事项

- Open-Meteo 不提供湿度日均值？实际提供 `relative_humidity_mean_2m`，需在 daily 参数中请求
- 地理编码 fallback：如果 Open-Meteo Geocoding 失败，可保留 Nominatim 作为备选
- 风向转换需要 8 方位映射表（N/NNE/NE...）
- `buildPrompt()` 中引用的 `day.fxDate` 需同步改为 `day.date`（因为新格式用 date 字段）
- 前端 `getWeatherIcon()` 基于 `textDay` 中文文字匹配图标，WMO 映射后的中文需与现有匹配规则一致（如包含"晴"、"多云"、"阴"、"雨"、"雪"、"雷"等关键词）