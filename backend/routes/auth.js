const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();

function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get(
            `
            SELECT *
            FROM users
            WHERE username = ?
            `,
            [username],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            }
        );
    });
}

function getUserById(id) {
    return new Promise((resolve, reject) => {
        db.get(
            `
            SELECT id, username, name, role, must_change_password
            FROM users
            WHERE id = ?
            `,
            [id],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            }
        );
    });
}


// POST /api/auth/login
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "請輸入帳號與密碼"
            });
        }

        const user = await getUserByUsername(username);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "帳號或密碼錯誤"
            });
        }

        const passwordCorrect = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordCorrect) {
            return res.status(401).json({
                success: false,
                message: "帳號或密碼錯誤"
            });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        };

        res.json({
            success: true,
            message: "登入成功",
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                mustChangePassword: Boolean(user.must_change_password)
            }
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "伺服器錯誤"
        });
    }
});


// POST /api/auth/logout
router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);

            return res.status(500).json({
                success: false,
                message: "登出失敗"
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            success: true,
            message: "登出成功"
        });
    });
});


// GET /api/auth/me
router.get("/me", requireLogin, async (req, res) => {
    try {
        const user = await getUserById(req.session.user.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "使用者不存在"
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                mustChangePassword: Boolean(user.must_change_password)
            }
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "伺服器錯誤"
        });
    }
});


// POST /api/auth/change-password
router.post("/change-password", requireLogin, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "請填寫完整資訊"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "新密碼至少需要 6 個字元"
            });
        }

        const user = await new Promise((resolve, reject) => {
            db.get(
                `
                SELECT *
                FROM users
                WHERE id = ?
                `,
                [req.session.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "找不到使用者"
            });
        }

        const correct = await bcrypt.compare(
            oldPassword,
            user.password_hash
        );

        if (!correct) {
            return res.status(400).json({
                success: false,
                message: "原密碼錯誤"
            });
        }

        const newHash = await bcrypt.hash(newPassword, 12);

        await new Promise((resolve, reject) => {
            db.run(
                `
                UPDATE users
                SET password_hash = ?,
                    must_change_password = 0
                WHERE id = ?
                `,
                [newHash, user.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        res.json({
            success: true,
            message: "密碼修改成功"
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "伺服器錯誤"
        });
    }
});

module.exports = router;