const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

const SECRET = 'your_jwt_secret'; // Use .env in production

// 🔐 Helper: Generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// 🔔 Helper: Send OTP (demo only)
const sendOtp = (email, otp) => {
  console.log(`🔐 OTP sent to ${email}: ${otp}`);
  // TODO: Replace this with actual email or SMS sending logic (like nodemailer or AWS SNS)
};
const sendOtpToPhone = (phone_number, otp) => {
  console.log(`🔐 OTP sent to ${phone_number}: ${otp}`);
  // TODO: Replace this with actual email or SMS sending logic (like nodemailer or AWS SNS)
};
// 📩 Step 1: Request OTP
router.post('/request-otp', async (req, res) => {
  const { email, phone_number, name } = req.body;
  const otp = generateOTP();

  if (!email && !phone_number) {
    return res.status(400).json({ error: 'Email or phone number is required' });
  }

  try {
    // Create user if doesn't exist
    const [users] = await db.query(
      'SELECT * FROM users WHERE email = ? OR phone_number = ?',
      [email || null, phone_number || null]
    );

    if (users.length === 0) {
      await db.query(
        'INSERT INTO users (name, email, phone_number) VALUES (?, ?, ?)',
        [name || '', email, phone_number]
      );
    }

    // Insert or update OTP
    await db.query(`
      INSERT INTO otps (email, phone_number, otp, created_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE otp = ?, created_at = NOW()
    `, [email, phone_number, otp, otp]);

    // Send OTP (you decide method)
    if (email) sendOtp(email, otp);
    else sendOtpToPhone(phone_number, otp); // you implement this function

    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ✅ Step 2: Verify OTP and login
router.post('/verify-otp', async (req, res) => {
  const { email, phone_number, otp } = req.body;

  if (!email && !phone_number) {
    return res.status(400).json({ error: 'Email or phone number is required' });
  }

  try {
    const [rows] = await db.query(`
      SELECT * FROM otps
      WHERE (email = ? OR phone_number = ?)
        AND otp = ?
        AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) <= 5
    `, [email || null, phone_number || null, otp]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Remove OTP
    await db.query(
      'DELETE FROM otps WHERE email = ? OR phone_number = ?',
      [email || null, phone_number || null]
    );

    // Get user info
    const [users] = await db.query(
      'SELECT * FROM users WHERE email = ? OR phone_number = ?',
      [email || null, phone_number || null]
    );
    const user = users[0];

    // Sign token
    const token = jwt.sign({ id: user.id, email: user.email, phone: user.phone_number }, SECRET, { expiresIn: '365d' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

module.exports = router;
