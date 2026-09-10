const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未設定，無法連接 PostgreSQL。");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

function parameterize(sql) {
    let index = 0;

    return sql.replace(/\?/g, () => {
        index++;
        return `$${index}`;
    });
}

function run(sql, params = [], callback) {
    pool.query(parameterize(sql), params)
        .then(result => {
            callback.call(
                {
                    changes: result.rowCount,
                    lastID: result.rows[0]?.id
                },
                null
            );
        })
        .catch(callback);
}

function get(sql, params = [], callback) {
    pool.query(parameterize(sql), params)
        .then(result => {
            callback(null, result.rows[0]);
        })
        .catch(callback);
}

function all(sql, params = [], callback) {
    pool.query(parameterize(sql), params)
        .then(result => {
            callback(null, result.rows);
        })
        .catch(callback);
}

async function transaction(callback) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await callback(client);

        await client.query("COMMIT");

        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("ROLLBACK 失敗：", rollbackError);
        }

        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    run,
    get,
    all,
    transaction,
    close: () => pool.end()
};