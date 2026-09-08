const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// 本機預設存於 backend/database；雲端可用 DATABASE_DIR 指向持久磁碟。
const databaseDir = process.env.DATABASE_DIR || path.join(__dirname, "..", "database");

if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
}

const dbPath = path.join(databaseDir, "snack_vote.db");

const db = new sqlite3.Database(dbPath);

db.run("PRAGMA foreign_keys = ON");

module.exports = db;
