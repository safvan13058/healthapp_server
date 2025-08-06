const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const db = require('../db');

const fs = require('fs');

// Define upload path
const uploadPath = path.join(__dirname, 'uploads', 'doctor_images');

// Ensure the folder exists
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
  console.log('[INFO] Created upload folder at', uploadPath);
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

router.get('/dashboard', authMiddleware, checkRole('hospital'), (req, res) => {
  console.log('[INFO] GET /dashboard - Hospital dashboard accessed by user:', req.user?.id || 'unknown');
  res.json({ message: 'Hospital dashboard', user: req.user });
});

router.post('/departments', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  console.log('[INFO] POST /departments - payload keys:', Object.keys(req.body || {}));
  const { name, head_of_department, contact_number, email, hospitalId } = req.body;

  try {
    await db.query(`
      INSERT INTO hospital_departments (hospital_id, name, head_of_department, contact_number, email)
      VALUES (?, ?, ?, ?, ?)
    `, [hospitalId, name, head_of_department, contact_number, email]);

    console.log('[SUCCESS] POST /departments - Department created for hospitalId:', hospitalId);
    res.json({ success: true, message: 'Department created successfully.' });
  } catch (err) {
    console.error('[ERROR] POST /departments - Error creating department:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error creating department.' });
  }
});

// POST /hospitals/:id/images
router.post(
  '/hospitals/:id/images',
  authMiddleware,
  checkRole('admin', 'hospital'),
  upload.array('images', 10), // up to 10 images
  async (req, res) => {
    const hospitalId = req.params.id;
    console.log('[INFO] POST /hospitals/:id/images - hospitalId:', hospitalId, 'files:', (req.files || []).length);
    const imageFiles = req.files;

    if (!imageFiles || imageFiles.length === 0) {
      console.warn('[WARN] POST /hospitals/:id/images - No images uploaded for hospitalId:', hospitalId);
      return res.status(400).json({ success: false, message: 'No images uploaded' });
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      for (const img of imageFiles) {
        const imageUrl = `/uploads/doctor_images/${img.filename}`;
        await conn.query(
          `INSERT INTO hospital_images (hospital_id, image_url, description) VALUES (?, ?, ?)`,
          [hospitalId, imageUrl, null]
        );
        console.log('[INFO] POST /hospitals/:id/images - inserted image for hospitalId:', hospitalId, 'image:', imageUrl);
      }

      await conn.commit();
      console.log('[SUCCESS] POST /hospitals/:id/images - committed transaction for hospitalId:', hospitalId);
      res.status(200).json({ success: true, message: 'Images added successfully' });

    } catch (err) {
      await conn.rollback();
      console.error('[ERROR] POST /hospitals/:id/images - transaction rolled back for hospitalId:', hospitalId, err && err.message, err && err.stack);
      res.status(500).json({ success: false, message: 'Failed to add images' });
    } finally {
      conn.release();
      console.log('[INFO] POST /hospitals/:id/images - DB connection released for hospitalId:', hospitalId);
    }
  }
);

router.put('/departments/:id', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const departmentId = req.params.id;
  console.log('[INFO] PUT /departments/:id - departmentId:', departmentId, 'payload keys:', Object.keys(req.body || {}));
  const { name, head_of_department, contact_number, email } = req.body;

  try {
    await db.query(`
      UPDATE hospital_departments
      SET name = ?, head_of_department = ?, contact_number = ?, email = ?
      WHERE id = ?
    `, [name, head_of_department, contact_number, email, departmentId]);

    console.log('[SUCCESS] PUT /departments/:id - Department updated:', departmentId);
    res.json({ success: true, message: 'Department updated successfully.' });
  } catch (err) {
    console.error('[ERROR] PUT /departments/:id - Error updating department:', departmentId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error updating department.' });
  }
});

// DELETE department
router.delete('/departments/:id', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const departmentId = req.params.id;
  console.log('[INFO] DELETE /departments/:id - departmentId:', departmentId);

  try {
    await db.query(`DELETE FROM hospital_departments WHERE id = ?`, [departmentId]);
    console.log('[SUCCESS] DELETE /departments/:id - Department deleted:', departmentId);
    res.json({ success: true, message: 'Department deleted successfully.' });
  } catch (err) {
    console.error('[ERROR] DELETE /departments/:id - Error deleting department:', departmentId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error deleting department.' });
  }
});

// GET all departments
router.get('/departments', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  console.log('[INFO] GET /departments - fetching all departments');
  try {
    const [departments] = await db.query(`SELECT * FROM hospital_departments`);
    console.log('[SUCCESS] GET /departments - fetched count:', departments.length);
    res.json({ success: true, data: departments });
  } catch (err) {
    console.error('[ERROR] GET /departments - Error fetching departments:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error fetching departments.' });
  }
});

