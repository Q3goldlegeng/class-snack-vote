const express = require("express");
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
    const voted = await get("SELECT COUNT(*) AS count FROM votes");
    return { status: setting.poll_status || "not_started", pollDate: setting.poll_date || "", startAt: setting.poll_start_at || "", endAt: setting.poll_end_at || "", snacks: snacks.map(s => ({ ...s, votes: Number(s.votes), active: Boolean(s.active) })), users, votedCount: voted.count, studentCount: users.filter(u => u.role === "student").length };
}

router.get("/dashboard", ...adminOnly, async (req, res) => { try { res.json({ success: true, ...(await dashboard()) }); } catch { res.status(500).json({ success: false, message: "無法取得管理資料" }); } });
router.put("/status", ...adminOnly, async (req, res) => {
    const { status } = req.body;
    if (!["not_started", "open", "ended"].includes(status)) return res.status(400).json({ success: false, message: "無效的投票狀態" });
    await run("UPDATE settings SET value = ? WHERE key = 'poll_status'", [status]);
    res.json({ success: true, message: "投票狀態已更新", ...(await dashboard()) });
});
router.put("/schedule", ...adminOnly, async (req, res) => {
    const { pollDate = "", startAt = "", endAt = "" } = req.body;
    if (startAt && endAt && new Date(startAt) >= new Date(endAt)) return res.status(400).json({ success: false, message: "結束時間必須晚於開始時間" });
    await run("UPDATE settings SET value = ? WHERE key = 'poll_date'", [pollDate]);
    await run("UPDATE settings SET value = ? WHERE key = 'poll_start_at'", [startAt]);
    await run("UPDATE settings SET value = ? WHERE key = 'poll_end_at'", [endAt]);
    res.json({ success: true, message: "日期與投票時間已儲存", ...(await dashboard()) });
});
router.post("/snacks", ...adminOnly, async (req, res) => {
    const { name, description = "", price = null, category = "snack", imageUrl = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: "請輸入點心名稱" });
    if (!["snack", "drink"].includes(category)) return res.status(400).json({ success: false, message: "品項分類無效" });
    if (imageUrl && (!imageUrl.startsWith("data:image/") || imageUrl.length > 3000000)) return res.status(400).json({ success: false, message: "圖片格式不正確或檔案過大（最多 2 MB）" });
    await run("INSERT INTO snacks (name, description, price, image_url, category, sort_order) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM snacks), 1))", [name.trim(), description.trim(), Number.isFinite(Number(price)) ? Number(price) : null, imageUrl, category]);
    res.json({ success: true, ...(await dashboard()) });
});
router.put("/snacks/:id", ...adminOnly, async (req, res) => {
    const { name, description = "", price = null, active, category = "snack", imageUrl = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: "請輸入點心名稱" });
    if (!["snack", "drink"].includes(category)) return res.status(400).json({ success: false, message: "品項分類無效" });
    if (imageUrl && (!imageUrl.startsWith("data:image/") || imageUrl.length > 3000000)) return res.status(400).json({ success: false, message: "圖片格式不正確或檔案過大（最多 2 MB）" });
    await run("UPDATE snacks SET name = ?, description = ?, price = ?, image_url = ?, category = ?, active = ? WHERE id = ?", [name.trim(), description.trim(), Number.isFinite(Number(price)) ? Number(price) : null, imageUrl, category, active ? 1 : 0, req.params.id]);
    res.json({ success: true, ...(await dashboard()) });
});
module.exports = router;
