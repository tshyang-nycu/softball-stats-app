# 壘球成績簿

這是一個可安裝的 PWA MVP，用手機瀏覽器打開後可以加入主畫面。資料會先存在手機瀏覽器的 localStorage，也可以透過 Google Apps Script 同步到 Google Drive 裡的 Google Sheet。

## 功能

- 比賽中即時輸入每一次打席：出局、一安、二安、三安、全壘打、保送、犧飛、失誤上壘
- 自動彙總 AB、H、BB、SF、RBI、得分與失誤上壘
- 自動計算 AVG、OBP、SLG、OPS
- 顯示個人與全隊成績
- 匯出與匯入 CSV
- 透過 Google Apps Script 上傳/下載 Google Sheet 資料
- 支援 PWA 安裝與離線開啟

## 本機開啟

在這個資料夾啟動靜態伺服器：

```bash
python3 -m http.server 5173
```

然後開啟：

```text
http://localhost:5173
```

## Google Drive 同步設定

1. 在 Google Drive 建立一個新的 Google Sheet。
2. 打開 Sheet 後選擇「擴充功能」→「Apps Script」。
3. 把 `google-apps-script/Code.gs` 的內容貼進 Apps Script 編輯器。
4. 按「部署」→「新增部署作業」。
5. 類型選「網頁應用程式」。
6. 執行身分選「我」。
7. 存取權選「知道連結的任何人」或你的隊員所在網域。
8. 部署後複製 Web App URL。
9. 回到 App 的「同步」頁籤貼上 URL，按「上傳到 Drive」。

## 指標公式

- H = 一安 + 二安 + 三安 + 全壘打
- TB = 一安 + 2 × 二安 + 3 × 三安 + 4 × 全壘打
- AVG = H / AB
- OBP = (H + BB) / (AB + BB + SF)
- SLG = TB / AB
- OPS = OBP + SLG
