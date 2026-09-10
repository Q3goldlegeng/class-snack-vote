const express = require("express");
const db = require("../db/database");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));

async function getPollState() {
    const rows = await all("SELECT key, value FROM settings WHERE key IN ('poll_status', 'poll_date', 'poll_start_at', 'poll_end_at')");
    const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
    let status = settings.poll_status || "not_started";
    const startAt = settings.poll_start_at || "";
    const endAt = settings.poll_end_at || "";
    const now = new Date();
    if (startAt && new Date(startAt) > now) status = "not_started";
    else if (endAt && new Date(endAt) <= now) status = "ended";
    else if (startAt && new Date(startAt) <= now && (!endAt || new Date(endAt) > now)) status = "open";
    return { status, pollDate: settings.poll_date || "", startAt, endAt };
}

async function snapshot(userId) {
    const state = await getPollState();
    const snacks = await all(`
        SELECT s.id, s.name, s.description, s.price, s.image_url, s.category, s.active, s.sort_order,
               COUNT(v.id) AS votes
        FROM snacks s LEFT JOIN votes v ON v.snack_id = s.id
        WHERE s.active = 1
        GROUP BY s.id ORDER BY s.category ASC, s.sort_order ASC, s.id ASC
    `);
    const ranks = new Map();
    for (const category of ["snack", "drink"]) {
        snacks.filter(snack => snack.category === category)
            .slice()
            .sort((a, b) => Number(b.votes) - Number(a.votes) || a.sort_order - b.sort_order || a.id - b.id)
            .forEach((snack, index) => ranks.set(snack.id, index + 1));
    }
    const ranked = snacks.map(snack => ({ ...snack, votes: Number(snack.votes), rank: ranks.get(snack.id) }));
    const votes = await all("SELECT snack_id, category FROM votes WHERE user_id = ?", [userId]);
    const selectedSnackIds = Object.fromEntries(votes.map(vote => [vote.category, vote.snack_id]));
    const totalVoters = await get("SELECT COUNT(DISTINCT user_id) AS count FROM votes");
    const completedVoters = await get("SELECT COUNT(*) AS count FROM (SELECT user_id FROM votes GROUP BY user_id HAVING COUNT(DISTINCT category) = 2)");
    return { ...state, snacks: ranked, selectedSnackIds, totalVoters: totalVoters.count, completedVoters: completedVoters.count };
}

router.get("/", requireLogin, async (req, res) => {
    try { res.json({ success: true, ...(await snapshot(req.session.user.id)) }); }
    catch (error) { console.error(error); res.status(500).json({ success: false, message: "無法取得投票資料" }); }
});

router.post("/vote", requireLogin, async (req, res) => {
    try {
        if (req.session.user.role !== "student") return res.status(403).json({ success: false, message: "管理員不需要投票" });
        const { snackId } = req.body;
        const state = await getPollState();
        if (state.status !== "open") return res.status(403).json({ success: false, message: state.status === "ended" ? "本次投票已結束" : "投票尚未開始，請等待管理員開放。" });
        const snack = await get("SELECT id, category FROM snacks WHERE id = ? AND active = 1", [snackId]);
        if (!snack) return res.status(400).json({ success: false, message: "請選擇有效的點心選項" });
        await run(`INSERT INTO votes (user_id, snack_id, category, voted_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(user_id, category) DO UPDATE SET snack_id = excluded.snack_id, voted_at = CURRENT_TIMESTAMP`, [req.session.user.id, snackId, snack.category]);
        res.json({ success: true, message: "已儲存你的選擇", ...(await snapshot(req.session.user.id)) });
    } catch (error) { console.error(error); res.status(500).json({ success: false, message: "投票儲存失敗" }); }
});

module.exports = router;
