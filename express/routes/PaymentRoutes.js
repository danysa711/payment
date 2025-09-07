const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/PaymentController');
const { authenticateUser, requireAdmin } = require('../middlewares/auth');
const multer = require('multer');

// Setup multer untuk upload file
const upload = multer({ storage: multer.memoryStorage() });

// Routes untuk user
router.post('/qris/payments', authenticateUser, PaymentController.createPayment);
router.get('/qris/payments/user', authenticateUser, PaymentController.getUserPayments);
router.get('/qris/payments/:reference_id', authenticateUser, PaymentController.getPaymentDetail);
router.post('/qris/payments/:reference_id/mark-as-paid', authenticateUser, PaymentController.markAsPaid);

// Routes untuk admin
router.get('/qris/payments', authenticateUser, requireAdmin, PaymentController.getAllPayments);
router.post('/qris/payments/:id/verify', authenticateUser, requireAdmin, PaymentController.verifyPayment);
router.post('/qris/payments/:id/reject', authenticateUser, requireAdmin, PaymentController.rejectPayment);

// Routes untuk pengaturan pembayaran
router.get('/qris/settings', authenticateUser, PaymentController.getPaymentSettings);
router.put('/qris/settings', 
  authenticateUser, 
  requireAdmin, 
  upload.single('qris_image'), 
  PaymentController.updatePaymentSettings
);

module.exports = router;