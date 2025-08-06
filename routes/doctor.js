const express = require('express');
const router = express.Router();
const {authMiddleware,checkRole} = require('../middlewares/authMiddleware');

router.get('/dashboard',authMiddleware, checkRole('doctor'), (req, res) => {
  res.json({ message: 'Doctor dashboard', user: req.user });
});
router.get('/appointments', async (req, res) => {
  const { hospital_id, doctor_id, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let filters = [];
    let values = [];

    if (hospital_id) {
      filters.push('d.hospital_id = ?');
      values.push(hospital_id);
    }

    if (doctor_id) {
      filters.push('a.doctor_id = ?');
      values.push(doctor_id);
    }

    const whereClause = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

    const query = `
      SELECT 
        a.id AS appointment_id,
        a.appointment_date,
        a.status,
        a.token,
        a.notes,
        a.cancel_reason,
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.profile_picture,
        d.consultation_fees,
        h.id AS hospital_id,
        h.name AS hospital_name,
        p.id AS patient_id,
        p.name AS patient_name
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN hospitals h ON d.hospital_id = h.id
      LEFT JOIN patients p ON a.patient_id = p.id
      ${whereClause}
      ORDER BY a.appointment_date DESC
      LIMIT ? OFFSET ?
    `;

    values.push(parseInt(limit), parseInt(offset));

    const [appointments] = await db.query(query, values);

    res.json({
      success: true,
      page: parseInt(page),
      limit: parseInt(limit),
      appointments
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/appointments/:id/status', async (req, res) => {
  const appointmentId = req.params.id;
  const { status } = req.body;

  // Only allow predefined status values
  const validStatuses = ['pending', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value' });
  }

  try {
    const [result] = await db.query(
      `UPDATE appointments SET status = ? WHERE id = ?`,
      [status, appointmentId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
