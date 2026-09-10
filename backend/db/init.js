const db = require("./database");
const bcrypt = require("bcryptjs");

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

async function initDatabase() {
    console.log("正在初始化 PostgreSQL 資料庫...");

    // =========================
    // Users
    // =========================

    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL
                CHECK(role IN ('admin', 'student')),
            must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 如果 Supabase 已經有舊 users table，
    // 確保新欄位存在。
    await run(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS must_change_password
        BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // =========================
    // Snacks
    // =========================

    await run(`
        CREATE TABLE IF NOT EXISTS snacks (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price INTEGER,
            image_url TEXT,
            category TEXT NOT NULL DEFAULT 'snack'
                CHECK(category IN ('snack', 'drink')),
            sort_order INTEGER DEFAULT 0,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 相容舊版資料庫
    await run(`
        ALTER TABLE snacks
        ADD COLUMN IF NOT EXISTS image_url TEXT
    `);

    await run(`
        ALTER TABLE snacks
        ADD COLUMN IF NOT EXISTS category
        TEXT NOT NULL DEFAULT 'snack'
    `);

    await run(`
        ALTER TABLE snacks
        ADD COLUMN IF NOT EXISTS sort_order
        INTEGER DEFAULT 0
    `);

    await run(`
        ALTER TABLE snacks
        ADD COLUMN IF NOT EXISTS active
        BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // 修正舊資料中的分類
    await run(`
        UPDATE snacks
        SET category = 'drink'
        WHERE name IN ('珍珠奶茶', '水果優格杯')
          AND category = 'snack'
    `);

    // =========================
    // Settings
    // =========================

    await run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    const settings = [
        ["poll_status", "not_started"],
        ["poll_date", ""],
        ["poll_start_at", ""],
        ["poll_end_at", ""]
    ];

    for (const [key, value] of settings) {
        await run(
            `
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT (key) DO NOTHING
            `,
            [key, value]
        );
    }

    // =========================
    // Votes
    // =========================

    await run(`
        CREATE TABLE IF NOT EXISTS votes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,
            snack_id INTEGER NOT NULL
                REFERENCES snacks(id),
            category TEXT NOT NULL
                CHECK(category IN ('snack', 'drink')),
            voted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, category)
        )
    `);

    // 如果舊版 votes 已經存在，補上 category 欄位
    await run(`
        ALTER TABLE votes
        ADD COLUMN IF NOT EXISTS category TEXT
    `);

    // 從 snacks 自動補上舊投票的分類
    await run(`
        UPDATE votes v
        SET category = COALESCE(s.category, 'snack')
        FROM snacks s
        WHERE v.snack_id = s.id
          AND v.category IS NULL
    `);

    await run(`
        ALTER TABLE votes
        ALTER COLUMN category SET DEFAULT 'snack'
    `);

    // =========================
    // Admin
    // =========================

    const adminPassword = "admin123";
    const adminHash = await bcrypt.hash(
        adminPassword,
        12
    );

    await run(
        `
        INSERT INTO users (
            username,
            name,
            password_hash,
            role,
            must_change_password
        )
        VALUES (?, ?, ?, 'admin', FALSE)
        ON CONFLICT (username) DO NOTHING
        `,
        [
            "admin",
            "管理員",
            adminHash
        ]
    );

    // =========================
    // 43 Students
    // =========================

    const studentPassword = "123456";

    const studentHash = await bcrypt.hash(
        studentPassword,
        12
    );

    for (let i = 1; i <= 43; i++) {
        const username =
            `student${String(i).padStart(2, "0")}`;

        const name = `學生${i}`;

        await run(
            `
            INSERT INTO users (
                username,
                name,
                password_hash,
                role,
                must_change_password
            )
            VALUES (?, ?, ?, 'student', TRUE)
            ON CONFLICT (username) DO NOTHING
            `,
            [
                username,
                name,
                studentHash
            ]
        );
    }

    // =========================
    // Default Snacks
    // =========================

    const snacks = [
        [
            "香脆雞排",
            "現炸雞排，胡椒香氣十足",
            75,
            1,
            "snack"
        ],
        [
            "珍珠奶茶",
            "經典黑糖珍珠奶茶",
            55,
            2,
            "drink"
        ],
        [
            "巧克力鬆餅",
            "外脆內軟的午後點心",
            65,
            3,
            "snack"
        ],
        [
            "起司熱狗",
            "濃郁起司與熱狗",
            50,
            4,
            "snack"
        ],
        [
            "水果優格杯",
            "清爽水果與優格",
            60,
            5,
            "drink"
        ]
    ];

    for (const [
        name,
        description,
        price,
        sortOrder,
        category
    ] of snacks) {
        await run(
            `
            INSERT INTO snacks (
                name,
                description,
                price,
                sort_order,
                category
            )
            SELECT ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
                SELECT 1
                FROM snacks
                WHERE name = ?
            )
            `,
            [
                name,
                description,
                price,
                sortOrder,
                category,
                name
            ]
        );
    }

    console.log("PostgreSQL 資料庫初始化完成！");
    console.log("");
    console.log("管理員帳號：");
    console.log("帳號：admin");
    console.log("密碼：admin123");
    console.log("");
    console.log("學生帳號：");
    console.log("student01 ~ student43");
    console.log("預設密碼：123456");
}

module.exports = initDatabase;