// GET departments by hospital ID
router.get('/departments/hospital/:hospitalId', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const hospitalId = req.params.hospitalId;
  console.log('[INFO] GET /departments/hospital/:hospitalId - hospitalId:', hospitalId);

  try {
    const [departments] = await db.query(
      `SELECT * FROM hospital_departments WHERE hospital_id = ?`,
      [hospitalId]
    );
    console.log('[SUCCESS] GET /departments/hospital/:hospitalId - fetched count:', departments.length, 'hospitalId:', hospitalId);
    res.json({ success: true, data: departments });
  } catch (err) {
    console.error('[ERROR] GET /departments/hospital/:hospitalId - Error fetching departments for hospitalId:', hospitalId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error fetching departments for hospital.' });
  }
});

router.post(
  '/doctors',
  authMiddleware,
  checkRole('admin', 'hospital'),
  upload.single('image'),
  async (req, res) => {
    console.log('[INFO] POST /doctors - route hit. Body keys:', Object.keys(req.body || {}), 'file:', req.file?.filename || 'none');
    try {
      const trim = s => (typeof s === 'string' ? s.trim() : s);

      const name = trim(req.body.name);
      const specialization = trim(req.body.specialization);
      const phone_number = trim(req.body.phone_number);
      const email = trim(req.body.email);
      const department_id = req.body.department_id;
      const hospitalId = req.body.hospitalIds; // now single value
      const imageFile = req.file;

      if (!name || !email || !hospitalId) {
        console.warn('[WARN] POST /doctors - Missing required fields. name/email/hospitalId required.');
      }

      // Step 1: Check if user exists
      const [existingUsers] = await db.query(
        'SELECT id FROM users WHERE email = ? OR phone_number = ?',
        [email, phone_number]
      );
      if (existingUsers.length === 0) {
        await db.query(
          'INSERT INTO users (username, password, role, email, phone_number) VALUES (?, ?, ?, ?, ?)',
          [name.toLowerCase().replace(/\s+/g, ''), 'defaultpassword', 'doctor', email, phone_number]
        );
        console.log('[INFO] POST /doctors - created user for doctor email:', email);
      } else {
        console.log('[INFO] POST /doctors - user already exists for email/phone:', email, phone_number);
      }

      // Step 2: Check if doctor exists
      const [existingDoctor] = await db.query(
        'SELECT id FROM doctors WHERE email = ?',
        [email]
      );
      let doctorId;
      if (existingDoctor.length > 0) {
        doctorId = existingDoctor[0].id;
        console.log('[WARN] POST /doctors - doctor already exists with id:', doctorId);
      } else {
        let imageUrl = null;
        if (imageFile) {
          imageUrl = `/uploads/doctor_images/${imageFile.filename}`;
        }
        const [result] = await db.query(
          'INSERT INTO doctors (name, specialization, phone_number, email, image_url) VALUES (?, ?, ?, ?, ?)',
          [name, specialization, phone_number, email, imageUrl]
        );
        doctorId = result.insertId;
        console.log('[SUCCESS] POST /doctors - new doctor created with id:', doctorId);
      }

      // Step 3: Map to hospital (check before insert)
      const [[exists]] = await db.query(
        'SELECT 1 FROM doctor_hospitals WHERE doctor_id = ? AND hospital_id = ? LIMIT 1',
        [doctorId, hospitalId]
      );
      if (!exists) {
        await db.query(
          'INSERT INTO doctor_hospitals (doctor_id, hospital_id,hospital_department_id) VALUES (?, ?,?)',
          [doctorId, hospitalId, department_id]
        );
        console.log('[INFO] POST /doctors - doctor mapped to hospitalId:', hospitalId, 'doctorId:', doctorId);
      } else {
        console.log('[WARN] POST /doctors - mapping already exists for doctorId/hospitalId:', doctorId, hospitalId);
      }

      // Step 4: Map to department
      if (department_id) {
        const [[deptExists]] = await db.query(
          'SELECT 1 FROM doctor_departments WHERE doctor_id = ? AND department_id = ? LIMIT 1',
          [doctorId, department_id]
        );
        if (!deptExists) {
          await db.query(
            'INSERT INTO doctor_departments (doctor_id, department_id) VALUES (?, ?)',
            [doctorId, department_id]
          );
          console.log('[INFO] POST /doctors - doctor mapped to department:', department_id);
        } else {
          console.log('[WARN] POST /doctors - doctor already mapped to department:', department_id);
        }
      }

      // Step 5: Save image
      if (imageFile) {
        const imageUrl = `/uploads/doctor_images/${imageFile.filename}`;
        // Update main table image_url if missing
        await db.query(
          'UPDATE doctors SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = "")',
          [imageUrl, doctorId]
        );
        // Insert into images table
        await db.query(
          'INSERT INTO doctor_images (doctor_id, image_url, description) VALUES (?, ?, ?)',
          [doctorId, imageUrl, req.body.description || null]
        );
        console.log('[INFO] POST /doctors - image saved and doctor_images inserted for doctorId:', doctorId);
      }

      console.log('[SUCCESS] POST /doctors - doctor created/mapped successfully. doctorId:', doctorId);
      res.json({ success: true, message: 'Doctor created and mapped successfully.', doctorId });
    } catch (err) {
      console.error('[ERROR] POST /doctors - Failed to create doctor:', err && err.message, err && err.stack);
      res.status(500).json({ success: false, message: 'Failed to create doctor.', error: err.message });
    }
  }
);

