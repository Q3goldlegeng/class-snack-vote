const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { requireLogin } = require("../middleware/auth");
const router = express.Router();
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const adminOnly = [requireLogin, (req, res, next) => req.session.user.role === "admin" ? next() : res.status(403).json({ success: false, message: "需要管理員權限" })];

async function getSettings() {
    const rows = await all("SELECT key, value FROM settings WHERE key IN ('poll_status', 'poll_date', 'poll_start_at', 'poll_end_at')");
    return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

async function dashboard() {
    const setting = await getSettings();
    const snacks = await all(`SELECT s.*, COUNT(v.id) AS votes FROM snacks s LEFT JOIN votes v ON v.snack_id = s.id GROUP BY s.id ORDER BY s.sort_order, s.id`);
    const users = await all(`SELECT id, username, name, role, must_change_password, created_at FROM users ORDER BY role DESC, username`);
    const voted = await get("SELECT COUNT(DISTINCT user_id) AS count FROM votes");
    const completed = await get("SELECT COUNT(*) AS count FROM (SELECT user_id FROM votes GROUP BY user_id HAVING COUNT(DISTINCT category) = 2)");
    const voteDetails = await all(`
        SELECT u.username, u.name,
               MAX(CASE WHEN v.category = 'snack' THEN s.name END) AS snack_name,
               MAX(CASE WHEN v.category = 'drink' THEN s.name END) AS drink_name
        FROM users u
        LEFT JOIN votes v ON v.user_id = u.id
        LEFT JOIN snacks s ON s.id = v.snack_id
        WHERE u.role = 'student'
        GROUP BY u.id
        HAVING COUNT(v.id) > 0
        ORDER BY u.username
    `);
    return { status: setting.poll_status || "not_started", pollDate: setting.poll_date || "", startAt: setting.poll_start_at || "", endAt: setting.poll_end_at || "", snacks: snacks.map(s => ({ ...s, votes: Number(s.votes), active: Boolean(s.active) })), users, votedCount: voted.count, completedVoters: completed.count, studentCount: users.filter(u => u.role === "student").length, voteDetails };
}

function parseCsv(text) {
    const rows = [];
    let field = "", row = [], quoted = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i], next = text[i + 1];
        if (char === '"' && quoted && next === '"') { field += '"'; i++; }
        else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) { row.push(field.trim()); field = ""; }
        else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') i++;
            row.push(field.trim()); field = "";
            if (row.some(value => value)) rows.push(row);
            row = [];
        } else field += char;
    }
    row.push(field.trim());
    if (row.some(value => value)) rows.push(row);
    return rows;
}

