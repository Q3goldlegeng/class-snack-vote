function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: "尚未登入"
        });
    }

    next();
}

module.exports = {
    requireLogin
};