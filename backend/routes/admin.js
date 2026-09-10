const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();

// =========================
// Database helpers
// =========================

const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
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
// Admin 權限
// =========================

const adminOnly = [
    requireLogin,
    (req, res, next) => {
        if (req.session.user.role === "admin") {
            next();
        } else {
            res.status(403).json({
                success: false,
                message: "需要管理員權限"
            });
        }
    }
];

// =========================
// 取得投票設定
// =========================

async function getSettings() {
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

    return Object.fromEntries(
        rows.map(row => [row.key, row.value])
    );
}

// =========================
// 管理員 Dashboard
// =========================

async function dashboard() {
    const setting = await getSettings();

    const snacks = await all(`
        SELECT
            s.*,
            COUNT(v.id) AS votes
        FROM snacks s
        LEFT JOIN votes v
            ON v.snack_id = s.id
        GROUP BY s.id
        ORDER BY s.sort_order, s.id
    `);

    const users = await all(`
        SELECT
            id,
            username,
            name,
            role,
            must_change_password,
            created_at
        FROM users
        ORDER BY role DESC, username
    `);

    const voted = await get(`
        SELECT COUNT(DISTINCT user_id) AS count
        FROM votes
    `);

    const completed = await get(`
        SELECT COUNT(*) AS count
        FROM (
            SELECT user_id
            FROM votes
            GROUP BY user_id
            HAVING COUNT(DISTINCT category) = 2
        ) AS completed
    `);

    const voteDetails = await all(`
        SELECT
            u.username,
            u.name,
            MAX(
                CASE
                    WHEN v.category = 'snack'
                    THEN s.name
                END
            ) AS snack_name,
            MAX(
                CASE
                    WHEN v.category = 'drink'
                    THEN s.name
                END
            ) AS drink_name
        FROM users u
        LEFT JOIN votes v
            ON v.user_id = u.id
        LEFT JOIN snacks s
            ON s.id = v.snack_id
        WHERE u.role = 'student'
        GROUP BY u.id
        HAVING COUNT(v.id) > 0
        ORDER BY u.username
    `);

    return {
        status: setting.poll_status || "not_started",
        pollDate: setting.poll_date || "",
        startAt: setting.poll_start_at || "",
        endAt: setting.poll_end_at || "",

        snacks: snacks.map(snack => ({
            ...snack,
            id: Number(snack.id),
            price: snack.price === null ? null : Number(snack.price),
            sort_order: Number(snack.sort_order),
            votes: Number(snack.votes),
            active: Boolean(snack.active)
        })),

        users: users.map(user => ({
            ...user,
            id: Number(user.id),
            must_change_password: Boolean(user.must_change_password)
        })),

        votedCount: Number(voted?.count || 0),
        completedVoters: Number(completed?.count || 0),

        studentCount: users.filter(
            user => user.role === "student"
        ).length,

        voteDetails
    };
}

// =========================
// CSV Parser
// =========================

function parseCsv(text) {
    const rows = [];

    let field = "";
    let row = [];
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"' && quoted && next === '"') {
            field += '"';
            i++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            row.push(field.trim());
            field = "";
        } else if (
            (char === "\n" || char === "\r") &&
            !quoted
        ) {
            if (char === "\r" && next === "\n") {
                i++;
            }

            row.push(field.trim());
            field = "";

            if (row.some(value => value)) {
                rows.push(row);
            }

            row = [];
        } else {
            field += char;
        }
    }

    row.push(field.trim());

    if (row.some(value => value)) {
        rows.push(row);
    }

    return rows;
}

// =========================
// Dashboard
// =========================

router.get(
    "/dashboard",
    ...adminOnly,
    async (req, res) => {
        try {
            res.json({
                success: true,
                ...(await dashboard())
            });
        } catch (error) {
            console.error("取得管理資料失敗：", error);

            res.status(500).json({
                success: false,
                message: "無法取得管理資料"
            });
        }
    }
);

// =========================
// 更新投票狀態
// =========================

