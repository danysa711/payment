// Perbaikan untuk express/server.js
// Tambahkan rute baru dan hapus fallback manual payment methods

const express = require("express");
const cors = require("cors");
const { db } = require("./models");

const licenseRoutes = require("./routes/licenseRoutes");
const softwareRoutes = require("./routes/softwareRoutes");
const softwareVersionRoutes = require("./routes/softwareVersionRoutes");
const orderRoutes = require("./routes/orderRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const publicApiRoutes = require("./routes/publicApiRoutes");
const settingsRoutes = require('./routes/settingsRoutes'); // Rute pengaturan
const qrisRoutes = require("./routes/QrisRoutes");
const baileysRoutes = require("./routes/BaileysRoutes");
const { startScheduler } = require('./utils/scheduler');
startScheduler();

const app = express();
const PORT = process.env.PORT || 3500;

// Definisikan corsOptions dengan semua domain yang diizinkan
const corsOptions = {
  origin: function(origin, callback) {
    // Daftar domain yang diperbolehkan
    const allowedOrigins = [
      "https://kinterstore.com",       
      "https://www.kinterstore.com", 
      "https://db.kinterstore.com",
      "https://kinterstore.my.id",       
      "https://www.kinterstore.my.id", 
      "https://db.kinterstore.my.id",
      "http://localhost:3000",           
      "http://localhost:5173",           
      "http://localhost:5174"            
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      console.log('Origin rejected by CORS:', origin);
      // Izinkan semua origin untuk sementara selama debugging
      callback(null, true);
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200
};

app.get("/api/settings/whatsapp-public", async (req, res) => {
  try {
    // Coba ambil data dari database
    const { WhatsAppSetting } = require('./models');
    
    const settings = await WhatsAppSetting.findOne({
      order: [['id', 'DESC']]
    });
    
    if (settings) {
      return res.json({
        whatsappNumber: settings.whatsapp_number,
        trialEnabled: settings.trial_enabled,
        messageTemplate: settings.trial_template
      });
    } else {
      // Nilai default jika tidak ada data
      return res.json({
        whatsappNumber: '6281284712684',
        trialEnabled: true,
        messageTemplate: 'Halo, saya {username} ({email}) ingin request trial dengan URL: {url_slug}'
      });
    }
  } catch (err) {
    console.error('Error mengakses WhatsApp settings:', err);
    // Kembalikan nilai default jika terjadi error
    return res.json({
      whatsappNumber: '6281284712684',
      trialEnabled: true,
      messageTemplate: 'Halo, saya {username} ({email}) ingin request trial dengan URL: {url_slug}'
    });
  }
});

// Middleware untuk debug
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Request origin:', req.headers.origin);
  
   // Khusus untuk callback Tripay, izinkan akses tanpa CORS
  if (req.url === '/api/tripay/callback') {
    console.log('Tripay callback received, bypassing CORS checks');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Callback-Signature, X-Requested-With');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  } else {
    // Untuk request lain, gunakan CORS normal
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  }
  
  next();
});

// Gunakan CORS di seluruh aplikasi
app.use(cors(corsOptions));

// Tambahkan middleware untuk parsing body
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware khusus untuk preflight requests
app.options('*', cors(corsOptions));

// Handler untuk root path
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Kinterstore API Server</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
          h1 { color: #333; }
          .status { padding: 10px; background: #e7f7e7; border-left: 4px solid #28a745; margin: 20px 0; }
          .endpoints { background: #f8f9fa; padding: 20px; border-radius: 5px; }
          .endpoint { margin-bottom: 10px; }
          .url { font-family: monospace; background: #f1f1f1; padding: 2px 5px; }
          .method { font-size: 0.85em; color: #fff; padding: 2px 6px; border-radius: 3px; margin-left: 5px; }
          .get { background-color: #28a745; }
          .post { background-color: #007bff; }
          .debug { margin-top: 30px; color: #6c757d; font-size: 0.9em; }
          .debug code { background: #f8f9fa; padding: 2px 5px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>Kinterstore API Server</h1>
        <div class="status">
          <strong>Status:</strong> Running
          <br>
          <strong>Server Time:</strong> ${new Date().toISOString()}
          <br>
          <strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}
        </div>

        <div>
          <p>
            <strong>Database Status:</strong> 
            <span id="dbStatus">Checking...</span>
          </p>
          <script>
            // Script sederhana untuk memeriksa koneksi database
            fetch('/api/test')
              .then(response => response.json())
              .then(data => {
                document.getElementById('dbStatus').innerHTML = 'Connected';
                document.getElementById('dbStatus').style.color = '#28a745';
              })
              .catch(error => {
                document.getElementById('dbStatus').innerHTML = 'Error connecting';
                document.getElementById('dbStatus').style.color = '#dc3545';
              });
          </script>
        </div>
        
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
          <p>Kinterstore API Server - &copy; ${new Date().getFullYear()}</p>
          <p><small>Gunakan endpoint ini melalui aplikasi frontend atau API client.</small></p>
        </div>
      </body>
    </html>
  `);
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working", timestamp: new Date().toISOString() });
});

app.get("/api/settings/whatsapp", async (req, res) => {
  try {
    const { WhatsAppSetting } = require('./models');
    
    const settings = await WhatsAppSetting.findOne({
      order: [['id', 'DESC']]
    });
    
    if (settings) {
      return res.json({
        whatsappNumber: settings.whatsapp_number,
        trialEnabled: settings.trial_enabled,
        messageTemplate: settings.trial_template
      });
    } else {
      // Default jika tidak ada data
      return res.json({
        whatsappNumber: '6281284712684',
        trialEnabled: true,
        messageTemplate: 'Halo, saya {username} ({email}) ingin request trial dengan URL: {url_slug}'
      });
    }
  } catch (err) {
    console.error('Error mengakses WhatsApp settings:', err);
    return res.json({
      whatsappNumber: '6281284712684',
      trialEnabled: true,
      messageTemplate: 'Halo, saya {username} ({email}) ingin request trial dengan URL: {url_slug}'
    });
  }
});

// Endpoint untuk menyimpan WhatsApp settings
app.post("/api/settings/whatsapp", async (req, res) => {
  try {
    const { WhatsAppSetting } = require('./models');
    const { whatsappNumber, trialEnabled, messageTemplate } = req.body;
    
    // Validasi input
    if (!whatsappNumber) {
      return res.status(400).json({ error: 'Nomor WhatsApp harus diisi' });
    }
    
    // Buat setting baru
    await WhatsAppSetting.create({
      whatsapp_number: whatsappNumber,
      trial_enabled: trialEnabled !== undefined ? trialEnabled : true,
      trial_template: messageTemplate || 'Halo, saya {username} ({email}) ingin request trial dengan URL: {url_slug}',
      support_enabled: true
    });
    
    res.json({ success: true, message: 'Pengaturan WhatsApp berhasil disimpan' });
  } catch (err) {
    console.error('Error menyimpan pengaturan WhatsApp:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// Routes
app.use("/api", licenseRoutes);
app.use("/api", softwareRoutes);
app.use("/api", softwareVersionRoutes);
app.use("/api", orderRoutes);
app.use("/api", authRoutes);
app.use("/api", userRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api/public", publicApiRoutes);
app.use("/api", settingsRoutes);
app.use("/api", qrisRoutes);
app.use("/api", baileysRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ 
    message: "Terjadi kesalahan pada server", 
    error: process.env.NODE_ENV === 'production' ? undefined : err.message 
  });
});

// Catch 404 and forward to error handler
app.use((req, res) => {
  res.status(404).json({ message: "Endpoint tidak ditemukan" });
});

// Start server
app.listen(PORT, async () => {
  try {
    await db.sequelize.authenticate();
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
  } catch (error) {
    console.error("❌ Gagal menyambungkan database:", error);
  }
});