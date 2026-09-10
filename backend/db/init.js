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

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

async function addColumn(sql) {
    try { await run(sql); } catch (error) {
        if (!String(error.message).includes("duplicate column name")) throw error;
    }
}

async function initPostgres() {
    await run(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS snacks (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, price INTEGER, image_url TEXT,
        category TEXT NOT NULL DEFAULT 'snack' CHECK(category IN ('snack', 'drink')),
        sort_order INTEGER DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await run(`CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        snack_id INTEGER NOT NULL REFERENCES snacks(id), category TEXT NOT NULL CHECK(category IN ('snack', 'drink')),
        voted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, category)
    )`);
    for (const key of ['poll_status', 'poll_date', 'poll_start_at', 'poll_end_at']) {
        await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", [key, key === 'poll_status' ? 'not_started' : '']);
    }
    const adminHash = await bcrypt.hash("admin123", 12);
    await run(`INSERT INTO users (username, name, password_hash, role, must_change_password)
               VALUES (?, ?, ?, 'admin', FALSE) ON CONFLICT (username) DO NOTHING`, ['admin', '管理員', adminHash]);
    const studentHash = await bcrypt.hash("123456", 12);
    for (let i = 1; i <= 43; i++) {
        await run(`INSERT INTO users (username, name, password_hash, role, must_change_password)
                   VALUES (?, ?, ?, 'student', TRUE) ON CONFLICT (username) DO NOTHING`, [`student${String(i).padStart(2, '0')}`, `學生${i}`, studentHash]);
    }
    const snacks = [['香脆雞排', '現炸雞排，胡椒香氣十足', 75, 1, 'snack'], ['珍珠奶茶', '經典黑糖珍珠奶茶', 55, 2, 'drink'], ['巧克力鬆餅', '外脆內軟的午後點心', 65, 3, 'snack'], ['起司熱狗', '濃郁起司與熱狗', 50, 4, 'snack'], ['水果優格杯', '清爽水果與優格', 60, 5, 'drink']];
    for (const [name, description, price, sortOrder, category] of snacks) {
        await run(`INSERT INTO snacks (name, description, price, sort_order, category)
                   SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM snacks WHERE name = ?)`, [name, description, price, sortOrder, category, name]);
    }
}

async function initDatabase() {
    console.log("正在初始化資料庫...");
    if (db.isPostgres) { await initPostgres(); console.log("Supabase PostgreSQL 初始化完成！"); return; }

    // 使用者
    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
            must_change_password INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 點心
    await run(`
        CREATE TABLE IF NOT EXISTS snacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price INTEGER,
            image_url TEXT,
            sort_order INTEGER DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // 為既有資料庫補齊後續新增欄位。
    await addColumn("ALTER TABLE snacks ADD COLUMN category TEXT NOT NULL DEFAULT 'snack'");
    await run("UPDATE snacks SET category = 'drink' WHERE name IN ('珍珠奶茶', '水果優格杯') AND category = 'snack'");

    // 系統設定（必須先建立，後面才可寫入預設值）
    await run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    // 投票
    await run(`
        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            snack_id INTEGER NOT NULL,
            voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            FOREIGN KEY(snack_id)
                REFERENCES snacks(id)
        )
    `);
    // 舊版只允許每人一票；升級為每人每一分類各一票。
    const voteColumns = await all("PRAGMA table_info(votes)");
    if (!voteColumns.some(column => column.name === "category")) {
        await run("BEGIN TRANSACTION");
        try {
            await run(`CREATE TABLE votes_next (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                snack_id INTEGER NOT NULL,
                category TEXT NOT NULL CHECK(category IN ('snack', 'drink')),
                voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, category),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(snack_id) REFERENCES snacks(id)
            )`);
            await run(`INSERT INTO votes_next (id, user_id, snack_id, category, voted_at)
                       SELECT v.id, v.user_id, v.snack_id, COALESCE(s.category, 'snack'), v.voted_at
                       FROM votes v LEFT JOIN snacks s ON s.id = v.snack_id`);
            await run("DROP TABLE votes");
            await run("ALTER TABLE votes_next RENAME TO votes");
            await run("COMMIT");
        } catch (error) { await run("ROLLBACK"); throw error; }
    }

    await run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('poll_date', '')`);
    await run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('poll_start_at', '')`);
    await run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('poll_end_at', '')`);

    // 預設投票狀態
    await run(`
        INSERT OR IGNORE INTO settings (key, value)
        VALUES ('poll_status', 'not_started')
    `);

    // 建立管理員
    const adminPassword = "admin123";
    const adminHash = await bcrypt.hash(adminPassword, 12);

    await run(`
        INSERT OR IGNORE INTO users
        (username, name, password_hash, role, must_change_password)
        VALUES (?, ?, ?, 'admin', 0)
    `, [
        "admin",
        "管理員",
        adminHash
    ]);

    // 建立 43 位學生
    const studentPassword = "123456";
    const studentHash = await bcrypt.hash(studentPassword, 12);

    for (let i = 1; i <= 43; i++) {
        const username = `student${String(i).padStart(2, "0")}`;
        const name = `學生${i}`;

        await run(`
            INSERT OR IGNORE INTO users
            (username, name, password_hash, role, must_change_password)
            VALUES (?, ?, ?, 'student', 1)
        `, [
            username,
            name,
            studentHash
        ]);
    }

    // 初始選項可由管理頁自由增修。
    const snacks = [
        ["香脆雞排", "現炸雞排，胡椒香氣十足", 75, 1, "snack"],
        ["珍珠奶茶", "經典黑糖珍珠奶茶", 55, 2, "drink"],
        ["巧克力鬆餅", "外脆內軟的午後點心", 65, 3, "snack"],
        ["起司熱狗", "濃郁起司與熱狗", 50, 4, "snack"],
        ["水果優格杯", "清爽水果與優格", 60, 5, "drink"]
    ];

    for (const [name, description, price, sortOrder, category] of snacks) {
        await run(`
            INSERT OR IGNORE INTO snacks (name, description, price, sort_order, category)
            SELECT ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM snacks WHERE name = ?)
        `, [name, description, price, sortOrder, category, name]);
    }

    console.log("資料庫初始化完成！");
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