router.put(
    "/status",
    ...adminOnly,
    async (req, res) => {
        try {
            const { status } = req.body;

            if (
                ![
                    "not_started",
                    "open",
                    "ended"
                ].includes(status)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "無效的投票狀態"
                });
            }

            await run(
                `
                UPDATE settings
                SET value = ?
                WHERE key = 'poll_status'
                `,
                [status]
            );

            res.json({
                success: true,
                message: "投票狀態已更新",
                ...(await dashboard())
            });

        } catch (error) {
            console.error("投票狀態更新失敗：", error);

            res.status(500).json({
                success: false,
                message: "投票狀態更新失敗"
            });
        }
    }
);

// =========================
// 更新投票時間
// =========================

router.put(
    "/schedule",
    ...adminOnly,
    async (req, res) => {
        try {
            const {
                pollDate = "",
                startAt = "",
                endAt = ""
            } = req.body;

            if (
                startAt &&
                endAt &&
                new Date(startAt) >= new Date(endAt)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "結束時間必須晚於開始時間"
                });
            }

            await db.transaction(async client => {
                await client.query(
                    `
                    UPDATE settings
                    SET value = $1
                    WHERE key = 'poll_date'
                    `,
                    [pollDate]
                );

                await client.query(
                    `
                    UPDATE settings
                    SET value = $1
                    WHERE key = 'poll_start_at'
                    `,
                    [startAt]
                );

                await client.query(
                    `
                    UPDATE settings
                    SET value = $1
                    WHERE key = 'poll_end_at'
                    `,
                    [endAt]
                );
            });

            res.json({
                success: true,
                message: "日期與投票時間已儲存",
                ...(await dashboard())
            });

        } catch (error) {
            console.error("時間設定儲存失敗：", error);

            res.status(500).json({
                success: false,
                message: "時間設定儲存失敗"
            });
        }
    }
);

// =========================
// 新增點心
// =========================

router.post(
    "/snacks",
    ...adminOnly,
    async (req, res) => {
        try {
            const {
                name,
                description = "",
                price = null,
                category = "snack",
                imageUrl = ""
            } = req.body;

            if (!name?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "請輸入點心名稱"
                });
            }

            if (!["snack", "drink"].includes(category)) {
                return res.status(400).json({
                    success: false,
                    message: "品項分類無效"
                });
            }

            if (
                imageUrl &&
                (
                    !imageUrl.startsWith("data:image/") ||
                    imageUrl.length > 3000000
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message: "圖片格式不正確或檔案過大（最多 2 MB）"
                });
            }

            await run(
                `
                INSERT INTO snacks (
                    name,
                    description,
                    price,
                    image_url,
                    category,
                    sort_order
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    COALESCE(
                        (
                            SELECT MAX(sort_order) + 1
                            FROM snacks
                        ),
                        1
                    )
                )
                `,
                [
                    name.trim(),
                    description.trim(),
                    Number.isFinite(Number(price))
                        ? Number(price)
                        : null,
                    imageUrl,
                    category
                ]
            );

            res.json({
                success: true,
                ...(await dashboard())
            });

        } catch (error) {
            console.error("新增品項失敗：", error);

            res.status(500).json({
                success: false,
                message: "新增品項失敗"
            });
        }
    }
);

// =========================
// 刪除點心
// =========================

router.delete(
    "/snacks/:id",
    ...adminOnly,
    async (req, res) => {
        try {
            const snack = await get(
                `
                SELECT id
                FROM snacks
                WHERE id = ?
                `,
                [req.params.id]
            );

            if (!snack) {
                return res.status(404).json({
                    success: false,
                    message: "找不到此品項"
                });
            }

            // PostgreSQL 正確 Transaction
            await db.transaction(async client => {
                await client.query(
                    `
                    DELETE FROM votes
                    WHERE snack_id = $1
                    `,
                    [snack.id]
                );

                await client.query(
                    `
                    DELETE FROM snacks
                    WHERE id = $1
                    `,
                    [snack.id]
                );
            });

            res.json({
                success: true,
                message: "品項已刪除",
                ...(await dashboard())
            });

        } catch (error) {
            console.error("品項刪除失敗：", error);

            res.status(500).json({
                success: false,
                message: "品項刪除失敗"
            });
        }
    }
);

