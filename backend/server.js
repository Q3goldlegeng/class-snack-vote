require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const cors = require("cors");
const path = require("path");

const db = require("./db/database");
const initDatabase = require("./db/init");

const authRoutes = require("./routes/auth");
const pollRoutes = require("./routes/poll");
const adminRoutes = require("./routes/admin");

const app = express();

const PORT = process.env.PORT || 3000;


// =========================
// Middleware
// =========================

app.use(express.json());

app.use(
    cors({
        origin: process.env.FRONTEND_URL,
        credentials: true
    })
);


// =========================
// Session
// =========================

app.use(
    session({
        store: new SQLiteStore({
            db: "sessions.db",
            dir: path.join(__dirname, "database")
        }),

        secret: process.env.SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
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

// 以同一個服務提供前端，開啟 http://localhost:3000 即可使用。
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("*splat", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
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
