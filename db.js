// db.js
const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'mysql.gb.stackcp.com',
  port: 40887,
  user: 'safvan13058',
  password: 'safvan@13058',
  database: 'health-36354900',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const promisePool = pool.promise();

// ✅ Test connection once at startup
promisePool.query('SELECT 1')
  .then(() => console.log('✅ Database connected successfully!'))
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1); // Optional: Exit the app if DB is critical
  });

module.exports = promisePool;