// Get doctors by hospital ID
router.get('/hospitals/:hospitalId/doctors', async (req, res) => {
  const { hospitalId } = req.params;
  console.log('[INFO] GET /hospitals/:hospitalId/doctors - hospitalId:', hospitalId);
  try {
    const [doctors] = await db.query(
      `SELECT d.* FROM doctors d
       JOIN doctor_hospitals dh ON d.id = dh.doctor_id
       WHERE dh.hospital_id = ?`,
      [hospitalId]
    );
    console.log('[SUCCESS] GET /hospitals/:hospitalId/doctors - returned count:', doctors.length);
    res.json(doctors);
  } catch (err) {
    console.error('[ERROR] GET /hospitals/:hospitalId/doctors -', err && err.message, err && err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove doctor from a hospital
router.delete('/hospitals/:hospitalId/doctors/:doctorId', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const { hospitalId, doctorId } = req.params;
  console.log('[INFO] DELETE /hospitals/:hospitalId/doctors/:doctorId - hospitalId:', hospitalId, 'doctorId:', doctorId);
  try {
    await db.query('DELETE FROM doctor_hospitals WHERE hospital_id = ? AND doctor_id = ?', [hospitalId, doctorId]);
    console.log('[SUCCESS] DELETE /hospitals/:hospitalId/doctors/:doctorId - removed mapping for doctorId:', doctorId);
    res.json({ message: 'Doctor removed from hospital successfully' });
  } catch (err) {
    console.error('[ERROR] DELETE /hospitals/:hospitalId/doctors/:doctorId -', err && err.message, err && err.stack);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/doctor-schedules', authMiddleware, async (req, res) => {
  console.log('[INFO] POST /doctor-schedules - payload keys:', Object.keys(req.body || {}));
  const {
    doctor_id,
    hospital_id,
    day_of_week,
    start_time,
    end_time,
    notes
  } = req.body;

  try {
    await db.query(
      `INSERT INTO doctor_schedules 
       (doctor_id, hospital_id, day_of_week, start_time, end_time, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [doctor_id, hospital_id, day_of_week, start_time, end_time, notes]
    );

    console.log('[SUCCESS] POST /doctor-schedules - schedule added for doctorId:', doctor_id);
    res.status(201).json({ success: true, message: 'Doctor schedule added' });
  } catch (err) {
    console.error('[ERROR] POST /doctor-schedules - Failed to create doctor schedule:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to create doctor schedule' });
  }
});

router.put('/doctor-schedules/:id', authMiddleware, async (req, res) => {
  const scheduleId = req.params.id;
  console.log('[INFO] PUT /doctor-schedules/:id - scheduleId:', scheduleId, 'payload keys:', Object.keys(req.body || {}));
  const {
    day_of_week,
    start_time,
    end_time,
    notes
  } = req.body;

  try {
    await db.query(
      `UPDATE doctor_schedules 
       SET day_of_week = ?, start_time = ?, end_time = ?, notes = ?
       WHERE id = ?`,
      [day_of_week, start_time, end_time, notes, scheduleId]
    );

    console.log('[SUCCESS] PUT /doctor-schedules/:id - schedule updated:', scheduleId);
    res.json({ success: true, message: 'Doctor schedule updated' });
  } catch (err) {
    console.error('[ERROR] PUT /doctor-schedules/:id - Failed to update schedule:', scheduleId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to update schedule' });
  }
});

router.delete('/doctor-schedules/:id', authMiddleware, async (req, res) => {
  const scheduleId = req.params.id;
  console.log('[INFO] DELETE /doctor-schedules/:id - scheduleId:', scheduleId);

  try {
    await db.query(`DELETE FROM doctor_schedules WHERE id = ?`, [scheduleId]);
    console.log('[SUCCESS] DELETE /doctor-schedules/:id - schedule deleted:', scheduleId);
    res.json({ success: true, message: 'Doctor schedule deleted' });
  } catch (err) {
    console.error('[ERROR] DELETE /doctor-schedules/:id - Failed to delete schedule:', scheduleId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to delete schedule' });
  }
});

router.get('/doctor-schedules/doctor/:doctorId', async (req, res) => {
  const doctorId = req.params.doctorId;
  console.log('[INFO] GET /doctor-schedules/doctor/:doctorId - doctorId:', doctorId);

  try {
    const [schedules] = await db.query(
      `SELECT * FROM doctor_schedules WHERE doctor_id = ?`,
      [doctorId]
    );

    console.log('[SUCCESS] GET /doctor-schedules/doctor/:doctorId - returned count:', schedules.length);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[ERROR] GET /doctor-schedules/doctor/:doctorId - Failed to fetch schedules for doctorId:', doctorId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to fetch schedules' });
  }
});

module.exports = router;
