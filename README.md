# 班級點心投票

## 本機啟動

```powershell
cd backend
npm start
```

開啟 `http://localhost:3000`。

## Render 免費方案部署（示範用）

1. 將整個專案推送到 GitHub。
2. 在 Render 建立 **Web Service**，選擇 Node。
3. Root Directory 設為 `backend`；Build Command 設為 `npm install`；Start Command 設為 `npm start`。
4. 設定環境變數 `SESSION_SECRET`：自行產生一段長而隨機的文字。
5. **不要設定 `DATABASE_DIR`，也不要新增 Persistent Disk**；這兩項在免費方案會造成 `/var/data` 權限錯誤。
6. 部署完成後，使用 Render 提供的 `onrender.com` 網址開啟系統。

> 免費方案的 SQLite 資料在 Render 休眠、重啟或重新部署後可能遺失，適合短期測試或一次性投票。需要永久保存資料時，請改用 PostgreSQL（例如 Neon、Supabase）或有持久磁碟的付費服務。
