// controllers/tripayController.js
const crypto = require('crypto');
const axios = require('axios');
const { Subscription, User, SubscriptionPlan, Setting, db } = require('../models');

// Konfigurasi Tripay
const getTripayConfig = async () => {
  try {
    const apiKey = await Setting.findOne({ where: { key: 'tripay_api_key' } });
    const privateKey = await Setting.findOne({ where: { key: 'tripay_private_key' } });
    const merchantCode = await Setting.findOne({ where: { key: 'tripay_merchant_code' } });
    const sandboxMode = await Setting.findOne({ where: { key: 'tripay_sandbox_mode' } });
    
    return {
      apiKey: apiKey ? apiKey.value : process.env.TRIPAY_API_KEY || '',
      privateKey: privateKey ? privateKey.value : process.env.TRIPAY_PRIVATE_KEY || '',
      merchantCode: merchantCode ? merchantCode.value : process.env.TRIPAY_MERCHANT_CODE || '',
      sandboxMode: sandboxMode ? sandboxMode.value === 'true' : false,
      baseUrl: (sandboxMode && sandboxMode.value === 'true') 
        ? 'https://tripay.co.id/api-sandbox' 
        : 'https://tripay.co.id/api'
    };
  } catch (error) {
    console.error('Error mengambil konfigurasi Tripay:', error);
    return {
      apiKey: process.env.TRIPAY_API_KEY || '',
      privateKey: process.env.TRIPAY_PRIVATE_KEY || '',
      merchantCode: process.env.TRIPAY_MERCHANT_CODE || '',
      sandboxMode: false,
      baseUrl: 'https://tripay.co.id/api'
    };
  }
};

// Mendapatkan channel pembayaran dari Tripay
const getPaymentChannels = async (req, res) => {
  try {
    const config = await getTripayConfig();
    
    const response = await axios.get(`${config.baseUrl}/merchant/payment-channel`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      }
    });

    return res.status(200).json(response.data.data);
  } catch (error) {
    console.error('Error mengambil metode pembayaran:', error);
    return res.status(500).json({ error: 'Gagal mengambil metode pembayaran' });
  }
};

// Kalkulasi biaya transaksi
const calculateFee = async (req, res) => {
  try {
    const { amount, code } = req.body;
    const config = await getTripayConfig();

    if (!amount || !code) {
      return res.status(400).json({ error: 'Parameter tidak lengkap' });
    }

    const response = await axios.get(`${config.baseUrl}/merchant/fee-calculator`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      },
      params: {
        amount,
        code
      }
    });

    return res.status(200).json(response.data.data);
  } catch (error) {
    console.error('Error menghitung biaya transaksi:', error);
    return res.status(500).json({ error: 'Gagal menghitung biaya transaksi' });
  }
};

// Membuat transaksi baru
const createTransaction = async (req, res) => {
  try {
    const config = await getTripayConfig();
    
    const {
      plan_id,
      payment_method,
      customer_name,
      customer_email,
      customer_phone
    } = req.body;

    const userId = req.userId;

    // Validasi input
    if (!plan_id || !payment_method) {
      return res.status(400).json({ error: 'Parameter tidak lengkap' });
    }

    // Dapatkan user
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }

    // Dapatkan paket langganan
    const plan = await SubscriptionPlan.findByPk(plan_id);
    if (!plan) {
      return res.status(404).json({ error: 'Paket langganan tidak ditemukan' });
    }

    // Generate signature
    const merchantRef = `SUB-${userId}-${Date.now()}`;
    const amount = plan.price;
    const signature = crypto
      .createHmac('sha256', config.privateKey)
      .update(`${config.merchantCode}${merchantRef}${amount}`)
      .digest('hex');

    // Data untuk request ke Tripay
    const data = {
      method: payment_method,
      merchant_ref: merchantRef,
      amount: amount,
      customer_name: customer_name || user.username,
      customer_email: customer_email || user.email || 'customer@example.com',
      customer_phone: customer_phone || '08123456789',
      order_items: [
        {
          name: `${plan.name} Subscription`,
          price: amount,
          quantity: 1,
          subtotal: amount
        }
      ],
      callback_url: `${process.env.BACKEND_URL || req.protocol + '://' + req.get('host')}/api/tripay/callback`,
      return_url: `${process.env.FRONTEND_URL || 'https://kinterstore.my.id'}/user/page/${user.url_slug}/subscription`,
      signature: signature
    };

    // Request ke Tripay untuk membuat transaksi
    const response = await axios.post(`${config.baseUrl}/transaction/create`, data, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      }
    });

    // Simpan data transaksi di database
    const transaction = await db.sequelize.transaction();
    
    try {
      // Cek apakah user sudah memiliki langganan aktif
      const activeSubscription = await Subscription.findOne({
        where: {
          user_id: userId,
          status: 'active',
          end_date: {
            [db.Sequelize.Op.gt]: new Date()
          }
        },
        transaction
      });

      const startDate = new Date();
      let endDate = new Date();
      endDate.setDate(endDate.getDate() + plan.duration_days);

      if (activeSubscription) {
        // Jika sudah ada langganan aktif, perpanjang dari tanggal berakhir langganan saat ini
        endDate = new Date(activeSubscription.end_date);
        endDate.setDate(endDate.getDate() + plan.duration_days);
        
        await activeSubscription.update({
          end_date: endDate,
          payment_status: 'pending',
          payment_method: 'tripay',
          updatedAt: new Date(),
          tripay_reference: response.data.data.reference,
          tripay_merchant_ref: merchantRef
        }, { transaction });
        
        await transaction.commit();
      } else {
        // Jika belum ada langganan aktif, buat langganan baru
        const newSubscription = await Subscription.create({
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
          status: 'active',
          payment_status: 'pending',
          payment_method: 'tripay',
          tripay_reference: response.data.data.reference,
          tripay_merchant_ref: merchantRef
        }, { transaction });
        
        await transaction.commit();
      }
      
      // Return response ke client
      return res.status(200).json(response.data.data);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error membuat transaksi:', error);
    return res.status(500).json({ error: 'Gagal membuat transaksi' });
  }
};

