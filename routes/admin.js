const express = require('express');
const router = express.Router();
const { authMiddleware, checkRole } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const db = require('../db');

// File upload config using multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/advertisement'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});
// Hospital image upload config
const hosptalstorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/hospital'); // separate folder
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const uploadHospitalImage = multer({ hosptalstorage });
const upload = multer({ storage });

// Basic dashboard check
router.get('/', authMiddleware, checkRole('admin'), (req, res) => {
  console.log('[INFO] GET / - Admin dashboard accessed by user:', req.user?.id || 'unknown');
  res.json({ message: 'Admin dashboard', user: req.user });
});

// 🚀 Add new hospital (also creates owner, user, images, and logo)
router.post(
  '/hospitals',
  authMiddleware,
  checkRole('admin'),
  uploadHospitalImage.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'images', maxCount: 10 }
  ]),
  async (req, res) => {
    console.log('[INFO] POST /hospitals - payload received', {
      body: { ...req.body, owner_email: req.body.owner_email ? 'provided' : 'not_provided' },
      files: Object.keys(req.files || {})
    });

    const {
      name, catogory, address, phone_number, email,
      established_date, number_of_beds, website,
      owner_name, owner_email, owner_phone, owner_address,
      latitude, longitude
    } = req.body;

    const logoFile = req.files.logo?.[0];
    const imageFiles = req.files.images || [];

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // Step 1: Create or find user (based on email or phone)
      let userId;
      if (owner_email || owner_phone) {
        const [existingUsers] = await conn.query(
          `SELECT id FROM users WHERE email = ? OR phone_number = ? LIMIT 1`,
          [owner_email, owner_phone]
        );
        if (existingUsers.length > 0) {
          userId = existingUsers[0].id;
          console.log('[WARN] POST /hospitals - existing user found, using userId:', userId);
        } else {
          const [userResult] = await conn.query(
            `INSERT INTO users (username, password, email, phone_number, role) VALUES (?, ?, ?, ?, ?)`,
            [
              owner_email || owner_phone,
              'hashed-default-pass', // Replace with hashed password if needed
              owner_email,
              owner_phone,
              'owner'
            ]
          );
          userId = userResult.insertId;
          console.log('[INFO] POST /hospitals - new user created with id:', userId);
        }
      } else {
        console.warn('[WARN] POST /hospitals - No owner email or phone provided; user not created.');
      }

      // Step 2: Check if owner exists, else insert
      let ownerId;
      const [existingOwnerRows] = await conn.query(
        `SELECT id FROM owners WHERE email = ? OR phone_number = ? LIMIT 1`,
        [owner_email, owner_phone]
      );

      if (existingOwnerRows.length > 0) {
        ownerId = existingOwnerRows[0].id;
        console.log('[WARN] POST /hospitals - existing owner found, using ownerId:', ownerId);
      } else {
        const [ownerResult] = await conn.query(
          `INSERT INTO owners (name, email, phone_number, address) VALUES (?, ?, ?, ?)`,
          [owner_name, owner_email, owner_phone, owner_address]
        );
        ownerId = ownerResult.insertId;
        console.log('[INFO] POST /hospitals - new owner created with id:', ownerId);
      }

      // Step 3: Insert hospital
      const logoPath = logoFile ? `/hospital/${logoFile.filename}` : null;
      const [hospitalResult] = await conn.query(
        `INSERT INTO hospitals 
          (name, logo, catogory, address, phone_number, email, established_date, number_of_beds, website, latitude, longitude, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, logoPath, catogory, address, phone_number,
          email, established_date, number_of_beds, website,
          latitude, longitude, ownerId
        ]
      );
      const hospitalId = hospitalResult.insertId;
      console.log('[INFO] POST /hospitals - hospital created with id:', hospitalId);

      // Step 4: Link hospital and owner
      await conn.query(
        `INSERT INTO hospital_owners (hospital_id, owner_id) VALUES (?, ?)`,
        [hospitalId, ownerId]
      );
      console.log('[INFO] POST /hospitals - hospital_owners link created', { hospitalId, ownerId });

      // Step 5: Insert hospital images
      for (const img of imageFiles) {
        const imageUrl = `/hospital/${img.filename}`;
        await conn.query(
          `INSERT INTO hospital_images (hospital_id, image_url, description) VALUES (?, ?, ?)`,
          [hospitalId, imageUrl, null]
        );
        console.log('[INFO] POST /hospitals - hospital image inserted for hospitalId:', hospitalId, 'image:', imageUrl);
      }

      await conn.commit();
      console.log('[SUCCESS] POST /hospitals - committed transaction for hospitalId:', hospitalId);
      res.status(201).json({ success: true, hospitalId });

    } catch (err) {
      await conn.rollback();
      console.error('[ERROR] POST /hospitals - transaction rolled back:', err && err.message, err && err.stack);
      res.status(500).json({ success: false, error: 'Hospital creation failed' });
    } finally {
      conn.release();
      console.log('[INFO] POST /hospitals - connection released');
    }
  }
);

                                                                                      
// GET ALL HOSPITALS (with owner + images)
router.get('/hospitals', authMiddleware, checkRole('admin'), async (req, res) => {
  console.log('[INFO] GET /hospitals - fetching all hospitals');
  try {
    const [hospitals] = await db.query(`
      SELECT h.*, o.name as owner_name, o.email as owner_email, o.phone_number as owner_phone
      FROM hospitals h
      LEFT JOIN owners o ON h.owner_id = o.id
      ORDER BY h.created_at DESC
    `);

    // Fetch images for all hospitals
    const [images] = await db.query(`SELECT * FROM hospital_images`);
    const hospitalMap = {};

    hospitals.forEach(h => {
      h.images = [];
      hospitalMap[h.id] = h;
    });

    images.forEach(img => {
      if (hospitalMap[img.hospital_id]) {
        hospitalMap[img.hospital_id].images.push(img);
      }
    });

    console.log('[SUCCESS] GET /hospitals - fetched hospitals count:', hospitals.length);
    res.json({ success: true, hospitals: Object.values(hospitalMap) });
  } catch (err) {
    console.error('[ERROR] GET /hospitals - failed to fetch hospitals:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to fetch hospitals' });
  }
});
                                                                                       
// GET SINGLE HOSPITAL BY ID
router.get('/hospitals/:id', authMiddleware, checkRole('admin'), async (req, res) => {
  const hospitalId = req.params.id;
  console.log('[INFO] GET /hospitals/:id - fetching hospital id:', hospitalId);
  try {
    const [[hospital]] = await db.query(`
      SELECT h.*, o.name as owner_name, o.email as owner_email, o.phone_number as owner_phone
      FROM hospitals h
      LEFT JOIN owners o ON h.owner_id = o.id
      WHERE h.id = ?
    `, [hospitalId]);

    if (!hospital) {
      console.warn('[WARN] GET /hospitals/:id - Hospital not found id:', hospitalId);
      return res.status(404).json({ success: false, message: 'Hospital not found' });
    }

    const [images] = await db.query(`SELECT * FROM hospital_images WHERE hospital_id = ?`, [hospitalId]);
    hospital.images = images;

    console.log('[SUCCESS] GET /hospitals/:id - fetched hospital id:', hospitalId);
    res.json({ success: true, hospital });
  } catch (err) {
    console.error('[ERROR] GET /hospitals/:id - Error fetching hospital:', err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error fetching hospital' });
  }
});
                                                                                       
router.put(
  '/hospitals/:id',
  authMiddleware,
  checkRole('admin'),
  uploadHospitalImage.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'images', maxCount: 10 }
  ]),
  async (req, res) => {
    const hospitalId = req.params.id;
    console.log('[INFO] PUT /hospitals/:id - update request for id:', hospitalId, 'body keys:', Object.keys(req.body || {}));
    const {
      name, catogory, address, phone_number, email,
      established_date, number_of_beds, website, status
    } = req.body;

    const logoFile = req.files.logo?.[0];
    const imageFiles = req.files.images || [];

    try {
      // Update hospital details
      const fields = [];
      const values = [];

      if (name) fields.push("name = ?"), values.push(name);
      if (catogory) fields.push("catogory = ?"), values.push(catogory);
      if (address) fields.push("address = ?"), values.push(address);
      if (phone_number) fields.push("phone_number = ?"), values.push(phone_number);
      if (email) fields.push("email = ?"), values.push(email);
      if (established_date) fields.push("established_date = ?"), values.push(established_date);
      if (number_of_beds) fields.push("number_of_beds = ?"), values.push(number_of_beds);
      if (website) fields.push("website = ?"), values.push(website);
      if (status) fields.push("status = ?"), values.push(status);
      if (logoFile) fields.push("logo = ?"), values.push(`/uploads/${logoFile.filename}`);

      if (fields.length > 0) {
        await db.query(`UPDATE hospitals SET ${fields.join(', ')} WHERE id = ?`, [...values, hospitalId]);
        console.log('[INFO] PUT /hospitals/:id - updated fields for id:', hospitalId, 'fields:', fields);
      } else {
        console.log('[WARN] PUT /hospitals/:id - no update fields provided for id:', hospitalId);
      }

      // Add new images if any
      for (const img of imageFiles) {
        const imageUrl = `/hospital/${img.filename}`;
        await db.query(
          `INSERT INTO hospital_images (hospital_id, image_url, description) VALUES (?, ?, ?)`,
          [hospitalId, imageUrl, null]
        );
        console.log('[INFO] PUT /hospitals/:id - inserted new image for id:', hospitalId, 'image:', imageUrl);
      }

      console.log('[SUCCESS] PUT /hospitals/:id - update successful for id:', hospitalId);
      res.json({ success: true, message: 'Hospital updated successfully' });

    } catch (err) {
      console.error('[ERROR] PUT /hospitals/:id - Update failed for id:', hospitalId, err && err.message, err && err.stack);
      res.status(500).json({ success: false, error: 'Update failed' });
    }
  }
);

router.delete('/hospitals/:id', authMiddleware, checkRole('admin'), async (req, res) => {
  const hospitalId = req.params.id;
  console.log('[INFO] DELETE /hospitals/:id - delete request for id:', hospitalId);
  try {
    const [check] = await db.query(`SELECT id FROM hospitals WHERE id = ?`, [hospitalId]);
    if (check.length === 0) {
      console.warn('[WARN] DELETE /hospitals/:id - Hospital not found for id:', hospitalId);
      return res.status(404).json({ success: false, message: 'Hospital not found' });
    }

    await db.query(`DELETE FROM hospitals WHERE id = ?`, [hospitalId]);
    console.log('[SUCCESS] DELETE /hospitals/:id - hospital deleted id:', hospitalId);

    res.json({ success: true, message: 'Hospital deleted' });
  } catch (err) {
    console.error('[ERROR] DELETE /hospitals/:id - Failed to delete hospital id:', hospitalId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Failed to delete hospital' });
  }
});
                                                                                        
// GET hospitals by owner ID
router.get('/owners/:ownerId/hospitals', authMiddleware, checkRole('admin'), async (req, res) => {
  const { ownerId } = req.params;
  console.log('[INFO] GET /owners/:ownerId/hospitals - fetching for ownerId:', ownerId);

  try {
    // Get hospitals owned by this owner
    const [hospitals] = await db.query(`
      SELECT h.*
      FROM hospitals h
      WHERE h.owner_id = ?
      ORDER BY h.created_at DESC
    `, [ownerId]);

    if (hospitals.length === 0) {
      console.warn('[WARN] GET /owners/:ownerId/hospitals - no hospitals found for ownerId:', ownerId);
      return res.status(404).json({ success: false, message: 'No hospitals found for this owner.' });
    }

    // Get images
    const hospitalIds = hospitals.map(h => h.id);
    const [images] = await db.query(
      `SELECT * FROM hospital_images WHERE hospital_id IN (?)`, [hospitalIds]
    );

    const hospitalMap = {};
    hospitals.forEach(h => {
      h.images = [];
      hospitalMap[h.id] = h;
    });

    images.forEach(img => {
      if (hospitalMap[img.hospital_id]) {
        hospitalMap[img.hospital_id].images.push(img);
      }
    });

    console.log('[SUCCESS] GET /owners/:ownerId/hospitals - fetched hospitals count for owner:', ownerId, hospitals.length);
    res.json({ success: true, hospitals: Object.values(hospitalMap) });
  } catch (err) {
    console.error('[ERROR] GET /owners/:ownerId/hospitals - Error fetching hospitals for ownerId:', ownerId, err && err.message, err && err.stack);
    res.status(500).json({ success: false, error: 'Error fetching hospitals for owner.' });
  }
});


router.post(
  '/ads',
  authMiddleware,
  checkRole('admin'),
  upload.single('image'),
  async (req, res) => {
    console.log('[INFO] POST /ads - ad creation request received. Body keys:', Object.keys(req.body || {}));
    try {
      const { title, description, target_url } = req.body;
      const image = req.file;

      if (!image) {
        console.warn('[WARN] POST /ads - Image file is required but not provided.');
        return res.status(400).json({ error: 'Image file is required' });
      }

      const imageUrl = `/advertisement/${image.filename}`; // You may want to prefix with full URL

      const [result] = await db.execute(
        `INSERT INTO advertisements (title, description, image_url, target_url)
         VALUES (?, ?, ?, ?)`,
        [title, description, imageUrl, target_url]
      );

      console.log('[SUCCESS] POST /ads - Advertisement created with id:', result.insertId);
      res.status(201).json({ message: 'Advertisement created successfully', ad_id: result.insertId });
    } catch (err) {
      console.error('[ERROR] POST /ads - Server error while creating ad:', err && err.message, err && err.stack);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// PATCH /ads/:id/toggle - Toggle ad active/inactive
router.patch('/ads/:id/toggle', authMiddleware, checkRole('admin'), async (req, res) => {
  const { id } = req.params;
  console.log('[INFO] PATCH /ads/:id/toggle - toggle ad request for id:', id);
  try {

    // Toggle the value
    const [rows] = await db.execute(`SELECT is_active FROM advertisements WHERE id = ?`, [id]);
    if (rows.length === 0) {
      console.warn('[WARN] PATCH /ads/:id/toggle - Ad not found id:', id);
      return res.status(404).json({ error: 'Ad not found' });
    }

    const currentStatus = rows[0].is_active;
    const newStatus = !currentStatus;

    await db.execute(`UPDATE advertisements SET is_active = ? WHERE id = ?`, [newStatus, id]);

    console.log('[SUCCESS] PATCH /ads/:id/toggle - ad status toggled for id:', id, 'newStatus:', newStatus);
    res.json({ message: `Advertisement status updated`, new_status: newStatus });
  } catch (err) {
    console.error('[ERROR] PATCH /ads/:id/toggle - Server error while toggling ad status for id:', id, err && err.message, err && err.stack);
    res.status(500).json({ error: 'Server error while toggling ad status' });
  }
});
router.delete('/ads/:id', authMiddleware, checkRole('admin'), async (req, res) => {
  const { id } = req.params;
  console.log('[INFO] DELETE /ads/:id - delete ad request for id:', id);
  try {

    const [rows] = await db.execute(`SELECT image_url FROM advertisements WHERE id = ?`, [id]);
    if (rows.length === 0) {
      console.warn('[WARN] DELETE /ads/:id - Ad not found id:', id);
      return res.status(404).json({ error: 'Ad not found' });
    }

    // const imageUrl = rows[0].image_url;
    // const imagePath = path.join(__dirname, '..', 'public', imageUrl);

    await db.execute(`DELETE FROM advertisements WHERE id = ?`, [id]);

    // Optional: Delete image file
    // if (fs.existsSync(imagePath)) {
    //   fs.unlinkSync(imagePath);
    // }

    console.log('[SUCCESS] DELETE /ads/:id - Advertisement deleted id:', id);
    res.json({ message: 'Advertisement deleted successfully' });
  } catch (err) {
    console.error('[ERROR] DELETE /ads/:id - Server error while deleting ad id:', id, err && err.message, err && err.stack);
    res.status(500).json({ error: 'Server error while deleting ad' });
  }
});
// GET /ads - List all advertisements
router.get('/ads', async (req, res) => {
  console.log('[INFO] GET /ads - fetching all advertisements');
  try {
    const [rows] = await db.execute(`SELECT * FROM advertisements ORDER BY created_at DESC`);
    console.log('[SUCCESS] GET /ads - fetched ads count:', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('[ERROR] GET /ads - Server error while fetching ads:', err && err.message, err && err.stack);
    res.status(500).json({ error: 'Server error while fetching ads' });
  }
});

module.exports = router;
