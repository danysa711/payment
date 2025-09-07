const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
const db = require('../models/index');
const { sendPaymentNotification } = require('./BaileysController');
const { safeQuery } = require('../utils/db-helper');

// Fungsi untuk membuat referensi ID unik
const generateReferenceId = async () => {
  const date = new Date();
  const prefix = `PAY-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
  const uniqueId = nanoid(8).toUpperCase();
  
  const refId = `${prefix}-${uniqueId}`;
  
  // Cek apakah ID sudah ada
  const [existingPayment] = await db.sequelize.query(
    'SELECT id FROM qris_payments WHERE payment_ref = ?',
    {
      replacements: [refId],
      type: db.sequelize.QueryTypes.SELECT
    }
  );
  
  if (existingPayment) {
    // Jika sudah ada, generate lagi
    return generateReferenceId();
  }
  
  return refId;
};

// Fungsi untuk menghasilkan kode unik 3 digit
const generateUniqueCode = () => {
  return Math.floor(Math.random() * 900) + 100; // 100-999
};

// Controller untuk membuat pembayaran baru
const createPayment = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  
  try {
    const { subscription_plan_id } = req.body;
    const userId = req.userId;
    
    // Validasi input
    if (!subscription_plan_id) {
      return res.status(400).json({ error: 'ID paket langganan harus disediakan' });
    }
    
    // Cek paket langganan
    const [plan] = await db.sequelize.query(
      'SELECT id, price, duration_days, name FROM SubscriptionPlans WHERE id = ?',
      {
        replacements: [subscription_plan_id],
        type: db.sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    
    if (!plan) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Paket langganan tidak ditemukan' });
    }
    
    // Ambil pengaturan pembayaran
    const [paymentSetting] = await db.sequelize.query(
      'SELECT timeout_seconds, max_pending_transactions, qris_image_path, qris_merchant_name FROM qris_settings WHERE id = 1',
      {
        type: db.sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    
    if (!paymentSetting) {
      // Buat pengaturan default jika belum ada
      await db.sequelize.query(
        'INSERT INTO qris_settings (id, timeout_seconds, max_pending_transactions, qris_merchant_name) ' +
        'VALUES (1, 3600, 3, "KinterStore")',
        {
          type: db.sequelize.QueryTypes.INSERT,
          transaction
        }
      );
      
      paymentSetting = {
        timeout_seconds: 3600,
        max_pending_transactions: 3,
        qris_image_path: null,
        qris_merchant_name: 'KinterStore'
      };
    }
    
    // Cek apakah user sudah memiliki pesanan pending yang mencapai batas maksimum
    const [pendingCount] = await db.sequelize.query(
      'SELECT COUNT(*) as count FROM qris_payments WHERE user_id = ? AND payment_state = "pending"',
      {
        replacements: [userId],
        type: db.sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    
    if (pendingCount.count >= paymentSetting.max_pending_transactions) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: `Anda telah mencapai batas maksimum ${paymentSetting.max_pending_transactions} pesanan yang menunggu verifikasi`
      });
    }
    
    // Generate ID referensi dan kode unik
    const referenceId = await generateReferenceId();
    const uniqueCode = generateUniqueCode();
    
    // Hitung total pembayaran
    const amount = Number(plan.price);
    const totalAmount = amount + uniqueCode;
    
    // Hitung waktu kedaluwarsa
    const expiredAt = new Date();
    expiredAt.setSeconds(expiredAt.getSeconds() + paymentSetting.timeout_seconds);
    
    // Buat pembayaran baru
    await db.sequelize.query(
      'INSERT INTO qris_payments ' +
      '(payment_ref, user_id, plan_id, base_amount, unique_digits, total_amount, payment_state, ' +
      'payment_method, expired_at, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, "pending", "qris", ?, NOW(), NOW())',
      {
        replacements: [
          referenceId, userId, plan.id, amount, uniqueCode, totalAmount, expiredAt
        ],
        type: db.sequelize.QueryTypes.INSERT,
        transaction
      }
    );
    
    // Dapatkan ID pembayaran yang baru dibuat
    const [newPayment] = await db.sequelize.query(
      'SELECT id FROM qris_payments WHERE payment_ref = ?',
      {
        replacements: [referenceId],
        type: db.sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    
    // Buat data pembayaran untuk respons
    const paymentData = {
      reference_id: referenceId,
      amount: amount,
      unique_code: uniqueCode,
      total_amount: totalAmount,
      status: 'pending',
      expired_at: expiredAt,
      qris_image: paymentSetting.qris_image_path,
      qris_merchant: paymentSetting.qris_merchant_name
    };
    
    await transaction.commit();
    
    // Kirim notifikasi ke grup WhatsApp
    try {
      await sendPaymentNotification({
        payment_ref: referenceId,
        user_id: userId,
        plan_id: plan.id,
        total_amount: totalAmount
      });
    } catch (error) {
      console.error('Error saat mengirim notifikasi WhatsApp:', error);
      // Lanjutkan proses meskipun notifikasi gagal terkirim
    }
    
    return res.status(201).json({
      message: 'Pembayaran berhasil dibuat',
      payment: paymentData
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error saat membuat pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat membuat pembayaran' });
  }
};

// Controller untuk mendapatkan detail pembayaran
const getPaymentDetail = async (req, res) => {
  try {
    const { reference_id } = req.params;
    
    // Dapatkan detail pembayaran
    const [payment] = await db.sequelize.query(
      'SELECT p.*, u.username, u.email, sp.name as plan_name, sp.duration_days ' +
      'FROM qris_payments p ' +
      'JOIN Users u ON p.user_id = u.id ' +
      'JOIN SubscriptionPlans sp ON p.plan_id = sp.id ' +
      'WHERE p.payment_ref = ?',
      {
        replacements: [reference_id],
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    if (!payment) {
      return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
    }
    
    // Cek apakah pembayaran milik user yang request (kecuali admin)
    if (req.userRole !== 'admin' && payment.user_id !== req.userId) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke pembayaran ini' });
    }
    
    // Ambil pengaturan pembayaran untuk QRIS
    const [paymentSetting] = await db.sequelize.query(
      'SELECT qris_image_path, qris_merchant_name FROM qris_settings WHERE id = 1',
      {
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    // Format response
    const formattedPayment = {
      id: payment.id,
      reference_id: payment.payment_ref,
      amount: payment.base_amount,
      unique_code: payment.unique_digits,
      total_amount: payment.total_amount,
      status: payment.payment_state,
      payment_method: payment.payment_method,
      created_at: payment.created_at,
      expired_at: payment.expired_at,
      verified_at: payment.verified_at,
      verified_by: payment.verified_by,
      verification_method: payment.verification_method,
      user: {
        username: payment.username,
        email: payment.email
      },
      subscription_plan: {
        name: payment.plan_name,
        duration_days: payment.duration_days
      },
      qris_image: paymentSetting?.qris_image_path,
      qris_merchant: paymentSetting?.qris_merchant_name
    };
    
    return res.status(200).json({
      payment: formattedPayment
    });
  } catch (error) {
    console.error('Error saat mendapatkan detail pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat mendapatkan detail pembayaran' });
  }
};

// Controller untuk mendapatkan daftar pembayaran user
const getUserPayments = async (req, res) => {
  try {
    const userId = req.userId;
    const { status } = req.query;
    
    // Buat kondisi SQL berdasarkan status
    let statusCondition = '';
    let statusParams = [];
    
    if (status) {
      statusCondition = 'AND p.payment_state = ?';
      statusParams = [status];
    }
    
    // Dapatkan daftar pembayaran
    const payments = await db.sequelize.query(
      'SELECT p.*, sp.name as plan_name, sp.duration_days ' +
      'FROM qris_payments p ' +
      'JOIN SubscriptionPlans sp ON p.plan_id = sp.id ' +
      'WHERE p.user_id = ? ' + statusCondition + ' ' +
      'ORDER BY p.created_at DESC',
      {
        replacements: [userId, ...statusParams],
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    // Ambil pengaturan pembayaran untuk QRIS
    const [paymentSetting] = await db.sequelize.query(
      'SELECT qris_image_path, qris_merchant_name FROM qris_settings WHERE id = 1',
      {
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    // Format pembayaran
    const formattedPayments = payments.map(payment => ({
      id: payment.id,
      reference_id: payment.payment_ref,
      amount: payment.base_amount,
      unique_code: payment.unique_digits,
      total_amount: payment.total_amount,
      status: payment.payment_state,
      payment_method: payment.payment_method,
      created_at: payment.created_at,
      expired_at: payment.expired_at,
      verified_at: payment.verified_at,
      subscription_plan: {
        name: payment.plan_name,
        duration_days: payment.duration_days
      },
      qris_image: paymentSetting?.qris_image_path,
      qris_merchant: paymentSetting?.qris_merchant_name
    }));
    
    return res.status(200).json({ payments: formattedPayments });
  } catch (error) {
    console.error('Error saat mendapatkan daftar pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat mendapatkan daftar pembayaran' });
  }
};

// Controller untuk mendapatkan daftar semua pembayaran (admin only)
const getAllPayments = async (req, res) => {
  try {
    // Cek apakah user adalah admin
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Anda tidak memiliki akses' });
    }
    
    const { status, keyword, startDate, endDate } = req.query;
    
    // Buat kondisi SQL dan parameter
    let conditions = [];
    let params = [];
    
    if (status) {
      conditions.push('p.payment_state = ?');
      params.push(status);
    }
    
    if (keyword) {
      conditions.push('(p.payment_ref LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    
    if (startDate && endDate) {
      conditions.push('p.created_at BETWEEN ? AND ?');
      params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    // Dapatkan daftar pembayaran
    const payments = await db.sequelize.query(
      'SELECT p.*, u.id as user_id, u.username, u.email, sp.name as plan_name, sp.duration_days ' +
      'FROM qris_payments p ' +
      'JOIN Users u ON p.user_id = u.id ' +
      'JOIN SubscriptionPlans sp ON p.plan_id = sp.id ' +
      whereClause + ' ' +
      'ORDER BY p.created_at DESC',
      {
        replacements: params,
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    // Format data pembayaran
    const formattedPayments = payments.map(payment => ({
      id: payment.id,
      reference_id: payment.payment_ref,
      amount: payment.base_amount,
      unique_code: payment.unique_digits,
      total_amount: payment.total_amount,
      status: payment.payment_state,
      payment_method: payment.payment_method,
      created_at: payment.created_at,
      expired_at: payment.expired_at,
      verified_at: payment.verified_at,
      verified_by: payment.verified_by,
      verification_method: payment.verification_method,
      User: {
        id: payment.user_id,
        username: payment.username,
        email: payment.email
      },
      SubscriptionPlan: {
        name: payment.plan_name,
        duration_days: payment.duration_days
      }
    }));
    
    return res.status(200).json({ payments: formattedPayments });
  } catch (error) {
    console.error('Error saat mendapatkan semua pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat mendapatkan semua pembayaran' });
  }
};

// Controller untuk verifikasi pembayaran (admin only)
const verifyPayment = async (req, res) => {
  try {
    // Cek apakah user adalah admin
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Anda tidak memiliki akses' });
    }
    
    const { id } = req.params;
    
    // Import BaileysController untuk fungsi verifikasi
    const { verifyPayment: baileysVerifyPayment } = require('./BaileysController');
    
    await baileysVerifyPayment(id, 'manual', req.username || 'admin');
    
    return res.status(200).json({ message: 'Pembayaran berhasil diverifikasi' });
  } catch (error) {
    console.error('Error saat verifikasi pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat verifikasi pembayaran' });
  }
};

// Controller untuk menolak pembayaran (admin only)
const rejectPayment = async (req, res) => {
  try {
    // Cek apakah user adalah admin
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Anda tidak memiliki akses' });
    }
    
    const { id } = req.params;
    
    // Import BaileysController untuk fungsi penolakan
    const { rejectPayment: baileysRejectPayment } = require('./BaileysController');
    
    await baileysRejectPayment(id, 'manual', req.username || 'admin');
    
    return res.status(200).json({ message: 'Pembayaran berhasil ditolak' });
  } catch (error) {
    console.error('Error saat menolak pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat menolak pembayaran' });
  }
};

// Controller untuk menandai pembayaran sebagai sudah dibayar
const markAsPaid = async (req, res) => {
  try {
    const { reference_id } = req.params;
    const userId = req.userId;
    
    // Dapatkan pembayaran
    const [payment] = await db.sequelize.query(
      'SELECT * FROM qris_payments WHERE payment_ref = ?',
      {
        replacements: [reference_id],
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    if (!payment) {
      return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
    }
    
    // Cek apakah pembayaran milik user yang request
    if (payment.user_id !== userId) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses ke pembayaran ini' });
    }
    
    // Cek status pembayaran
    if (payment.payment_state !== 'pending') {
      return res.status(400).json({ error: 'Pembayaran tidak dalam status menunggu' });
    }
    
    // Cek apakah pembayaran sudah kedaluwarsa
    if (new Date(payment.expired_at) < new Date()) {
      return res.status(400).json({ error: 'Pembayaran sudah kedaluwarsa' });
    }
    
    // Kirim notifikasi ke grup WhatsApp
    try {
      await sendPaymentNotification(payment);
      
      return res.status(200).json({ 
        message: 'Notifikasi pembayaran berhasil dikirim, mohon tunggu verifikasi dari admin'
      });
    } catch (error) {
      console.error('Error saat mengirim notifikasi WhatsApp:', error);
      return res.status(500).json({ 
        error: 'Terjadi kesalahan saat mengirim notifikasi pembayaran'
      });
    }
  } catch (error) {
    console.error('Error saat menandai pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat menandai pembayaran' });
  }
};

// Controller untuk update pengaturan pembayaran (admin only)
const updatePaymentSettings = async (req, res) => {
  try {
    // Cek apakah user adalah admin
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: 'Anda tidak memiliki akses' });
    }
    
    const { timeout_seconds, max_pending_transactions, qris_merchant_name, wa_message_template } = req.body;
    const qrisImage = req.file;
    
    // Validasi input
    if (timeout_seconds && (isNaN(timeout_seconds) || timeout_seconds < 60)) {
      return res.status(400).json({ error: 'Timeout pembayaran minimal 60 detik' });
    }
    
    if (max_pending_transactions && (isNaN(max_pending_transactions) || max_pending_transactions < 1)) {
      return res.status(400).json({ error: 'Jumlah pesanan maksimal minimal 1' });
    }
    
    // Cek apakah pengaturan sudah ada
    const [existingSettings] = await db.sequelize.query(
      'SELECT id FROM qris_settings WHERE id = 1',
      {
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    // Jika belum ada, buat baru
    if (!existingSettings) {
      await db.sequelize.query(
        'INSERT INTO qris_settings (id, timeout_seconds, max_pending_transactions, qris_merchant_name, wa_message_template) ' +
        'VALUES (1, 3600, 3, "KinterStore", "Balas 1 untuk verifikasi, 2 untuk tolak")',
        {
          type: db.sequelize.QueryTypes.INSERT
        }
      );
    }
    
    // Buat array untuk field dan value yang akan diupdate
    let updateFields = [];
    let updateValues = [];
    
    if (timeout_seconds) {
      updateFields.push('timeout_seconds = ?');
      updateValues.push(timeout_seconds);
    }
    
    if (max_pending_transactions) {
      updateFields.push('max_pending_transactions = ?');
      updateValues.push(max_pending_transactions);
    }
    
    if (qris_merchant_name) {
      updateFields.push('qris_merchant_name = ?');
      updateValues.push(qris_merchant_name);
    }
    
    if (wa_message_template) {
      updateFields.push('wa_message_template = ?');
      updateValues.push(wa_message_template);
    }
    
    // Jika ada file QRIS baru
    if (qrisImage) {
      // Direktori untuk menyimpan gambar
      const uploadDir = path.join(__dirname, '../public/uploads');
      
      // Buat direktori jika belum ada
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      // Nama file baru
      const filename = `qris_${Date.now()}${path.extname(qrisImage.originalname)}`;
      const filepath = path.join(uploadDir, filename);
      
      // Simpan file
      fs.writeFileSync(filepath, qrisImage.buffer);
      
      // Path relatif untuk akses melalui API
      const relativePath = `/uploads/${filename}`;
      
      // Dapatkan path file lama
      const [oldSettings] = await db.sequelize.query(
        'SELECT qris_image_path FROM qris_settings WHERE id = 1',
        {
          type: db.sequelize.QueryTypes.SELECT
        }
      );
      
      // Hapus file lama jika ada
      if (oldSettings && oldSettings.qris_image_path) {
        const oldFilePath = path.join(__dirname, '../public', oldSettings.qris_image_path);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
      
      updateFields.push('qris_image_path = ?');
      updateValues.push(relativePath);
    }
    
    // Update pengaturan jika ada field yang akan diupdate
    if (updateFields.length > 0) {
      await db.sequelize.query(
        `UPDATE qris_settings SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = 1`,
        {
          replacements: updateValues,
          type: db.sequelize.QueryTypes.UPDATE
        }
      );
    }
    
    // Dapatkan pengaturan terbaru
    const [updatedSettings] = await db.sequelize.query(
      'SELECT * FROM qris_settings WHERE id = 1',
      {
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    return res.status(200).json({
      message: 'Pengaturan pembayaran berhasil diperbarui',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('Error saat update pengaturan pembayaran:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat memperbarui pengaturan pembayaran' });
  }
};

// Controller untuk mendapatkan pengaturan pembayaran
const getPaymentSettings = async (req, res) => {
  // Nilai default jika database tidak tersedia
  const defaultSettings = {
    id: 1,
    timeout_seconds: 3600,
    max_pending_transactions: 3,
    qris_enabled: true,
    manual_enabled: true,
    wa_enabled: true,
    qris_merchant_name: "KinterStore",
    wa_message_template: "Balas 1 untuk verifikasi, 2 untuk tolak",
    qris_image_path: null,
    fee_percentage: 0,
    bank_name: "",
    account_number: "",
    account_name: ""
  };
  
  try {
    const settings = await safeQuery(
      async (sequelize) => {
        // Query pengaturan
        const [result] = await sequelize.query(
          'SELECT * FROM qris_settings WHERE id = 1',
          { type: sequelize.QueryTypes.SELECT }
        );
        
        return result; // Bisa null jika tidak ada pengaturan
      },
      null, // Nilai default null untuk mengindikasikan tidak ada hasil
      'getPaymentSettings'
    );
    
    // Jika tidak ada pengaturan, coba buat
    if (!settings) {
      console.log('Pengaturan tidak ditemukan, mencoba membuat default');
      
      // Coba buat pengaturan default
      const inserted = await safeQuery(
        async (sequelize) => {
          try {
            await sequelize.query(
              'INSERT INTO qris_settings (id, timeout_seconds, max_pending_transactions, qris_merchant_name, wa_message_template) ' +
              'VALUES (1, 3600, 3, "KinterStore", "Balas 1 untuk verifikasi, 2 untuk tolak")',
              { type: sequelize.QueryTypes.INSERT }
            );
            
            // Dapatkan pengaturan yang baru dibuat
            const [newSettings] = await sequelize.query(
              'SELECT * FROM qris_settings WHERE id = 1',
              { type: sequelize.QueryTypes.SELECT }
            );
            
            return newSettings;
          } catch (insertErr) {
            console.error('Error creating default settings:', insertErr);
            return null;
          }
        },
        null,
        'createDefaultSettings'
      );
      
      // Kembalikan hasil insert atau default
      return res.status(200).json({ settings: inserted || defaultSettings });
    }
    
    // Kembalikan pengaturan yang ditemukan
    return res.status(200).json({ settings });
  } catch (error) {
    console.error('Error getting payment settings:', error);
    return res.status(200).json({ settings: defaultSettings });
  }
};

module.exports = {
  createPayment,
  getPaymentDetail,
  getUserPayments,
  getAllPayments,
  verifyPayment,
  rejectPayment,
  markAsPaid,
  updatePaymentSettings,
  getPaymentSettings
};