// Detail transaksi
const getTransactionDetail = async (req, res) => {
  try {
    const { reference } = req.params;
    const config = await getTripayConfig();

    if (!reference) {
      return res.status(400).json({ error: 'Parameter tidak lengkap' });
    }

    const response = await axios.get(`${config.baseUrl}/transaction/detail`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      },
      params: {
        reference
      }
    });

    return res.status(200).json(response.data.data);
  } catch (error) {
    console.error('Error mendapatkan detail transaksi:', error);
    return res.status(500).json({ error: 'Gagal mendapatkan detail transaksi' });
  }
};

// Callback dari Tripay
const handleCallback = async (req, res) => {
  try {
    const config = await getTripayConfig();
    
    // Validasi signature dari Tripay
    const callbackSignature = req.headers['x-callback-signature'];
    const json = req.body;
    
    const signature = crypto
      .createHmac('sha256', config.privateKey)
      .update(JSON.stringify(json))
      .digest('hex');
    
    if (callbackSignature !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    // Proses data pembayaran
    const data = json;
    const reference = data.reference;
    const merchantRef = data.merchant_ref;
    const status = data.status;
    
    // Update status pembayaran di database
    const transaction = await db.sequelize.transaction();
    
    try {
      // Cari subscription berdasarkan reference
      const subscription = await Subscription.findOne({
        where: {
          tripay_reference: reference
        },
        transaction
      });
      
      if (!subscription) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Subscription not found' });
      }
      
      // Update status subscription berdasarkan status pembayaran
      if (status === 'PAID') {
        await subscription.update({
          payment_status: 'paid',
          updatedAt: new Date()
        }, { transaction });
        
        // Update user data untuk menandai bahwa mereka memiliki langganan aktif
        const user = await User.findByPk(subscription.user_id, { transaction });
        if (user) {
          user.hasActiveSubscription = true;
          await user.save({ transaction });
        }
      } else if (status === 'EXPIRED' || status === 'FAILED') {
        await subscription.update({
          payment_status: 'failed',
          updatedAt: new Date()
        }, { transaction });
      }
      
      await transaction.commit();
      
      return res.status(200).json({ success: true });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error menangani callback:', error);
    return res.status(500).json({ error: 'Error processing callback' });
  }
};

// Memeriksa status pembayaran secara manual
const checkPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const config = await getTripayConfig();
    
    if (!reference) {
      return res.status(400).json({ error: 'Parameter reference tidak ditemukan' });
    }
    
    // Ambil detail transaksi dari Tripay
    const response = await axios.get(`${config.baseUrl}/transaction/detail`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`
      },
      params: {
        reference
      }
    });
    
    const status = response.data.data.status;
    
    // Update database jika status berubah
    if (status === 'PAID' || status === 'EXPIRED' || status === 'FAILED') {
      const subscription = await Subscription.findOne({
        where: { tripay_reference: reference }
      });
      
      if (subscription) {
        if (status === 'PAID' && subscription.payment_status !== 'paid') {
          await subscription.update({
            payment_status: 'paid',
            updatedAt: new Date()
          });
          
          // Update user data
          const user = await User.findByPk(subscription.user_id);
          if (user) {
            user.hasActiveSubscription = true;
            await user.save();
          }
        } else if ((status === 'EXPIRED' || status === 'FAILED') && subscription.payment_status !== 'failed') {
          await subscription.update({
            payment_status: 'failed',
            updatedAt: new Date()
          });
        }
      }
    }
    
    return res.status(200).json({
      success: true,
      data: response.data.data
    });
  } catch (error) {
    console.error('Error memeriksa status pembayaran:', error);
    return res.status(500).json({ error: 'Gagal memeriksa status pembayaran' });
  }
};

// Mendapatkan status Tripay (aktif/nonaktif)
const getTripayStatus = async (req, res) => {
  try {
    const tripayEnabled = await Setting.findOne({ where: { key: 'tripay_enabled' } });
    return res.status(200).json({ 
      enabled: tripayEnabled ? tripayEnabled.value === 'true' : false 
    });
  } catch (error) {
    console.error('Error mendapatkan status Tripay:', error);
    return res.status(500).json({ error: 'Gagal mendapatkan status Tripay' });
  }
};

module.exports = {
  getPaymentChannels,
  calculateFee,
  createTransaction,
  getTransactionDetail,
  handleCallback,
  checkPaymentStatus,
  getTripayStatus
};