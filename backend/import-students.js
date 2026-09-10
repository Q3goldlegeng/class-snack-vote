require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("./db/database");

// 把 callback 形式的 db.run 包成 Promise
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

async function main() {
    try {
        console.log("=================================");
        console.log("開始匯入學生資料...");
        console.log("=================================");
        console.log("");

        // 1. CSV 檔案位置
        const csvPath = path.join(
            __dirname,
            "..",
            "students.csv"
        );

        console.log("CSV 路徑：", csvPath);

        if (!fs.existsSync(csvPath)) {
            throw new Error(
                `找不到 students.csv：${csvPath}`
            );
        }

        // 2. 讀取 CSV
        const content = fs.readFileSync(
            csvPath,
            "utf8"
        );

        const lines = content
            .replace(/^\uFEFF/, "")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line !== "");

        if (lines.length < 2) {
            throw new Error("CSV 沒有學生資料");
        }

        // 3. 檢查 CSV 標題
        const header = lines[0];

        if (header !== "student_id,name,password") {
            throw new Error(
                `CSV 格式錯誤。

第一行必須是：
student_id,name,password

目前讀到：
${header}`
            );
        }

        console.log("CSV 格式正確！");
        console.log("");

        let count = 0;

        // 4. 逐筆匯入
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(",");

            if (parts.length !== 3) {
                throw new Error(
                    `第 ${i + 1} 行格式錯誤：

${lines[i]}

格式應該是：
student_id,name,password`
                );
            }

            const studentId = parts[0].trim();
            const name = parts[1].trim();
            const password = parts[2].trim();

            if (!studentId || !name || !password) {
                throw new Error(
                    `第 ${i + 1} 行資料不完整`
                );
            }

            // 5. 密碼 bcrypt 雜湊
            console.log(`處理：${studentId} ${name}`);

            const passwordHash = await bcrypt.hash(
                password,
                12
            );

            // 6. 新增 / 更新學生
            const result = await run(
                `
                INSERT INTO users (
                    username,
                    name,
                    password_hash,
                    role,
                    must_change_password
                )
                VALUES (
                    ?,
                    ?,
                    ?,
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
                    studentId,
                    name,
                    passwordHash
                ]
            );

            count++;

            console.log(
                `✓ ${studentId} ${name}`
            );
        }

        console.log("");
        console.log("=================================");
        console.log("學生資料匯入完成！");
        console.log("=================================");
        console.log(`總共：${count} 位`);
        console.log("=================================");

    } catch (error) {
        console.error("");
        console.error("❌ 匯入失敗：");
        console.error("");
        console.error(error);
        console.error("");

        process.exitCode = 1;

    } finally {
        await db.close();
    }
}

main();
//node backend/import-students.js