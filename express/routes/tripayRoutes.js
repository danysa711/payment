// routes/tripayRoutes.js
const express = require('express');
const { 
  getPaymentChannels, 
  calculateFee, 
  createTransaction, 
  getTransactionDetail, 
  handleCallback,
  checkPaymentStatus,
  getTripayStatus
} = require('../controllers/tripayController');
const { authenticateUser } = require('../middlewares/auth');

const router = express.Router();

// Rute publik untuk callback (tidak memerlukan autentikasi)
router.post('/callback', handleCallback);

// Rute publik untuk mendapatkan status Tripay
router.get('/status', getTripayStatus);

// Rute yang dilindungi (memerlukan autentikasi)
router.use(authenticateUser);
router.get('/payment-channels', getPaymentChannels);
router.post('/calculate-fee', calculateFee);
router.post('/create-transaction', createTransaction);
router.get('/transaction/:reference', getTransactionDetail);
router.get('/transaction/:reference/check', checkPaymentStatus);

module.exports = router;