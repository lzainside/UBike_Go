# UBike GO

極簡 YouBike 雙站可行性判斷系統。

## 架構

- 前端：純 HTML / CSS / 原生 JavaScript
- API：Netlify Function 單一 `GET /check`
- 資料：每次請求只抓一次台北 YouBike 即時資料
- 儲存：不使用資料庫，僅用 `localStorage`
- 提示：前端會向 `/check?list=1` 讀取站點清單，提供輸入提示與 GPS 最近站點預設

## 核心判斷

```text
if start.sbi >= 1 and end.bemp >= 1:
  ride
else:
  walk
```

## 檔案說明

- `index.html`：主畫面
- `styles.css`：RWD 與視覺風格
- `app.js`：前端互動、localStorage、交換按鈕、配置儲存、30 秒輪詢
- `shared/station-utils.js`：站名模糊比對、距離計算、判斷邏輯、API handler factory
- `netlify/functions/check.js`：Netlify Function 入口
- `netlify.toml`：`/check` 轉發與 SPA 轉址
- `test/logic.test.js`：核心邏輯與 handler tests

## API

### `GET /check?start=xxx&end=xxx`

回傳範例：

```json
{
  "start_station": "科技大樓",
  "start_bikes": 8,
  "end_station": "六張犁",
  "end_slots": 5,
  "decision": "ride",
  "message": "可騎Ubike",
  "reasons": [],
  "updated_at": "2026-04-26T00:00:00.000Z"
}
```

### 延伸參數

- `watch=1`：回傳時若終點車位不足，附上最近 2 個站點與剩餘車位
- `list=1`：回傳站點清單，供前端提示與 GPS 最近站點計算使用

## 部署方式

1. 將整個 `UBike GO` 資料夾部署到 Netlify。
2. Build command 留空。
3. Publish directory 設為專案根目錄。
4. Functions directory 使用 `netlify/functions`。
5. 部署後直接開首頁即可使用。

## 本機測試

```bash
npm test
```

## 驗證案例

- 正常情況：起點有車、終點有位
- 起點沒車：回傳 `建議步行`
- 終點沒位：回傳 `建議步行`
- 站名錯誤：回傳 `站點不存在`
- 模糊輸入：例如 `科技`，可匹配 `捷運科技大樓站`

## 設計重點

- 低延遲：只抓一次即時資料
- 低成本：靜態頁面 + Serverless
- 穩定：無資料庫、無登入、無外部狀態依賴
- 行動端友善：響應式卡片布局
- 互動體驗：站點提示、交換起終點、載入上次使用、GPS 預設、已騎乘自動更新
