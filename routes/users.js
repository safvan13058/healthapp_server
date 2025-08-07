// routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const { authMiddleware, checkRole, optionalAuth } = require('../middlewares/authMiddleware');
router.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads', 'profile');
    cb(null, uploadPath); // ✅ This resolves to the correct absolute path
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `profile_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });


// GET all users
// GET all users (mocked without DB)
router.get('/', async (req, res) => {
  console.log('[INFO] GET /users - route hit');
  try {
    // 🧪 Mock data
    const rows = [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' }
    ];

    console.log('[SUCCESS] GET /users - Mock users sent:', rows.length, 'users');
    res.json(rows);
  } catch (err) {
    console.error('[ERROR] GET /users - Unexpected error:', err && err.message, err && err.stack);
    res.status(500).json({ error: 'Unexpected error' });
  }
});


router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, username, email, phone_number, role, image_url FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching profile', error });
  }
});

router.put('/me', authMiddleware, upload.single('image'), async (req, res) => {
  const { username, email, phone_number } = req.body;
  const image_url = req.file ? `/upload/${req.file.filename}` : null;

  try {
    const fields = [];
    const values = [];

    if (username) { fields.push('username = ?'); values.push(username); }
    if (email) { fields.push('email = ?'); values.push(email); }
    if (phone_number) { fields.push('phone_number = ?'); values.push(phone_number); }
    // if (role) { fields.push('role = ?'); values.push(role); }
    if (image_url) { fields.push('image_url = ?'); values.push(image_url); }

    if (fields.length === 0) return res.status(400).json({ message: 'No fields to update' });

    values.push(req.user.id);

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    await db.query(query, values);

    const [updatedUser] = await db.query('SELECT id, username, email, phone_number, role, image_url FROM users WHERE id = ?', [req.user.id]);
    res.json(updatedUser[0]);
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ message: 'Error updating profile', error });
  }
});
router.get('/hospitals/nearby', optionalAuth, async (req, res) => {
  console.log('[INFO] GET /hospitals/nearby - route hit. Query:', req.query);
  const {
    latitude,
    longitude,
    radius = 10,
    page = 1,
    limit = 10,
    department
  } = req.query;

  if (!latitude || !longitude) {
    console.warn('[WARN] GET /hospitals/nearby - missing latitude or longitude');
    return res.status(400).json({ success: false, error: 'latitude and longitude are required' });
  }

  const offset = (page - 1) * limit;
  const userId = req.user?.id || null;

  try {
    // Count query for pagination
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM (
        SELECT h.id,
          (
            6371 * acos(
              cos(radians(?)) * cos(radians(h.latitude)) *
              cos(radians(h.longitude) - radians(?)) +
              sin(radians(?)) * sin(radians(h.latitude))
            )
          ) AS distance,
          GROUP_CONCAT(DISTINCT hd.name) AS department_names
        FROM hospitals h
        LEFT JOIN hospital_departments hd ON h.id = hd.hospital_id
        GROUP BY h.id
        HAVING distance <= ?
        ${department ? `AND department_names LIKE ?` : ''}
      ) AS sub`,
      department
        ? [latitude, longitude, latitude, radius, `%${department}%`]
        : [latitude, longitude, latitude, radius]
    );

    const total = countResult[0]?.total || 0;
    console.log('[INFO] GET /hospitals/nearby - total matching hospitals:', total);

    // Main hospital fetch
    const [results] = await db.query(
      `SELECT h.*,
        (
          6371 * acos(
            cos(radians(?)) * cos(radians(h.latitude)) *
            cos(radians(h.longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(h.latitude))
          )
        ) AS distance,
        GROUP_CONCAT(DISTINCT hi.image_url) AS image_urls,
        GROUP_CONCAT(DISTINCT hi.description) AS image_descriptions,
        GROUP_CONCAT(DISTINCT hd.name) AS department_names,
        ${userId ? 'fh.id IS NOT NULL AS is_favorite' : 'false AS is_favorite'}
      FROM hospitals h
      LEFT JOIN hospital_images hi ON h.id = hi.hospital_id
      LEFT JOIN hospital_departments hd ON h.id = hd.hospital_id
      ${userId ? 'LEFT JOIN favorite_hospitals fh ON fh.hospital_id = h.id AND fh.user_id = ?' : ''}
      GROUP BY h.id
      HAVING distance <= ?
      ${department ? `AND department_names LIKE ?` : ''}
      ORDER BY distance ASC
      LIMIT ? OFFSET ?`,
      department
        ? userId
          ? [latitude, longitude, latitude, userId, radius, `%${department}%`, parseInt(limit), parseInt(offset)]
          : [latitude, longitude, latitude, radius, `%${department}%`, parseInt(limit), parseInt(offset)]
        : userId
          ? [latitude, longitude, latitude, userId, radius, parseInt(limit), parseInt(offset)]
          : [latitude, longitude, latitude, radius, parseInt(limit), parseInt(offset)]
    );

    const hospitals = results.map(h => ({
      ...h,
      is_favorite: !!h.is_favorite,
      images: h.image_urls
        ? h.image_urls.split(',').map((url, i) => ({
            url,
            description: h.image_descriptions?.split(',')[i] || ''
          }))
        : [],
      departments: h.department_names ? h.department_names.split(',') : []
    }));

    console.log('[SUCCESS] GET /hospitals/nearby - returned hospitals count:', hospitals.length);
    res.json({
      success: true,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      hospitals
    });

  } catch (err) {
    console.error('[ERROR] GET /hospitals/nearby - Error:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to fetch hospitals' });
  }
});

