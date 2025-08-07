-- USERS TABLE
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(255),
  email VARCHAR(255) NULL UNIQUE,
  phone_number VARCHAR(255),
  image_url VARCHAR(500)
);

-- OTPS TABLE
CREATE TABLE otps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(100) UNIQUE,
  phone_number VARCHAR(20) UNIQUE,
  otp VARCHAR(6) NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE owners (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone_number VARCHAR(20),
  address VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hospital_owners (
  hospital_id BIGINT,
  owner_id BIGINT,
  PRIMARY KEY (hospital_id, owner_id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
);

-- HOSPITALS TABLE
-- HOSPITALS TABLE
CREATE TABLE hospitals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  logo VARCHAR(255),
  catogory VARCHAR(255),
  address VARCHAR(255),
  phone_number VARCHAR(255),
  email VARCHAR(255),
  established_date DATE,
  number_of_beds INT,
  website VARCHAR(255),
  latitude DECIMAL(10, 8),    -- Added
  longitude DECIMAL(11, 8),   -- Added
  owner_id BIGINT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
);




-- HOSPITAL IMAGES
CREATE TABLE hospital_images (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hospital_id BIGINT,
  image_url VARCHAR(255) NOT NULL,
  description TEXT,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
);

-- DOCTORS TABLE
CREATE TABLE doctors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  specialization VARCHAR(255),
  phone_number VARCHAR(255),
  email VARCHAR(255)
);

CREATE TABLE doctor_hospitals (
  doctor_id BIGINT,
  hospital_id BIGINT,
  hospital_department_id BIGINT,
  PRIMARY KEY (doctor_id, hospital_id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
);

-- DOCTOR IMAGES
CREATE TABLE doctor_images (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  image_url VARCHAR(255) NOT NULL,
  description TEXT,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- DOCTOR SCHEDULES
CREATE TABLE doctor_schedules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  hospital_id BIGINT,
  day_of_week VARCHAR(255) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
);

-- DOCTOR REVIEWS
CREATE TABLE doctor_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  reviewer_name VARCHAR(255),
  rating INT NOT NULL,
  comment TEXT,
  review_date DATE NOT NULL,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE doctor_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  patient_name VARCHAR(255),
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

CREATE TABLE doctor_fees (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  consultation_fee DECIMAL(10, 2),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- PATIENTS TABLE
CREATE TABLE patients (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(255),
  phone_number VARCHAR(255),
  email VARCHAR(255),
  address VARCHAR(255),
  updatedby INT,
);

-- DISEASES TABLE
CREATE TABLE diseases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT
);

-- PATIENT DISEASES TABLE
CREATE TABLE patient_diseases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_id BIGINT,
  disease_id BIGINT,
  diagnosis_date DATE,
  notes TEXT,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (disease_id) REFERENCES diseases(id) ON DELETE CASCADE
);

-- APPOINTMENTS TABLE
CREATE TABLE appointments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  patient_id BIGINT,
  patient_name VARCHAR(255),
  appointment_date DATETIME NOT NULL,
  status VARCHAR(255),
  notes TEXT,
  token VARCHAR(255),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- HOSPITAL REVIEWS
CREATE TABLE hospital_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hospital_id BIGINT,
  reviewer_name VARCHAR(255),
  rating INT NOT NULL,
  comment TEXT,
  review_date DATE NOT NULL,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
);

-- HOSPITAL DEPARTMENTS
CREATE TABLE hospital_departments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hospital_id BIGINT,
  name VARCHAR(255) NOT NULL,
  head_of_department VARCHAR(255),
  contact_number VARCHAR(255),
  email VARCHAR(255),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
);

-- DOCTOR DEPARTMENTS
CREATE TABLE doctor_departments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  department_id BIGINT,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES hospital_departments(id) ON DELETE CASCADE
);


CREATE TABLE favorite_doctors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  doctor_id BIGINT,
  hospital_id BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
  UNIQUE(user_id, doctor_id, hospital_id)  -- prevent duplicate favorites
);
CREATE TABLE favorite_hospitals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  hospital_id BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
  UNIQUE(user_id, hospital_id)  -- prevent duplicate favorites
);
CREATE TABLE advertisements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(500),  -- URL of the advertisement image
    target_url VARCHAR(500), -- URL to redirect on click (optional)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- INDEXING FOR PERFORMANCE

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_doctors_email ON doctors(email);
CREATE INDEX idx_patients_email ON patients(email);
CREATE INDEX idx_otps_created_at ON otps(created_at);

CREATE INDEX idx_doctor_hospital_id ON doctors(hospital_id);
CREATE INDEX idx_appointments_doctor_id ON appointments(doctor_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_patient_disease_patient_id ON patient_diseases(patient_id);
CREATE INDEX idx_patient_disease_disease_id ON patient_diseases(disease_id);
CREATE INDEX idx_doctor_schedule_doctor_id ON doctor_schedules(doctor_id);
CREATE INDEX idx_doctor_review_doctor_id ON doctor_reviews(doctor_id);
CREATE INDEX idx_hospital_review_hospital_id ON hospital_reviews(hospital_id);
CREATE INDEX idx_doctor_department_doctor_id ON doctor_departments(doctor_id);
CREATE INDEX idx_doctor_department_department_id ON doctor_departments(department_id);
