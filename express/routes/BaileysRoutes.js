const express = require('express');
const router = express.Router();
const BaileysController = require('../controllers/BaileysController');
const { authenticateUser, requireAdmin } = require('../middlewares/auth');

// Middleware untuk memastikan hanya admin yang bisa mengakses
router.use(authenticateUser, requireAdmin);

// Route untuk inisialisasi WhatsApp
router.post('/baileys/initialize', BaileysController.initialize);

// Route untuk mendapatkan status login
router.get('/baileys/status', BaileysController.getLoginStatus);

// Route untuk mendapatkan QR code
router.get('/baileys/qrcode', BaileysController.getQRCode);

// Route untuk logout WhatsApp
router.post('/baileys/logout', BaileysController.logout);

// Route untuk update pengaturan grup
router.put('/baileys/group-settings', BaileysController.updateGroupSettings);

// Route untuk mendapatkan daftar grup
router.get('/baileys/groups', BaileysController.getGroups);

module.exports = router;