router.get("/dashboard", ...adminOnly, async (req, res) => { try { res.json({ success: true, ...(await dashboard()) }); } catch { res.status(500).json({ success: false, message: "無法取得管理資料" }); } });
router.put("/status", ...adminOnly, async (req, res) => {
    try {
        const { status } = req.body;
        if (!["not_started", "open", "ended"].includes(status)) return res.status(400).json({ success: false, message: "無效的投票狀態" });
        await run("UPDATE settings SET value = ? WHERE key = 'poll_status'", [status]);
        res.json({ success: true, message: "投票狀態已更新", ...(await dashboard()) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "投票狀態更新失敗" }); }
});
router.put("/schedule", ...adminOnly, async (req, res) => {
    try {
        const { pollDate = "", startAt = "", endAt = "" } = req.body;
        if (startAt && endAt && new Date(startAt) >= new Date(endAt)) return res.status(400).json({ success: false, message: "結束時間必須晚於開始時間" });
        await run("UPDATE settings SET value = ? WHERE key = 'poll_date'", [pollDate]);
        await run("UPDATE settings SET value = ? WHERE key = 'poll_start_at'", [startAt]);
        await run("UPDATE settings SET value = ? WHERE key = 'poll_end_at'", [endAt]);
        res.json({ success: true, message: "日期與投票時間已儲存", ...(await dashboard()) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "時間設定儲存失敗" }); }
});
router.post("/snacks", ...adminOnly, async (req, res) => {
    try {
        const { name, description = "", price = null, category = "snack", imageUrl = "" } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, message: "請輸入點心名稱" });
        if (!["snack", "drink"].includes(category)) return res.status(400).json({ success: false, message: "品項分類無效" });
        if (imageUrl && (!imageUrl.startsWith("data:image/") || imageUrl.length > 3000000)) return res.status(400).json({ success: false, message: "圖片格式不正確或檔案過大（最多 2 MB）" });
        await run("INSERT INTO snacks (name, description, price, image_url, category, sort_order) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM snacks), 1))", [name.trim(), description.trim(), Number.isFinite(Number(price)) ? Number(price) : null, imageUrl, category]);
        res.json({ success: true, ...(await dashboard()) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "新增品項失敗" }); }
});
router.delete("/snacks/:id", ...adminOnly, async (req, res) => {
    try {
        const snack = await get("SELECT id FROM snacks WHERE id = ?", [req.params.id]);
        if (!snack) return res.status(404).json({ success: false, message: "找不到此品項" });
        await run("BEGIN TRANSACTION");
        try {
            await run("DELETE FROM votes WHERE snack_id = ?", [snack.id]);
            await run("DELETE FROM snacks WHERE id = ?", [snack.id]);
            await run("COMMIT");
        } catch (error) { await run("ROLLBACK"); throw error; }
        res.json({ success: true, message: "品項已刪除", ...(await dashboard()) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "品項刪除失敗" }); }
});
router.post("/users/import", ...adminOnly, async (req, res) => {
    try {
        const { csvText } = req.body;
        if (typeof csvText !== "string" || !csvText.trim()) return res.status(400).json({ success: false, message: "請選擇 CSV 檔案" });
        const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
        const [header, ...data] = rows;
        if (!header || header.map(value => value.toLowerCase()).join(",") !== "student_id,name,password") {
            return res.status(400).json({ success: false, message: "CSV 欄位必須是 student_id,name,password" });
        }
        if (!data.length) return res.status(400).json({ success: false, message: "CSV 沒有帳號資料" });
        if (data.length > 43) return res.status(400).json({ success: false, message: "一次最多匯入 43 位學生" });
        const seen = new Set();
        for (const [username, name, password] of data) {
            if (!username || !name || !password || password.length < 6) return res.status(400).json({ success: false, message: "每列都需要學號、姓名與至少 6 碼密碼" });
            if (username === "admin" || seen.has(username)) return res.status(400).json({ success: false, message: "學號不可為 admin，且不可重複" });
            seen.add(username);
        }
        await run("BEGIN TRANSACTION");
        try {
            for (const [username, name, password] of data) {
                const passwordHash = await bcrypt.hash(password, 12);
                await run(`INSERT INTO users (username, name, password_hash, role, must_change_password)
                           VALUES (?, ?, ?, 'student', 1)
                           ON CONFLICT(username) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash,
                           role = 'student', must_change_password = 1`, [username, name, passwordHash]);
            }
            await run("COMMIT");
        } catch (error) { await run("ROLLBACK"); throw error; }
        res.json({ success: true, message: `已匯入 ${data.length} 位學生帳號`, ...(await dashboard()) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "帳號匯入失敗" }); }
});
router.put("/snacks/:id", ...adminOnly, async (req, res) => {
    try {
    const { name, description = "", price = null, active, category = "snack", imageUrl = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: "請輸入點心名稱" });
    if (!["snack", "drink"].includes(category)) return res.status(400).json({ success: false, message: "品項分類無效" });
    if (imageUrl && (!imageUrl.startsWith("data:image/") || imageUrl.length > 3000000)) return res.status(400).json({ success: false, message: "圖片格式不正確或檔案過大（最多 2 MB）" });
    await run("UPDATE snacks SET name = ?, description = ?, price = ?, image_url = ?, category = ?, active = ? WHERE id = ?", [name.trim(), description.trim(), Number.isFinite(Number(price)) ? Number(price) : null, imageUrl, category, active ? 1 : 0, req.params.id]);
    res.json({ success: true, ...(await dashboard()) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "品項修改失敗" }); }
});
module.exports = router;
