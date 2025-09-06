// routes/settingsRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateUser, requireAdmin } = require('../middlewares/auth');
const {
  getTripaySettings,
  saveTripaySettings,
  getSupportNumber,
  saveSupportNumber,
  getWhatsappTrialSettings,
  saveWhatsappTrialSettings
} = require('../controllers/settingsController');

// Rute pengaturan Tripay (hanya admin)
router.get('/settings/tripay', authenticateUser, requireAdmin, getTripaySettings);
router.post('/settings/tripay', authenticateUser, requireAdmin, saveTripaySettings);

// Rute pengaturan dukungan (publik dan admin)
router.get('/settings/support-number', getSupportNumber);
router.post('/settings/support-number', authenticateUser, requireAdmin, saveSupportNumber);

// Rute pengaturan WhatsApp trial
router.get('/settings/whatsapp-trial', getWhatsappTrialSettings);
router.post('/settings/whatsapp-trial', authenticateUser, requireAdmin, saveWhatsappTrialSettings);

module.exports = router;