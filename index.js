const express = require('express');
const cors = require('cors');
const app = express();
const os = require("os");
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/users');
const admin = require('./routes/admin');
const doctor = require('./routes/doctor');
const hospital = require('./routes/hospital');
const path = require('path');
// ✅ Enable CORS **before all routes**
app.use(cors({
  origin: "*",  // specific origin for dev
  credentials: true
}));

// ✅ Enable JSON parsing
app.use(express.json());

// ✅ Mount routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/admin', admin);
app.use('/doctor', doctor);
app.use('/hospital', hospital);

app.use('/uploads', express.static(path.join(__dirname, 'routes', 'uploads')));

app.use('/advertisement', express.static(path.join(__dirname, 'public','uploads','advertisement')));


function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address; // Return the first non-internal IPv4
      }
    }
  }
  return "localhost";
}


// ✅ Start server
const server = app.listen(5000, "0.0.0.0", () => {
  const { port } = server.address();
  const ip = getLocalIP();
  console.log(`✅ Server running on:`);
  console.log(`   Local:   http://localhost:${port}`);
  console.log(`   Network: http://${ip}:${port}`);
  console.log("✅ Database connected successfully!");
});