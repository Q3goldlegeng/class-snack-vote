const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const databaseDir = path.join(__dirname, "..", "database");

if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
}

const dbPath = path.join(databaseDir, "snack_vote.db");

const db = new sqlite3.Database(dbPath);

db.run("PRAGMA foreign_keys = ON");

module.exports = db;