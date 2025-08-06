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
        }
      }

      // Step 2: Check if owner exists, else insert
      let ownerId;
      const [existingOwnerRows] = await conn.query(
        `SELECT id FROM owners WHERE email = ? OR phone_number = ? LIMIT 1`,
        [owner_email, owner_phone]
      );

      if (existingOwnerRows.length > 0) {
        ownerId = existingOwnerRows[0].id;
      } else {
        const [ownerResult] = await conn.query(
          `INSERT INTO owners (name, email, phone_number, address) VALUES (?, ?, ?, ?)`,
          [owner_name, owner_email, owner_phone, owner_address]
        );
        ownerId = ownerResult.insertId;
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

      // Step 4: Link hospital and owner
      await conn.query(
        `INSERT INTO hospital_owners (hospital_id, owner_id) VALUES (?, ?)`,
        [hospitalId, ownerId]
      );

      // Step 5: Insert hospital images
      for (const img of imageFiles) {
        const imageUrl = `/hospital/${img.filename}`;
        await conn.query(
          `INSERT INTO hospital_images (hospital_id, image_url, description) VALUES (?, ?, ?)`,
          [hospitalId, imageUrl, null]
        );
      }

      await conn.commit();
      res.status(201).json({ success: true, hospitalId });

    } catch (err) {
      await conn.rollback();
      console.error(err);
      res.status(500).json({ success: false, error: 'Hospital creation failed' });
    } finally {
      conn.release();
    }
  }
);

                                                                                      
// GET ALL HOSPITALS (with owner + images)
router.get('/hospitals', authMiddleware, checkRole('admin'), async (req, res) => {
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

    res.json({ success: true, hospitals: Object.values(hospitalMap) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to fetch hospitals' });
  }
});
                                                                                       
// GET SINGLE HOSPITAL BY ID
router.get('/hospitals/:id', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const hospitalId = req.params.id;
    const [[hospital]] = await db.query(`
      SELECT h.*, o.name as owner_name, o.email as owner_email, o.phone_number as owner_phone
      FROM hospitals h
      LEFT JOIN owners o ON h.owner_id = o.id
      WHERE h.id = ?
    `, [hospitalId]);

    if (!hospital) return res.status(404).json({ success: false, message: 'Hospital not found' });

    const [images] = await db.query(`SELECT * FROM hospital_images WHERE hospital_id = ?`, [hospitalId]);
    hospital.images = images;

    res.json({ success: true, hospital });
  } catch (err) {
    console.error(err);
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
      }

      // Add new images if any
      for (const img of imageFiles) {
        const imageUrl = `/hospital/${img.filename}`;
        await db.query(
          `INSERT INTO hospital_images (hospital_id, image_url, description) VALUES (?, ?, ?)`,
          [hospitalId, imageUrl, null]
        );
      }

      res.json({ success: true, message: 'Hospital updated successfully' });

    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: 'Update failed' });
    }
  }
);

router.delete('/hospitals/:id', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const hospitalId = req.params.id;

    const [check] = await db.query(`SELECT id FROM hospitals WHERE id = ?`, [hospitalId]);
    if (check.length === 0) return res.status(404).json({ success: false, message: 'Hospital not found' });

    await db.query(`DELETE FROM hospitals WHERE id = ?`, [hospitalId]);

    res.json({ success: true, message: 'Hospital deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to delete hospital' });
  }
});
                                                                                        
// GET hospitals by owner ID
router.get('/owners/:ownerId/hospitals', authMiddleware, checkRole('admin'), async (req, res) => {
  const { ownerId } = req.params;

  try {
    // Get hospitals owned by this owner
    const [hospitals] = await db.query(`
      SELECT h.*
      FROM hospitals h
      WHERE h.owner_id = ?
      ORDER BY h.created_at DESC
    `, [ownerId]);

    if (hospitals.length === 0) {
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

    res.json({ success: true, hospitals: Object.values(hospitalMap) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Error fetching hospitals for owner.' });
  }
});


router.post(
  '/ads',
  authMiddleware,
  checkRole('admin'),
  upload.single('image'),
  async (req, res) => {
    try {
      const { title, description, target_url } = req.body;
      const image = req.file;

      if (!image) {
        return res.status(400).json({ error: 'Image file is required' });
      }

      const imageUrl = `/advertisement/${image.filename}`; // You may want to prefix with full URL

      const [result] = await db.execute(
        `INSERT INTO advertisements (title, description, image_url, target_url)
         VALUES (?, ?, ?, ?)`,
        [title, description, imageUrl, target_url]
      );

      res.status(201).json({ message: 'Advertisement created successfully', ad_id: result.insertId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// PATCH /ads/:id/toggle - Toggle ad active/inactive
router.patch('/ads/:id/toggle', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Toggle the value
    const [rows] = await db.execute(`SELECT is_active FROM advertisements WHERE id = ?`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Ad not found' });

    const currentStatus = rows[0].is_active;
    const newStatus = !currentStatus;

    await db.execute(`UPDATE advertisements SET is_active = ? WHERE id = ?`, [newStatus, id]);

    res.json({ message: `Advertisement status updated`, new_status: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while toggling ad status' });
  }
});
router.delete('/ads/:id', authMiddleware, checkRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(`SELECT image_url FROM advertisements WHERE id = ?`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Ad not found' });

    // const imageUrl = rows[0].image_url;
    // const imagePath = path.join(__dirname, '..', 'public', imageUrl);

    await db.execute(`DELETE FROM advertisements WHERE id = ?`, [id]);

    // Optional: Delete image file
    // if (fs.existsSync(imagePath)) {
    //   fs.unlinkSync(imagePath);
    // }

    res.json({ message: 'Advertisement deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while deleting ad' });
  }
});
// GET /ads - List all advertisements
router.get('/ads', async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT * FROM advertisements ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while fetching ads' });
  }
});

module.exports = router;
