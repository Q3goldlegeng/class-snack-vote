# 班級點心投票

## 本機啟動

```powershell
cd backend
npm start
```

開啟 `http://localhost:3000`。

## Render 雲端部署（SQLite 版本）

1. 將整個專案推送到 GitHub。
2. 在 Render 建立 **Web Service**，選擇 Node。
3. Root Directory 設為 `backend`；Build Command 設為 `npm install`；Start Command 設為 `npm start`。
4. 設定環境變數：
   - `SESSION_SECRET`：自行產生一段長而隨機的文字。
   - `DATABASE_DIR`：`/var/data`
5. 在 Advanced / Disks 新增 Persistent Disk：Mount Path 填 `/var/data`。
6. 部署完成後，使用 Render 提供的 `onrender.com` 網址開啟系統。

> SQLite 的資料庫與登入工作階段都會儲存在 `DATABASE_DIR`。沒有 Persistent Disk 時，Render 重新部署或重啟後資料會遺失。