// =========================
// 匯入學生 CSV
// =========================

router.post(
    "/users/import",
    ...adminOnly,
    async (req, res) => {
        try {
            const { csvText } = req.body;

            if (
                typeof csvText !== "string" ||
                !csvText.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message: "請選擇 CSV 檔案"
                });
            }

            const rows = parseCsv(
                csvText.replace(/^\uFEFF/, "")
            );

            const [header, ...data] = rows;

            if (
                !header ||
                header
                    .map(value => value.toLowerCase())
                    .join(",") !==
                "student_id,name,password"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "CSV 欄位必須是 student_id,name,password"
                });
            }

            if (!data.length) {
                return res.status(400).json({
                    success: false,
                    message: "CSV 沒有帳號資料"
                });
            }

            if (data.length > 43) {
                return res.status(400).json({
                    success: false,
                    message: "一次最多匯入 43 位學生"
                });
            }

            const seen = new Set();

            for (const [username, name, password] of data) {
                if (
                    !username ||
                    !name ||
                    !password ||
                    password.length < 6
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "每列都需要學號、姓名與至少 6 碼密碼"
                    });
                }

                if (
                    username === "admin" ||
                    seen.has(username)
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "學號不可為 admin，且不可重複"
                    });
                }

                seen.add(username);
            }

            // 先產生密碼 hash
            const usersToImport = [];

            for (const [username, name, password] of data) {
                const passwordHash =
                    await bcrypt.hash(password, 12);

                usersToImport.push({
                    username,
                    name,
                    passwordHash
                });
            }

            // PostgreSQL 正確 Transaction
            await db.transaction(async client => {
                for (const user of usersToImport) {
                    await client.query(
                        `
                        INSERT INTO users (
                            username,
                            name,
                            password_hash,
                            role,
                            must_change_password
                        )
                        VALUES (
                            $1,
                            $2,
                            $3,
                            'student',
                            TRUE
                        )
                        ON CONFLICT (username)
                        DO UPDATE SET
                            name = EXCLUDED.name,
                            password_hash = EXCLUDED.password_hash,
                            role = 'student',
                            must_change_password = TRUE
                        `,
                        [
                            user.username,
                            user.name,
                            user.passwordHash
                        ]
                    );
                }
            });

            res.json({
                success: true,
                message: `已匯入 ${data.length} 位學生帳號`,
                ...(await dashboard())
            });

        } catch (error) {
            console.error("帳號匯入失敗：", error);

            res.status(500).json({
                success: false,
                message: "帳號匯入失敗"
            });
        }
    }
);

// =========================
// 修改點心
// =========================

router.put(
    "/snacks/:id",
    ...adminOnly,
    async (req, res) => {
        try {
            const {
                name,
                description = "",
                price = null,
                active,
                category = "snack",
                imageUrl = ""
            } = req.body;

            if (!name?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "請輸入點心名稱"
                });
            }

            if (!["snack", "drink"].includes(category)) {
                return res.status(400).json({
                    success: false,
                    message: "品項分類無效"
                });
            }

            if (
                imageUrl &&
                (
                    !imageUrl.startsWith("data:image/") ||
                    imageUrl.length > 3000000
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "圖片格式不正確或檔案過大（最多 2 MB）"
                });
            }

            await run(
                `
                UPDATE snacks
                SET
                    name = ?,
                    description = ?,
                    price = ?,
                    image_url = ?,
                    category = ?,
                    active = ?
                WHERE id = ?
                `,
                [
                    name.trim(),
                    description.trim(),
                    Number.isFinite(Number(price))
                        ? Number(price)
                        : null,
                    imageUrl,
                    category,
                    Boolean(active),
                    req.params.id
                ]
            );

            res.json({
                success: true,
                ...(await dashboard())
            });

        } catch (error) {
            console.error("品項修改失敗：", error);

            res.status(500).json({
                success: false,
                message: "品項修改失敗"
            });
        }
    }
);

module.exports = router;