router.get('/details/:hospital_id', optionalAuth, async (req, res) => {
  const hospitalId = req.params.hospital_id;
  console.log('[INFO] GET /details/:hospital_id - route hit. hospitalId:', hospitalId);
  const userId = req.user?.id || null;

  try {
    // 1. Basic hospital info
    const [hospitalRows] = await db.query('SELECT * FROM hospitals WHERE id = ?', [hospitalId]);
    if (hospitalRows.length === 0) {
      console.warn('[WARN] GET /details/:hospital_id - Hospital not found:', hospitalId);
      return res.status(404).json({ success: false, message: 'Hospital not found' });
    }
    let hospital = hospitalRows[0];

    // 2. Images
    const [images] = await db.query('SELECT id, image_url FROM hospital_images WHERE hospital_id = ?', [hospitalId]);
    // 3. Departments
    const [departments] = await db.query('SELECT * FROM hospital_departments WHERE hospital_id = ?', [hospitalId]);

    // 4. Doctors for this hospital via doctor_hospitals mapping
    const [doctorMappings] = await db.query(`
      SELECT d.*, dh.hospital_department_id 
      FROM doctors d
      JOIN doctor_hospitals dh ON dh.doctor_id = d.id
      WHERE dh.hospital_id = ?
    `, [hospitalId]);

    // 5. Check favorites if user is logged in
    const favoriteDoctorIds = new Set();
    if (userId) {
      const [favDoctors] = await db.query('SELECT doctor_id FROM favorite_doctors WHERE user_id = ?', [userId]);
      favDoctors.forEach(row => favoriteDoctorIds.add(row.doctor_id));

      const [favHospitals] = await db.query('SELECT 1 FROM favorite_hospitals WHERE user_id = ? AND hospital_id = ?', [userId, hospitalId]);
      hospital.is_favorite = favHospitals.length > 0;
      console.log('[INFO] GET /details/:hospital_id - user favorites checked for userId:', userId);
    } else {
      hospital.is_favorite = false;
    }

    // 6. Group doctors by department with is_favorite
    const doctorsByDept = {};
    doctorMappings.forEach(doctor => {
      const deptId = doctor.hospital_department_id;
      if (!doctorsByDept[deptId]) {
        doctorsByDept[deptId] = [];
      }

      // Add is_favorite to doctor
      doctorsByDept[deptId].push({
        ...doctor,
        is_favorite: favoriteDoctorIds.has(doctor.id),
      });
    });

    // 7. Add doctors to each department
    const departmentsWithDoctors = departments.map(dept => ({
      ...dept,
      doctors: doctorsByDept[dept.id] || [],
    }));

    console.log('[SUCCESS] GET /details/:hospital_id - returning details for hospitalId:', hospitalId);
    return res.json({
      success: true,
      hospital: {
        ...hospital,
        images,
        departments: departmentsWithDoctors,
      },
    });

  } catch (err) {
    console.error('[ERROR] GET /details/:hospital_id - Error fetching hospital details:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get(
  '/hospitals/:hospitalId/doctors',
  optionalAuth,
  async (req, res) => {
    console.log('[INFO] GET /hospitals/:hospitalId/doctors - route hit. Params:', req.params, 'Query:', req.query);
    const { hospitalId } = req.params;
    let {
      department_id,
      name,
      page = 1,
      limit = 10
    } = req.query;

    // parse pagination and ids safely
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 10;
    const offset = (page - 1) * limit;
    const user_id = req.user?.id || null;
    const hid = parseInt(hospitalId, 10);

    if (Number.isNaN(hid)) {
      console.warn('[WARN] GET /hospitals/:hospitalId/doctors - Invalid hospitalId:', hospitalId);
      return res.status(400).json({ success: false, error: 'Invalid hospitalId' });
    }

    try {
      // Build SELECT clause
      const selectCols = [
        'd.id',
        'd.name',
        'd.specialization',
        'd.phone_number',
        'd.email',
        'd.image_url',
        'hd.name AS department_name',
        user_id ? 'CASE WHEN fd.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_favorite' : 'FALSE AS is_favorite'
      ].join(', ');

      // Base FROM / JOINs
      let baseFrom = `
        FROM doctors d
        JOIN doctor_hospitals dh ON dh.doctor_id = d.id
        LEFT JOIN doctor_departments dd ON dd.doctor_id = d.id
        LEFT JOIN hospital_departments hd ON dd.department_id = hd.id
      `;

      // Favorite join only when user_id exists (prevents extra param)
      let favoriteJoin = '';
      if (user_id) {
        favoriteJoin = `LEFT JOIN favorite_doctors fd ON fd.doctor_id = d.id AND fd.user_id = ? AND fd.hospital_id = dh.hospital_id`;
      }

      // WHERE clauses and values array (parameters in order)
      const whereClauses = ['dh.hospital_id = ?'];
      const valuesForWhere = [];

      if (user_id) valuesForWhere.push(user_id);
      valuesForWhere.push(hid);

      if (department_id) {
        // allow department_id from query strings (string -> int)
        const deptId = parseInt(department_id, 10);
        if (Number.isNaN(deptId)) {
          console.warn('[WARN] GET /hospitals/:hospitalId/doctors - Invalid department_id:', department_id);
          return res.status(400).json({ success: false, error: 'Invalid department_id' });
        }
        whereClauses.push('hd.id = ?');
        valuesForWhere.push(deptId);
      }

      if (name) {
        whereClauses.push('d.name LIKE ?');
        valuesForWhere.push(`%${name}%`);
      }

      const whereSQL = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

      // Count total distinct doctors
      const countSQL = `SELECT COUNT(DISTINCT d.id) AS total ${baseFrom} ${favoriteJoin} ${whereSQL}`;
      const [countRows] = await db.query(countSQL, valuesForWhere);
      const total = countRows[0]?.total || 0;
      console.log('[INFO] GET /hospitals/:hospitalId/doctors - total doctors found:', total);

      // Data query: select distinct doctors and group to avoid duplicates due to joins
      const dataSQL = `
        SELECT ${selectCols}
        ${baseFrom}
        ${favoriteJoin}
        ${whereSQL}
        GROUP BY d.id
        ORDER BY d.name ASC
        LIMIT ? OFFSET ?
      `;

      // valuesForWhere plus pagination params
      const dataValues = valuesForWhere.slice(); // copy
      dataValues.push(limit, offset);

      const [rows] = await db.query(dataSQL, dataValues);

      console.log('[SUCCESS] GET /hospitals/:hospitalId/doctors - returned rows:', rows.length);
      res.json({
        success: true,
        page,
        limit,
        total,
        doctors: rows
      });
    } catch (err) {
      console.error('[ERROR] GET /hospitals/:hospitalId/doctors -', err && err.message, err && err.stack);
      res.status(500).json({ success: false, error: 'Failed to fetch doctors' });
    }
  }
);

// Route: GET /hospitals/:hospitalId/doctors/:doctorId/details
router.get('/hospitals/:hospitalId/doctors/:doctorId/details', async (req, res) => {
  console.log('[INFO] GET /hospitals/:hospitalId/doctors/:doctorId/details - route hit. Params:', req.params);
  const { hospitalId, doctorId } = req.params;

  // basic validation
  const hid = parseInt(hospitalId, 10);
  const did = parseInt(doctorId, 10);
  if (Number.isNaN(hid) || Number.isNaN(did)) {
    console.warn('[WARN] GET /hospitals/:hospitalId/doctors/:doctorId/details - Invalid ids:', hospitalId, doctorId);
    return res.status(400).json({ success: false, message: 'Invalid hospitalId or doctorId' });
  }

  try {
    // Get doctor + hospital + hospital-specific department (if any) using doctor_hospitals mapping
    const [doctorRows] = await db.query(
      `
      SELECT 
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.specialization,
        d.phone_number,
        d.email,
        d.image_url,
        dh.hospital_id,
        dh.hospital_department_id,
        h.name AS hospital_name,
        h.address AS hospital_address,
        h.phone_number AS hospital_phone,
        h.email AS hospital_email,
        hd.id AS department_id,
        hd.name AS department_name
      FROM doctors d
      JOIN doctor_hospitals dh ON dh.doctor_id = d.id
      JOIN hospitals h ON dh.hospital_id = h.id
      LEFT JOIN hospital_departments hd ON dh.hospital_department_id = hd.id
      WHERE d.id = ? AND dh.hospital_id = ?
      LIMIT 1
      `,
      [did, hid]
    );

    if (doctorRows.length === 0) {
      console.warn('[WARN] GET /hospitals/:hospitalId/doctors/:doctorId/details - Doctor not found for hospital. doctorId:', did, 'hospitalId:', hid);
      return res.status(404).json({ success: false, message: 'Doctor not found for this hospital.' });
    }

    const row = doctorRows[0];

    // Build doctor object
    const doctor = {
      id: row.doctor_id,
      name: row.doctor_name,
      email: row.email,
      phone_number: row.phone_number,
      specialization: row.specialization,
      profile_image_url: row.image_url || null,
      hospital: {
        id: row.hospital_id,
        name: row.hospital_name,
        address: row.hospital_address,
        phone: row.hospital_phone,
        email: row.hospital_email
      },
      // department is hospital-specific (may be null)
      departments: row.department_id ? [{
        id: row.department_id,
        name: row.department_name
      }] : []
    };

    // schedules (assuming doctor_schedules.doctor_id)
    const [schedules] = await db.query(
      `SELECT id, day_of_week, start_time, end_time, notes
       FROM doctor_schedules
       WHERE doctor_id = ?
       ORDER BY FIELD(day_of_week, 'Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'), start_time`,
      [did]
    );

    // reviews
    const [reviews] = await db.query(
      `SELECT id, patient_name, rating, comment, created_at
       FROM doctor_reviews
       WHERE doctor_id = ?
       ORDER BY created_at DESC`,
      [did]
    );

    const averageRating = reviews.length
      ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
      : null;

    // fees
    const [fees] = await db.query(
      `SELECT consultation_fee
       FROM doctor_fees
       WHERE doctor_id = ?
       LIMIT 1`,
      [did]
    );

    const consultation_fee = fees[0]?.consultation_fee ?? null;

    console.log('[SUCCESS] GET /hospitals/:hospitalId/doctors/:doctorId/details - returning doctor details for doctorId:', did);
    res.json({
      success: true,
      doctor: {
        ...doctor,
        consultation_fee,
        average_rating: averageRating,
        total_reviews: reviews.length,
        schedules,
        reviews
      }
    });
  } catch (error) {
    console.error('[ERROR] GET /hospitals/:hospitalId/doctors/:doctorId/details -', error && error.message, error && error.stack);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/appointments', authMiddleware, async (req, res) => {
  console.log('[INFO] POST /appointments - route hit. Body keys:', Object.keys(req.body || {}));
  const {
    doctor_id,
    appointment_date,
    hospital_id,
    notes,
    patient
  } = req.body;

  if (!doctor_id || !appointment_date || !hospital_id || !patient || !patient.name || !patient.phone_number) {
    console.warn('[WARN] POST /appointments - Missing required fields');
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  const {
    name,
    date_of_birth,
    gender,
    phone_number,
    email,
    address
  } = patient;

  try {
    const userId = req.user.id;

    // ✅ Validate hospital
    const [hospitalRows] = await db.query(`SELECT * FROM hospitals WHERE id = ?`, [hospital_id]);
    if (hospitalRows.length === 0) {
      console.warn('[WARN] POST /appointments - Hospital not found:', hospital_id);
      return res.status(404).json({ success: false, message: 'Hospital not found.' });
    }

    // ✅ Validate doctor
    const [doctorRows] = await db.query(`SELECT * FROM doctors WHERE id = ?`, [doctor_id]);
    if (doctorRows.length === 0) {
      console.warn('[WARN] POST /appointments - Doctor not found:', doctor_id);
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    // ✅ Check how many appointments this user has today
    const [appointmentCountRows] = await db.query(
      `SELECT COUNT(*) AS count
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE p.updatedby = ? AND DATE(a.appointment_date) = DATE(?)`,
      [userId, appointment_date]
    );

    if (appointmentCountRows[0].count >= 3) {
      console.warn('[WARN] POST /appointments - User exceeded daily appointment limit. userId:', userId);
      return res.status(400).json({ success: false, message: 'You can only book up to 3 appointments per day.' });
    }

    // ✅ Insert patient
    const [insertPatientResult] = await db.query(
      `INSERT INTO patients (name, date_of_birth, gender, phone_number, email, address, updatedby)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, date_of_birth, gender, phone_number, email, address, userId]
    );

    const patient_id = insertPatientResult.insertId;
    console.log('[INFO] POST /appointments - patient inserted with id:', patient_id);

    // ✅ Get next token
    const [tokenRows] = await db.query(
      `SELECT MAX(token) AS maxToken
       FROM appointments
       WHERE doctor_id = ? AND hospital_id = ? AND DATE(appointment_date) = DATE(?)`,
      [doctor_id, hospital_id, appointment_date]
    );

    const nextToken = (tokenRows[0].maxToken || 0) + 1;
    console.log('[INFO] POST /appointments - next token calculated:', nextToken);

    // ✅ Insert appointment
    const [insertAppointmentResult] = await db.query(
      `INSERT INTO appointments (doctor_id, patient_id, hospital_id, patient_name, appointment_date, status, notes, token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [doctor_id, patient_id, hospital_id, name, appointment_date, 'pending', notes, nextToken]
    );

    // ✅ Fetch inserted patient and doctor
    const [newPatientRows] = await db.query(`SELECT * FROM patients WHERE id = ?`, [patient_id]);
    const [newDoctorRows] = await db.query(`SELECT * FROM doctors WHERE id = ?`, [doctor_id]);

    console.log('[SUCCESS] POST /appointments - appointment created id:', insertAppointmentResult.insertId);
    res.json({
      success: true,
      message: 'Appointment created successfully.',
      appointment_id: insertAppointmentResult.insertId,
      appointment_date: appointment_date,
      token: nextToken,
      patient: newPatientRows[0],
      doctor: newDoctorRows[0],
      hospital: hospitalRows[0]
    });

  } catch (error) {
    console.error('[ERROR] POST /appointments - Error creating appointment:', error && error.message, error && error.stack);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.get('/appointments/details/:id', authMiddleware, async (req, res) => {
  const appointmentId = req.params.id;
  console.log('[INFO] GET /appointments/details/:id - route hit. appointmentId:', appointmentId);

  try {
    const userId = req.user.id;

    // ✅ Fetch the appointment with doctor, patient, and hospital details
    const [rows] = await db.query(`
      SELECT 
        a.id AS appointment_id,
        a.appointment_date,
        a.status,
        a.token,
        a.notes,
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.specialization,
        h.id AS hospital_id,
        h.name AS hospital_name,
        h.address AS hospital_address,
        p.id AS patient_id,
        p.name AS patient_name,
        p.phone_number,
        p.email,
        p.gender,
        p.date_of_birth,
        p.address AS patient_address
      FROM appointments a
      JOIN doctors d ON a.doctor_id = d.id
      JOIN hospitals h ON a.hospital_id = h.id
      JOIN patients p ON a.patient_id = p.id
      WHERE a.id = ? AND p.updatedby = ?
    `, [appointmentId, userId]);

    if (rows.length === 0) {
      console.warn('[WARN] GET /appointments/details/:id - Appointment not found or access denied. appointmentId:', appointmentId, 'userId:', userId);
      return res.status(404).json({ success: false, message: 'Appointment not found or access denied.' });
    }

    const appointment = rows[0];

    console.log('[SUCCESS] GET /appointments/details/:id - returning appointment id:', appointmentId);
    res.json({
      success: true,
      appointment: {
        id: appointment.appointment_id,
        date: appointment.appointment_date,
        status: appointment.status,
        token: appointment.token,
        notes: appointment.notes,
        doctor: {
          id: appointment.doctor_id,
          name: appointment.doctor_name,
          specialization: appointment.specialization
        },
        hospital: {
          id: appointment.hospital_id,
          name: appointment.hospital_name,
          address: appointment.hospital_address
        },
        patient: {
          id: appointment.patient_id,
          name: appointment.patient_name,
          phone_number: appointment.phone_number,
          email: appointment.email,
          gender: appointment.gender,
          date_of_birth: appointment.date_of_birth,
          address: appointment.patient_address
        }
      }
    });

  } catch (error) {
    console.error('[ERROR] GET /appointments/details/:id - Error fetching appointment:', error && error.message, error && error.stack);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.get('/appointments/mine', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  console.log('[INFO] GET /appointments/mine - route hit for userId:', userId);

  const {
    start_date,
    end_date,
    status
  } = req.query;

  try {
    let query = `
      SELECT 
        a.id AS appointment_id,
        a.appointment_date,
        a.status,
        a.token,
        a.notes,

        -- Patient
        p.id AS patient_id,
        p.name AS patient_name,
        p.date_of_birth,
        p.gender,
        p.phone_number AS patient_phone,
        p.email AS patient_email,
        p.address AS patient_address,
        p.updatedby,

        -- Doctor
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.specialization,
        d.phone_number AS doctor_phone,
        d.email AS doctor_email,
        d.hospital_id AS doctor_hospital_id,

        -- Hospital
        h.id AS hospital_id,
        h.name AS hospital_name,
        h.logo,
        h.catogory,
        h.address AS hospital_address,
        h.phone_number AS hospital_phone,
        h.email AS hospital_email,
        h.established_date,
        h.number_of_beds,
        h.website,
        h.latitude,
        h.longitude,
        h.owner_id,
        h.status AS hospital_status,
        h.created_at AS hospital_created_at,
        h.updated_at AS hospital_updated_at

      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      LEFT JOIN hospitals h ON a.hospital_id = h.id
      WHERE p.updatedby = ?
    `;

    const queryParams = [userId];

    if (start_date) {
      query += ' AND DATE(a.appointment_date) >= ?';
      queryParams.push(start_date);
    }

    if (end_date) {
      query += ' AND DATE(a.appointment_date) <= ?';
      queryParams.push(end_date);
    }

    if (status) {
      query += ' AND a.status = ?';
      queryParams.push(status);
    }

    query += ' ORDER BY a.appointment_date DESC';

    const [rows] = await db.query(query, queryParams);

    const appointments = rows.map(row => ({
      appointment_id: row.appointment_id,
      appointment_date: row.appointment_date,
      status: row.status,
      token: row.token,
      notes: row.notes,
      patient: {
        id: row.patient_id,
        name: row.patient_name,
        date_of_birth: row.date_of_birth,
        gender: row.gender,
        phone_number: row.patient_phone,
        email: row.patient_email,
        address: row.patient_address,
        updatedby: row.updatedby,
      },
      doctor: {
        id: row.doctor_id,
        name: row.doctor_name,
        specialization: row.specialization,
        phone_number: row.doctor_phone,
        email: row.doctor_email,
        hospital_id: row.doctor_hospital_id,
      },
      hospital: {
        id: row.hospital_id,
        name: row.hospital_name,
        logo: row.logo,
        catogory: row.catogory,
        address: row.hospital_address,
        phone_number: row.hospital_phone,
        email: row.hospital_email,
        established_date: row.established_date,
        number_of_beds: row.number_of_beds,
        website: row.website,
        latitude: row.latitude,
        longitude: row.longitude,
        owner_id: row.owner_id,
        status: row.hospital_status,
        created_at: row.hospital_created_at,
        updated_at: row.hospital_updated_at,
      }
    }));

    console.log('[SUCCESS] GET /appointments/mine - returned appointments count:', appointments.length);
    res.json({ success: true, appointments });

  } catch (err) {
    console.error('[ERROR] GET /appointments/mine - Error fetching appointments:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.put('/appointments/:id/cancel', async (req, res) => {
  const { id } = req.params;
  console.log('[INFO] PUT /appointments/:id/cancel - route hit. appointmentId:', id);
  // const { cancel_reason } = req.body

  try {
    // Check if appointment exists
    const [appointment] = await db.query(
      `SELECT * FROM appointments WHERE id = ?`,
      [id]
    );

    if (appointment.length === 0) {
      console.warn('[WARN] PUT /appointments/:id/cancel - Appointment not found:', id);
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    // Prevent double cancel
    if (appointment[0].status === 'cancelled') {
      console.warn('[WARN] PUT /appointments/:id/cancel - Appointment already cancelled:', id);
      return res.status(400).json({ success: false, message: 'Appointment already cancelled.' });
    }

    // Cancel appointment
    await db.query(
      `UPDATE appointments
       SET status = 'cancelled'
       WHERE id = ?`,
      [id]
    );

    console.log('[SUCCESS] PUT /appointments/:id/cancel - Appointment cancelled:', id);
    res.json({ success: true, message: 'Appointment cancelled successfully.' });

  } catch (err) {
    console.error('[ERROR] PUT /appointments/:id/cancel -', err && err.message, err && err.stack);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/favorites/doctors/toggle', authMiddleware, async (req, res) => {
  console.log('[INFO] POST /favorites/doctors/toggle - route hit. Body:', req.body, 'user:', req.user?.id);
  const { doctor_id, hospital_id } = req.body;
  const user_id = req.user.id;
  try {
    const [exists] = await db.query(
      'SELECT id FROM favorite_doctors WHERE user_id = ? AND doctor_id = ? AND hospital_id = ?',
      [user_id, doctor_id, hospital_id]
    );

    if (exists.length > 0) {
      // Remove if already favorited
      await db.query(
        'DELETE FROM favorite_doctors WHERE user_id = ? AND doctor_id = ? AND hospital_id = ?',
        [user_id, doctor_id, hospital_id]
      );
      console.log('[SUCCESS] POST /favorites/doctors/toggle - Doctor removed from favorites. userId:', user_id, 'doctorId:', doctor_id);
      return res.json({ message: 'Doctor removed from favorites', status: false });
    } else {
      // Add if not favorited
      await db.query(
        'INSERT INTO favorite_doctors (user_id, doctor_id, hospital_id) VALUES (?, ?, ?)',
        [user_id, doctor_id, hospital_id]
      );
      console.log('[SUCCESS] POST /favorites/doctors/toggle - Doctor added to favorites. userId:', user_id, 'doctorId:', doctor_id);
      return res.json({ message: 'Doctor added to favorites', status: true });
    }
  } catch (err) {
    console.error('[ERROR] POST /favorites/doctors/toggle -', err && err.message, err && err.stack);
    res.status(500).json({ error: err.message });
  }
});

router.post('/favorites/hospitals/toggle', authMiddleware, async (req, res) => {
  console.log('[INFO] POST /favorites/hospitals/toggle - route hit. Body:', req.body, 'user:', req.user?.id);
  const { hospital_id } = req.body;
  const user_id = req.user.id;

  try {
    const [exists] = await db.query(
      'SELECT id FROM favorite_hospitals WHERE user_id = ? AND hospital_id = ?',
      [user_id, hospital_id]
    );

    if (exists.length > 0) {
      await db.query(
        'DELETE FROM favorite_hospitals WHERE user_id = ? AND hospital_id = ?',
        [user_id, hospital_id]
      );
      console.log('[SUCCESS] POST /favorites/hospitals/toggle - Hospital removed from favorites. userId:', user_id, 'hospitalId:', hospital_id);
      return res.json({ message: 'Hospital removed from favorites', status: false });
    } else {
      await db.query(
        'INSERT INTO favorite_hospitals (user_id, hospital_id) VALUES (?, ?)',
        [user_id, hospital_id]
      );
      console.log('[SUCCESS] POST /favorites/hospitals/toggle - Hospital added to favorites. userId:', user_id, 'hospitalId:', hospital_id);
      return res.json({ message: 'Hospital added to favorites', status: true });
    }
  } catch (err) {
    console.error('[ERROR] POST /favorites/hospitals/toggle -', err && err.message, err && err.stack);
    res.status(500).json({ error: err.message });
  }
});

router.get('/favorites/all', authMiddleware, async (req, res) => {
  const user_id = req.user.id;
  console.log('[INFO] GET /favorites/all - route hit for userId:', user_id);

  try {
    // Fetch favorite doctors
    const [doctors] = await db.query(
      `SELECT 
         fd.id AS fav_id,
         fd.doctor_id,
         fd.hospital_id,
         d.name AS doctor_name,
         d.email AS doctor_email,
         d.phone_number AS doctor_phone,
         d.image_url AS image_url,
         h.name AS hospital_name,
         h.address AS hospital_address,
         fd.created_at
       FROM favorite_doctors fd
       JOIN doctors d ON d.id = fd.doctor_id
       JOIN hospitals h ON h.id = fd.hospital_id
       WHERE fd.user_id = ?`,
      [user_id]
    );

    // Fetch favorite hospitals
    const [hospitals] = await db.query(
      `SELECT 
         fh.id AS fav_id,
         fh.hospital_id,
         h.name AS hospital_name,
         h.address AS hospital_address,
         h.phone_number,
         h.email,
         fh.created_at
       FROM favorite_hospitals fh
       JOIN hospitals h ON h.id = fh.hospital_id
       WHERE fh.user_id = ?`,
      [user_id]
    );

    console.log('[SUCCESS] GET /favorites/all - fetched favorites. doctors:', doctors.length, 'hospitals:', hospitals.length);
    // Return separate arrays
    res.json({ doctors, hospitals });

  } catch (err) {
    console.error('[ERROR] GET /favorites/all -', err && err.message, err && err.stack);
    res.status(500).json({ error: err.message });
  }
});

router.get('/ads/active', async (req, res) => {
  console.log('[INFO] GET /ads/active - route hit');
  try {
    const [rows] = await db.query("SELECT * FROM advertisements WHERE is_active = 1");
    console.log('[SUCCESS] GET /ads/active - active ads count:', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('[ERROR] GET /ads/active -', err && err.message, err && err.stack);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
