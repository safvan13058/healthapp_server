const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const db = require('../db');

const fs =require ('fs');

// Define upload path
const uploadPath = path.join(__dirname, 'uploads', 'doctor_images');

// Ensure the folder exists
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
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
  res.json({ message: 'Hospital dashboard', user: req.user });
});

router.post('/departments', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const { name, head_of_department, contact_number, email, hospitalId } = req.body;


  try {
    await db.query(`
      INSERT INTO hospital_departments (hospital_id, name, head_of_department, contact_number, email)
      VALUES (?, ?, ?, ?, ?)
    `, [hospitalId, name, head_of_department, contact_number, email]);

    res.json({ success: true, message: 'Department created successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Error creating department.' });
  }
});
// POST /hospitals/:id/images

router.post(
  '/hospitals/:id/images',
  authMiddleware,
  checkRole('admin','hospital'),
  upload.array('images', 10), // up to 10 images
  async (req, res) => {
    const hospitalId = req.params.id;
    const imageFiles = req.files;

    if (!imageFiles || imageFiles.length === 0) {
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
      }

      await conn.commit();
      res.status(200).json({ success: true, message: 'Images added successfully' });

    } catch (err) {
      await conn.rollback();
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to add images' });
    } finally {
      conn.release();
    }
  }
);


router.put('/departments/:id', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const departmentId = req.params.id;
  const { name, head_of_department, contact_number, email } = req.body;

  try {
    await db.query(`
      UPDATE hospital_departments
      SET name = ?, head_of_department = ?, contact_number = ?, email = ?
      WHERE id = ?
    `, [name, head_of_department, contact_number, email, departmentId]);

    res.json({ success: true, message: 'Department updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Error updating department.' });
  }
});

// DELETE department
router.delete('/departments/:id', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const departmentId = req.params.id;

  try {
    await db.query(`DELETE FROM hospital_departments WHERE id = ?`, [departmentId]);
    res.json({ success: true, message: 'Department deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Error deleting department.' });
  }
});

// GET all departments
router.get('/departments', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  try {
    const [departments] = await db.query(`SELECT * FROM hospital_departments`);
    res.json({ success: true, data: departments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Error fetching departments.' });
  }
});

// GET departments by hospital ID
router.get('/departments/hospital/:hospitalId', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const hospitalId = req.params.hospitalId;

  try {
    const [departments] = await db.query(
      `SELECT * FROM hospital_departments WHERE hospital_id = ?`,
      [hospitalId]
    );
    res.json({ success: true, data: departments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Error fetching departments for hospital.' });
  }
});











router.post(
  '/doctors',
  authMiddleware,
  checkRole('admin', 'hospital'),
  upload.single('image'),
  async (req, res) => {
    const { name, specialization, phone_number, email, department_id, hospitalIds } = req.body;
    const imageFile = req.file;

    if (!name || !hospitalIds || hospitalIds.length === 0) {
      return res.status(400).json({ message: 'Name and hospitalIds are required' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Step 1: Check if user exists (doctor account)
      let [existingUsers] = await connection.query(
        'SELECT id FROM users WHERE email = ? OR phone_number = ?',
        [email, phone_number]
      );

      if (existingUsers.length === 0) {
        await connection.query(
          'INSERT INTO users (username, password, role, email, phone_number) VALUES (?, ?, ?, ?, ?)',
          [name.toLowerCase().replace(/\s+/g, ''), 'defaultpassword', 'doctor', email, phone_number]
        );
      }

      // Step 2: Check if doctor exists
      let [existingDoctor] = await connection.query('SELECT id FROM doctors WHERE email = ?', [email]);
      let doctorId;

      if (existingDoctor.length > 0) {
        doctorId = existingDoctor[0].id;
      } else {
        const [result] = await connection.query(
          'INSERT INTO doctors (name, specialization, phone_number, email) VALUES (?, ?, ?, ?)',
          [name, specialization, phone_number, email]
        );
        doctorId = result.insertId;
      }

      // Step 3: Map to hospitals

      await connection.query(
        'INSERT IGNORE INTO doctor_hospitals (doctor_id, hospital_id) VALUES (?, ?)',
        [doctorId, hospitalIds]
      );


      // Step 4: Map to department (optional)
      if (department_id) {
        await connection.query(
          'INSERT IGNORE INTO doctor_departments (doctor_id, department_id) VALUES (?, ?)',
          [doctorId, department_id]
        );
      }

      // Step 5: Save image
      if (imageFile) {
        const imageUrl = `/uploads/doctor_images/${imageFile.filename}`;
        await connection.query(
          'INSERT INTO doctor_images (doctor_id, image_url, description) VALUES (?, ?, ?)',
          [doctorId, imageUrl, req.body.description || null]
        );
      }

      await connection.commit();
      res.json({ success: true, message: 'Doctor created and mapped successfully.' });
    } catch (err) {
      await connection.rollback();
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to create doctor.' });
    } finally {
      connection.release();
    }
  }
);

// Get doctors by hospital ID
router.get('/hospitals/:hospitalId/doctors', async (req, res) => {
  const { hospitalId } = req.params;
  try {
    const [doctors] = await db.query(
      `SELECT d.* FROM doctors d
       JOIN doctor_hospitals dh ON d.id = dh.doctor_id
       WHERE dh.hospital_id = ?`,
      [hospitalId]
    );
    res.json(doctors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});



// Remove doctor from a hospital
router.delete('/hospitals/:hospitalId/doctors/:doctorId', authMiddleware, checkRole('admin', 'hospital'), async (req, res) => {
  const { hospitalId, doctorId } = req.params;
  try {
    await db.query('DELETE FROM doctor_hospitals WHERE hospital_id = ? AND doctor_id = ?', [hospitalId, doctorId]);
    res.json({ message: 'Doctor removed from hospital successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});



router.post('/doctor-schedules', authMiddleware, async (req, res) => {
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

    res.status(201).json({ success: true, message: 'Doctor schedule added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to create doctor schedule' });
  }
});

router.put('/doctor-schedules/:id', authMiddleware, async (req, res) => {
  const scheduleId = req.params.id;
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

    res.json({ success: true, message: 'Doctor schedule updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to update schedule' });
  }
});
router.delete('/doctor-schedules/:id', authMiddleware, async (req, res) => {
  const scheduleId = req.params.id;

  try {
    await db.query(`DELETE FROM doctor_schedules WHERE id = ?`, [scheduleId]);
    res.json({ success: true, message: 'Doctor schedule deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to delete schedule' });
  }
});
router.get('/doctor-schedules/doctor/:doctorId', async (req, res) => {
  const doctorId = req.params.doctorId;

  try {
    const [schedules] = await db.query(
      `SELECT * FROM doctor_schedules WHERE doctor_id = ?`,
      [doctorId]
    );

    res.json({ success: true, schedules });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to fetch schedules' });
  }
});



module.exports = router;
