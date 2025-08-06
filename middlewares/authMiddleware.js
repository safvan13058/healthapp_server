const jwt = require('jsonwebtoken');
const db = require('../db');
const SECRET = 'your_jwt_secret'; // Store in .env for production


const authMiddleware = async (req, res, next) => {
  const rawToken = req.headers['authorization'];
  const token = rawToken && rawToken.startsWith('Bearer ')
    ? rawToken.split(' ')[1]
    : null;

  if (!token) return res.status(401).json({ message: 'Token missing or malformed' });

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.id;

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(403).json({ message: 'Invalid or expired token' });
  }
};
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next(); // Proceed without user

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.id;

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (rows.length > 0) {
      req.user = rows[0]; // Attach user to request
    }
  } catch (err) {
    // Invalid token, ignore and proceed
  }

  next(); // Always call next
};

// Role check middleware (usage: authMiddleware, checkRole('admin'))
const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: insufficient role' });
    }
    next();
  };
};

module.exports = { authMiddleware, checkRole ,optionalAuth};
