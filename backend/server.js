require("dotenv").config();

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cors = require("cors");
const path = require("path");

const db = require("./db/database");
const initDatabase = require("./db/init");

const authRoutes = require("./routes/auth");
const pollRoutes = require("./routes/poll");
const adminRoutes = require("./routes/admin");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

// =========================
// 環境變數檢查
// =========================

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未設定，無法啟動伺服器。");
}

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET 未設定，無法啟動伺服器。");
}

// =========================
// Middleware
// =========================

// 圖片會以 base64 隨 JSON 傳送；
// 2 MB 原圖編碼後約 2.7 MB。
app.use(express.json({ limit: "3mb" }));

app.use(
    cors({
        origin: process.env.FRONTEND_URL || true,
        credentials: true
    })
);

// =========================
// Session
// =========================

app.use(
    session({
        store: new pgSession({
            pool: db.pool,
            tableName: "user_sessions",
            createTableIfMissing: true
        }),

        secret: process.env.SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: "lax",

            // Render 使用 HTTPS 時必須是 true。
            // 本機 HTTP 則使用 false。
            secure: process.env.NODE_ENV === "production",

            maxAge: 1000 * 60 * 60 * 8
        }
    })
);

// =========================
// API
// =========================

app.use("/api/auth", authRoutes);
app.use("/api/poll", pollRoutes);
app.use("/api/admin", adminRoutes);

// 一律以 JSON 回傳 API 錯誤，避免前端收到 HTML。
app.use("/api", (error, req, res, next) => {
    console.error("API error:", error.message);

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            success: false,
            message: "圖片檔案過大，請使用 2 MB 以下的圖片"
        });
    }

    res.status(error.status || 500).json({
        success: false,
        message: "伺服器處理資料時發生錯誤"
    });
});

// =========================
// 測試 API
// =========================

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "Snack Vote API is running",
        time: new Date().toISOString()
    });
});

// =========================
// 前端
// =========================

// 以同一個服務提供前端。
// 開啟 http://localhost:3000 即可使用。
app.use(
    express.static(
        path.join(__dirname, "..", "frontend")
    )
);

app.get("*splat", (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            "..",
            "frontend",
            "index.html"
        )
    );
});

// =========================
// 啟動
// =========================

async function startServer() {
    try {
        await initDatabase();

        app.listen(PORT, () => {
            console.log("");
            console.log("=================================");
            console.log(" Snack Vote Backend");
            console.log("=================================");
            console.log(`Server: http://localhost:${PORT}`);
            console.log(`API:    http://localhost:${PORT}/api`);
            console.log("");
            console.log("資料庫：PostgreSQL");
            console.log("Session：PostgreSQL");
            console.log("");
            console.log("伺服器啟動成功！");
            console.log("=================================");
        });

    } catch (error) {
        console.error("資料庫初始化失敗：");
        console.error(error);

        process.exit(1);
    }
}

startServer();