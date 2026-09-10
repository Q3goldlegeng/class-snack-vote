const path = require("path");
const fs = require("fs");

if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const parameterize = sql => { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); };
    module.exports = {
        isPostgres: true,
        run(sql, params = [], callback) { pool.query(parameterize(sql), params).then(result => callback.call({ changes: result.rowCount, lastID: result.rows[0]?.id }, null)).catch(callback); },
        get(sql, params = [], callback) { pool.query(parameterize(sql), params).then(result => callback(null, result.rows[0])).catch(callback); },
        all(sql, params = [], callback) { pool.query(parameterize(sql), params).then(result => callback(null, result.rows)).catch(callback); },
        close: () => pool.end()
    };
} else {
    const sqlite3 = require("sqlite3").verbose();
    const databaseDir = process.env.DATABASE_DIR || path.join(__dirname, "..", "database");
    if (!fs.existsSync(databaseDir)) fs.mkdirSync(databaseDir, { recursive: true });
    const db = new sqlite3.Database(path.join(databaseDir, "snack_vote.db"));
    db.run("PRAGMA foreign_keys = ON");
    db.isPostgres = false;
    module.exports = db;
}
