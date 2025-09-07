// controllers/QrisController.js
const { Subscription, SubscriptionPlan, User, QrisPayment, db } = require("../models");
const fs = require('fs');
const path = require('path');
const { generateRandomString } = require('../utils/helpers');
const moment = require('moment');

// Mendapatkan semua pembayaran QRIS tertunda untuk user
const getPendingPayments = async (req, res) => {
  try {
    const userId = req.userId;
    
    // Ambil pembayaran tertunda untuk user
    const pendingPayments = await QrisPayment.findAll({
      where: {
        user_id: userId,
        status: ['pending', 'waiting_verification'],
        expired_at: {
          [db.Sequelize.Op.gt]: new Date()
        }
      },
      order: [['created_at', 'DESC']],
      limit: 3
    });
    
    return res.status(200).json(pendingPayments);
  } catch (error) {
    console.error("Error getting pending payments:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Mendapatkan semua pembayaran QRIS tertunda untuk admin
const getPendingPaymentsAdmin = async (req, res) => {
  try {
    // Verifikasi admin
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Ambil semua pembayaran tertunda
    const pendingPayments = await QrisPayment.findAll({
      where: {
        status: ['pending', 'waiting_verification'],
        expired_at: {
          [db.Sequelize.Op.gt]: new Date()
        }
      },
      include: [{ 
        model: User, 
        attributes: ['username', 'email'] 
      }],
      order: [['created_at', 'DESC']]
    });
    
    // Format response dengan username dan email
    const formattedPayments = pendingPayments.map(payment => {
      const paymentData = payment.toJSON();
      return {
        ...paymentData,
        username: payment.User ? payment.User.username : 'Unknown',
        email: payment.User ? payment.User.email : 'Unknown'
      };
    });
    
    return res.status(200).json(formattedPayments);
  } catch (error) {
    console.error("Error getting pending payments for admin:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Mendapatkan riwayat pembayaran QRIS untuk user
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.userId;
    
    // Ambil riwayat pembayaran untuk user
    const paymentHistory = await QrisPayment.findAll({
      where: {
        user_id: userId
      },
      order: [['created_at', 'DESC']]
    });
    
    return res.status(200).json(paymentHistory);
  } catch (error) {
    console.error("Error getting payment history:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Mendapatkan riwayat pembayaran QRIS untuk admin
const getPaymentHistoryAdmin = async (req, res) => {
  try {
    // Verifikasi admin
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Parse filter parameters
    const { startDate, endDate, status, keyword } = req.query;
    const whereClause = {};
    
    // Filter by date range
    if (startDate && endDate) {
      whereClause.created_at = {
        [db.Sequelize.Op.between]: [
          new Date(startDate), 
          new Date(moment(endDate).endOf('day'))
        ]
      };
    }
    
    // Filter by status
    if (status) {
      whereClause.status = status;
    }
    
    // Filter by keyword (order_number or username)
    let userIds = [];
    if (keyword) {
      // Search by order_number
      whereClause[db.Sequelize.Op.or] = [
        { order_number: { [db.Sequelize.Op.like]: `%${keyword}%` } }
      ];
      
      // Search by username or email
      const users = await User.findAll({
        where: {
          [db.Sequelize.Op.or]: [
            { username: { [db.Sequelize.Op.like]: `%${keyword}%` } },
            { email: { [db.Sequelize.Op.like]: `%${keyword}%` } }
          ]
        },
        attributes: ['id']
      });
      
      userIds = users.map(user => user.id);
      if (userIds.length > 0) {
        if (whereClause[db.Sequelize.Op.or]) {
          whereClause[db.Sequelize.Op.or].push({ user_id: { [db.Sequelize.Op.in]: userIds } });
        } else {
          whereClause[db.Sequelize.Op.or] = [{ user_id: { [db.Sequelize.Op.in]: userIds } }];
        }
      }
    }
    
    // Ambil semua riwayat pembayaran
    const paymentHistory = await QrisPayment.findAll({
      where: whereClause,
      include: [{ 
        model: User, 
        attributes: ['username', 'email'] 
      }],
      order: [['created_at', 'DESC']]
    });
    
    // Format response dengan username dan email
    const formattedHistory = paymentHistory.map(payment => {
      const paymentData = payment.toJSON();
      return {
        ...paymentData,
        username: payment.User ? payment.User.username : 'Unknown',
        email: payment.User ? payment.User.email : 'Unknown'
      };
    });
    
    return res.status(200).json(formattedHistory);
  } catch (error) {
    console.error("Error getting payment history for admin:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Membuat pembayaran QRIS baru
const createPayment = async (req, res) => {
  try {
    const { plan_id, user_id, amount } = req.body;
    
    // Validasi input
    if (!plan_id || !user_id) {
      return res.status(400).json({ error: "Plan ID dan User ID harus diisi" });
    }
    
    // Ambil data user
    const user = await User.findByPk(user_id);
    if (!user) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }
    
    // Ambil data paket langganan
    const plan = await SubscriptionPlan.findByPk(plan_id);
    if (!plan) {
      return res.status(404).json({ error: "Paket langganan tidak ditemukan" });
    }
    
    // Ambil pengaturan expiry
    const qrisSettings = await db.QrisSettings.findOne({
      order: [['id', 'DESC']]
    });
    
    const expiryHours = qrisSettings ? qrisSettings.expiry_hours : 1;
    
    // Generate order number
    const orderNumber = "QRIS" + Date.now().toString().slice(-8) + generateRandomString(4);
    
    // Tambahkan 3 digit unik ke jumlah pembayaran
    const uniqueDigits = Math.floor(Math.random() * 1000);
    const finalAmount = amount ? amount + uniqueDigits : plan.price + uniqueDigits;
    
    // Hitung tanggal expired
    const expiredAt = new Date();
    expiredAt.setHours(expiredAt.getHours() + expiryHours);
    
    // Buat pembayaran baru
    const newPayment = await QrisPayment.create({
      user_id,
      plan_id,
      order_number: orderNumber,
      amount: finalAmount,
      status: 'pending',
      expired_at: expiredAt,
      plan_name: plan.name
    });
    
    return res.status(201).json({
      success: true,
      message: "Pembayaran berhasil dibuat",
      transaction: newPayment
    });
  } catch (error) {
    console.error("Error creating payment:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Konfirmasi pembayaran oleh user
const confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    // Ambil data pembayaran
    const payment = await QrisPayment.findByPk(id);
    if (!payment) {
      return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    }
    
    // Verifikasi kepemilikan
    if (payment.user_id !== userId) {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Cek status pembayaran
    if (payment.status !== 'pending') {
      return res.status(400).json({ error: "Pembayaran tidak dalam status menunggu" });
    }
    
    // Update status pembayaran
    await payment.update({
      status: 'waiting_verification'
    });
    
    // Kirim notifikasi WhatsApp
    await sendWhatsAppNotification(payment);
    
    return res.status(200).json({
      success: true,
      message: "Konfirmasi pembayaran berhasil dikirim"
    });
  } catch (error) {
    console.error("Error confirming payment:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Verifikasi pembayaran oleh admin
const verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verifikasi admin
    if (req.userRole !== "admin" && req.userId !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Ambil data pembayaran
    const payment = await QrisPayment.findByPk(id);
    if (!payment) {
      return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    }
    
    // Cek status pembayaran
    if (payment.status !== 'pending' && payment.status !== 'waiting_verification') {
      return res.status(400).json({ error: "Pembayaran tidak dapat diverifikasi" });
    }
    
    // Update status pembayaran
    await payment.update({
      status: 'verified',
      verified_at: new Date()
    });
    
    // Ambil data user dan paket
    const user = await User.findByPk(payment.user_id);
    const plan = await SubscriptionPlan.findByPk(payment.plan_id);
    
    if (!user || !plan) {
      return res.status(404).json({ error: "User atau paket tidak ditemukan" });
    }
    
    // Cek apakah user sudah memiliki langganan aktif
    const activeSubscription = await Subscription.findOne({
      where: {
        user_id: payment.user_id,
        status: "active",
        end_date: {
          [db.Sequelize.Op.gt]: new Date()
        }
      }
    });
    
    if (activeSubscription) {
      // Perpanjang langganan yang ada
      const newEndDate = new Date(activeSubscription.end_date);
      newEndDate.setDate(newEndDate.getDate() + plan.duration_days);
      
      await activeSubscription.update({
        end_date: newEndDate,
        payment_status: "paid",
        payment_method: "QRIS"
      });
    } else {
      // Buat langganan baru
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + plan.duration_days);
      
      await Subscription.create({
        user_id: payment.user_id,
        start_date: startDate,
        end_date: endDate,
        status: "active",
        payment_status: "paid",
        payment_method: "QRIS"
      });
    }
    
    return res.status(200).json({
      success: true,
      message: "Pembayaran berhasil diverifikasi"
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Tolak pembayaran oleh admin
const rejectPayment = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verifikasi admin
    if (req.userRole !== "admin" && req.userId !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Ambil data pembayaran
    const payment = await QrisPayment.findByPk(id);
    if (!payment) {
      return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    }
    
    // Cek status pembayaran
    if (payment.status !== 'pending' && payment.status !== 'waiting_verification') {
      return res.status(400).json({ error: "Pembayaran tidak dapat ditolak" });
    }
    
    // Update status pembayaran
    await payment.update({
      status: 'rejected',
      rejected_at: new Date()
    });
    
    return res.status(200).json({
      success: true,
      message: "Pembayaran berhasil ditolak"
    });
  } catch (error) {
    console.error("Error rejecting payment:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Cek status pembayaran
const checkPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    // Ambil data pembayaran
    const payment = await QrisPayment.findByPk(id);
    if (!payment) {
      return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    }
    
    // Verifikasi kepemilikan (kecuali admin)
    if (payment.user_id !== userId && req.userRole !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    return res.status(200).json({
      success: true,
      status: payment.status
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Mendapatkan gambar QRIS
const getQrisImage = async (req, res) => {
  try {
    // Ambil pengaturan QRIS
    const qrisSettings = await db.QrisSettings.findOne({
      order: [['id', 'DESC']]
    });
    
    if (qrisSettings && qrisSettings.qris_image) {
      return res.status(200).json({
        imageUrl: qrisSettings.qris_image
      });
    } else {
      return res.status(404).json({ error: "Gambar QRIS tidak ditemukan" });
    }
  } catch (error) {
    console.error("Error getting QRIS image:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Menyimpan pengaturan QRIS
const saveQrisSettings = async (req, res) => {
  try {
    // Verifikasi admin
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    const { expiryHours } = req.body;
    
    // Validasi input
    if (!expiryHours || expiryHours < 1 || expiryHours > 48) {
      return res.status(400).json({ error: "Waktu kedaluwarsa harus antara 1-48 jam" });
    }
    
    // Ambil pengaturan yang ada
    let qrisSettings = await db.QrisSettings.findOne({
      order: [['id', 'DESC']]
    });
    
    if (qrisSettings) {
      // Update pengaturan yang ada
      await qrisSettings.update({
        expiry_hours: expiryHours
      });
    } else {
      // Buat pengaturan baru
      qrisSettings = await db.QrisSettings.create({
        expiry_hours: expiryHours,
        qris_image: null
      });
    }
    
    return res.status(200).json({
      success: true,
      message: "Pengaturan QRIS berhasil disimpan"
    });
  } catch (error) {
    console.error("Error saving QRIS settings:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Upload gambar QRIS
const uploadQrisImage = async (req, res) => {
  try {
    // Verifikasi admin
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Validasi file
    if (!req.file) {
      return res.status(400).json({ error: "File gambar tidak ditemukan" });
    }
    
    // Simpan file ke direktori uploads
    const filename = `qris_${Date.now()}${path.extname(req.file.originalname)}`;
    const filepath = path.join(__dirname, '../public/uploads', filename);
    
    fs.writeFileSync(filepath, req.file.buffer);
    
    // Buat URL untuk gambar
    const imageUrl = `/uploads/${filename}`;
    
    // Ambil pengaturan yang ada
    let qrisSettings = await db.QrisSettings.findOne({
      order: [['id', 'DESC']]
    });
    
    if (qrisSettings) {
      // Update pengaturan yang ada
      await qrisSettings.update({
        qris_image: imageUrl
      });
    } else {
      // Buat pengaturan baru
      qrisSettings = await db.QrisSettings.create({
        expiry_hours: 1,
        qris_image: imageUrl
      });
    }
    
    return res.status(200).json({
      success: true,
      message: "Gambar QRIS berhasil diunggah",
      imageUrl
    });
  } catch (error) {
    console.error("Error uploading QRIS image:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Mendapatkan pengaturan QRIS
const getQrisSettings = async (req, res) => {
  try {
    // Verifikasi admin
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki izin" });
    }
    
    // Ambil pengaturan QRIS
    const qrisSettings = await db.QrisSettings.findOne({
      order: [['id', 'DESC']]
    });
    
    if (qrisSettings) {
      return res.status(200).json({
        expiryHours: qrisSettings.expiry_hours,
        qrisImage: qrisSettings.qris_image
      });
    } else {
      return res.status(200).json({
        expiryHours: 1,
        qrisImage: null
      });
    }
  } catch (error) {
    console.error("Error getting QRIS settings:", error);
    return res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
};

// Helper function to send WhatsApp notification
const sendWhatsAppNotification = async (payment) => {
  try {
    // Ambil data user
    const user = await User.findByPk(payment.user_id);
    if (!user) {
      console.error("User not found for WhatsApp notification");
      return;
    }
    
    // Ambil data paket
    const plan = await SubscriptionPlan.findByPk(payment.plan_id);
    
    // Ambil pengaturan WhatsApp
    const whatsappSettings = await db.BaileysSettings.findOne({
      order: [['id', 'DESC']]
    });
    
    if (!whatsappSettings || !whatsappSettings.notification_enabled) {
      console.log("WhatsApp notifications are disabled");
      return;
    }
    
    // Format pesan notifikasi
    let message = whatsappSettings.template_message;
    message = message
      .replace(/{username}/g, user.username)
      .replace(/{email}/g, user.email)
      .replace(/{amount}/g, payment.amount.toLocaleString('id-ID'))
      .replace(/{plan_name}/g, plan ? plan.name : 'Paket Langganan')
      .replace(/{order_number}/g, payment.order_number);
    
    // Kirim notifikasi ke WhatsApp grup
    if (global.waConnection && global.waConnection.isConnected) {
      await global.waConnection.sendGroupMessage(
        whatsappSettings.group_name,
        message
      );
      
      // Log notification
      await db.BaileysLog.create({
        type: 'notification',
        status: 'success',
        message: `Notifikasi pembayaran #${payment.order_number} berhasil dikirim`,
        data: {
          payment_id: payment.id,
          order_number: payment.order_number,
          user_id: payment.user_id,
          username: user.username
        }
      });
      
      console.log(`WhatsApp notification sent for payment #${payment.order_number}`);
    } else {
      console.error("WhatsApp is not connected");
      
      // Log error
      await db.BaileysLog.create({
        type: 'notification',
        status: 'failed',
        message: `Gagal mengirim notifikasi pembayaran #${payment.order_number} - WhatsApp tidak terhubung`,
        data: {
          payment_id: payment.id,
          order_number: payment.order_number
        }
      });
    }
  } catch (error) {
    console.error("Error sending WhatsApp notification:", error);
    
    // Log error
    await db.BaileysLog.create({
      type: 'notification',
      status: 'failed',
      message: `Error saat mengirim notifikasi pembayaran #${payment.order_number}: ${error.message}`,
      data: {
        payment_id: payment.id,
        order_number: payment.order_number,
        error: error.message
      }
    });
  }
};

module.exports = {
  getPendingPayments,
  getPendingPaymentsAdmin,
  getPaymentHistory,
  getPaymentHistoryAdmin,
  createPayment,
  confirmPayment,
  verifyPayment,
  rejectPayment,
  checkPaymentStatus,
  getQrisImage,
  saveQrisSettings,
  uploadQrisImage,
  getQrisSettings
};