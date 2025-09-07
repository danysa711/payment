// utils/db-helper.js
let db = null;
let isInitialized = false;

// Fungsi untuk memuat modul database
const loadDbModule = () => {
  if (isInitialized) return db;
  
  try {
    const dbModule = require('../models/index');
    
    // Periksa apakah modul benar-benar tersedia
    if (dbModule && dbModule.sequelize) {
      console.log('Database module loaded successfully');
      db = dbModule;
      isInitialized = true;
      return db;
    } else {
      console.error('Database module is invalid (missing sequelize property)');
      return null;
    }
  } catch (err) {
    console.error('Error loading database module:', err);
    return null;
  }
};

// Muat modul database saat file ini diimpor
loadDbModule();

// Fungsi untuk memeriksa koneksi database dan mencoba ulang jika perlu
const ensureDbConnection = async () => {
  try {
    // Coba muat modul jika belum diinisialisasi
    if (!db) {
      db = loadDbModule();
    }
    
    // Periksa apakah db dan sequelize tersedia
    if (!db || !db.sequelize) {
      console.warn('Database module not properly loaded, trying to reload');
      db = loadDbModule();
      
      if (!db || !db.sequelize) {
        console.error('Failed to reload database module');
        return false;
      }
    }
    
    // Periksa apakah authenticate ada sebagai fungsi
    if (typeof db.sequelize.authenticate !== 'function') {
      console.error('Sequelize instance does not have authenticate method');
      return false;
    }
    
    // Coba autentikasi
    try {
      await db.sequelize.authenticate();
      return true;
    } catch (authErr) {
      console.error('Database authentication failed:', authErr);
      return false;
    }
  } catch (error) {
    console.error('Error in ensureDbConnection:', error);
    return false;
  }
};

// Fungsi untuk mengeksekusi query database dengan penanganan error
const safeQuery = async (queryFn, defaultValue = null, operationName = 'database operation') => {
  try {
    // Pastikan koneksi database tersedia
    const isConnected = await ensureDbConnection();
    if (!isConnected || !db || !db.sequelize) {
      console.warn(`Database not connected for ${operationName}, returning default value`);
      return defaultValue;
    }
    
    // Eksekusi query
    try {
      return await queryFn(db.sequelize);
    } catch (queryError) {
      console.error(`Database query error in ${operationName}:`, queryError);
      return defaultValue;
    }
  } catch (error) {
    console.error(`Error in ${operationName}:`, error);
    return defaultValue;
  }
};

// Pemeriksaan koneksi database secara berkala
const setupConnectionMonitoring = (interval = 5 * 60 * 1000) => { // Default: 5 menit
  const monitor = setInterval(async () => {
    try {
      const isConnected = await ensureDbConnection();
      if (isConnected) {
        console.log('✅ Database connection check passed');
      } else {
        console.warn('⚠️ Database connection check failed, attempting to reconnect');
        // Upaya reconnect sudah ada di ensureDbConnection
      }
    } catch (error) {
      console.error('❌ Error in database connection check:', error);
    }
  }, interval);
  
  console.log(`Database connection monitoring started (interval: ${interval/1000}s)`);
  
  // Kembalikan interval untuk memungkinkan pembersihan jika perlu
  return monitor;
};

module.exports = {
  ensureDbConnection,
  safeQuery,
  getDb: () => db,
  setupConnectionMonitoring
};