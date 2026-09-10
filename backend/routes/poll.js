const express = require("express");
const db = require("../db/database");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();

// =========================
// Database helpers
// =========================

const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

// =========================
// 取得目前投票狀態
// =========================

async function getPollState() {
    const rows = await all(`
        SELECT key, value
        FROM settings
        WHERE key IN (
            'poll_status',
            'poll_date',
            'poll_start_at',
            'poll_end_at'
        )
    `);

    const settings = Object.fromEntries(
        rows.map(row => [row.key, row.value])
    );

    let status = settings.poll_status || "not_started";

    const startAt = settings.poll_start_at || "";
    const endAt = settings.poll_end_at || "";

    const now = new Date();

    if (startAt && new Date(startAt) > now) {
        status = "not_started";
    } else if (endAt && new Date(endAt) <= now) {
        status = "ended";
    } else if (
        startAt &&
        new Date(startAt) <= now &&
        (!endAt || new Date(endAt) > now)
    ) {
        status = "open";
    }

    return {
        status,
        pollDate: settings.poll_date || "",
        startAt,
        endAt
    };
}

// =========================
// 取得投票頁完整資料
// =========================

async function snapshot(userId) {
    const state = await getPollState();

    // 只取得目前啟用中的點心
    const snacks = await all(`
        SELECT
            s.id,
            s.name,
            s.description,
            s.price,
            s.image_url,
            s.category,
            s.active,
            s.sort_order,
            COUNT(v.id) AS votes
        FROM snacks s
        LEFT JOIN votes v
            ON v.snack_id = s.id
        WHERE s.active = TRUE
        GROUP BY s.id
        ORDER BY
            s.category ASC,
            s.sort_order ASC,
            s.id ASC
    `);

    // =========================
    // 計算各分類排名
    // =========================

    const ranks = new Map();

    for (const category of ["snack", "drink"]) {
        snacks
            .filter(snack => snack.category === category)
            .slice()
            .sort(
                (a, b) =>
                    Number(b.votes) - Number(a.votes) ||
                    Number(a.sort_order) - Number(b.sort_order) ||
                    Number(a.id) - Number(b.id)
            )
            .forEach((snack, index) => {
                ranks.set(snack.id, index + 1);
            });
    }

    const ranked = snacks.map(snack => ({
        ...snack,
        id: Number(snack.id),
        price: snack.price === null ? null : Number(snack.price),
        sort_order: Number(snack.sort_order),
        active: Boolean(snack.active),
        votes: Number(snack.votes),
        rank: ranks.get(snack.id)
    }));

    // =========================
    // 取得目前使用者已投票的選項
    // =========================

    const votes = await all(
        `
        SELECT snack_id, category
        FROM votes
        WHERE user_id = ?
        `,
        [userId]
    );

    const selectedSnackIds = Object.fromEntries(
        votes.map(vote => [
            vote.category,
            Number(vote.snack_id)
        ])
    );

    // =========================
    // 投票人統計
    // =========================

    const totalVoters = await get(`
        SELECT COUNT(DISTINCT user_id) AS count
        FROM votes
    `);

    const completedVoters = await get(`
        SELECT COUNT(*) AS count
        FROM (
            SELECT user_id
            FROM votes
            GROUP BY user_id
            HAVING COUNT(DISTINCT category) = 2
        ) AS completed
    `);

    return {
        ...state,
        snacks: ranked,
        selectedSnackIds,
        totalVoters: Number(totalVoters?.count || 0),
        completedVoters: Number(completedVoters?.count || 0)
    };
}

// =========================
// GET /api/poll
// =========================

router.get("/", requireLogin, async (req, res) => {
    try {
        const data = await snapshot(req.session.user.id);

        res.json({
            success: true,
            ...data
        });
    } catch (error) {
        console.error("取得投票資料失敗：", error);

        res.status(500).json({
            success: false,
            message: "無法取得投票資料"
        });
    }
});

// =========================
// POST /api/poll/vote
// =========================

router.post("/vote", requireLogin, async (req, res) => {
    try {
        // 管理員不能投票
        if (req.session.user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "管理員不需要投票"
            });
        }

        const { snackId } = req.body;

        // 檢查 snackId
        if (!snackId) {
            return res.status(400).json({
                success: false,
                message: "請選擇有效的點心選項"
            });
        }

        // 檢查投票是否開放
        const state = await getPollState();

        if (state.status !== "open") {
            return res.status(403).json({
                success: false,
                message:
                    state.status === "ended"
                        ? "本次投票已結束"
                        : "投票尚未開始，請等待管理員開放。"
            });
        }

        // 只能投啟用中的點心
        const snack = await get(
            `
            SELECT id, category
            FROM snacks
            WHERE id = ?
              AND active = TRUE
            `,
            [snackId]
        );

        if (!snack) {
            return res.status(400).json({
                success: false,
                message: "請選擇有效的點心選項"
            });
        }

        // =========================
        // 儲存投票
        // 每人每分類只能有一票
        // 如果已經投過，就更新原本的選擇
        // =========================

        await run(
            `
            INSERT INTO votes (
                user_id,
                snack_id,
                category,
                voted_at
            )
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id, category)
            DO UPDATE SET
                snack_id = EXCLUDED.snack_id,
                voted_at = CURRENT_TIMESTAMP
            `,
            [
                req.session.user.id,
                snack.id,
                snack.category
            ]
        );

        // 回傳更新後的投票資料
        const data = await snapshot(req.session.user.id);

        res.json({
            success: true,
            message: "已儲存你的選擇",
            ...data
        });

    } catch (error) {
        console.error("投票儲存失敗：", error);

        res.status(500).json({
            success: false,
            message: "投票儲存失敗"
        });
    }
});

module.exports = router;