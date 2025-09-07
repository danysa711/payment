const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');
const db = require('../models/index');
const QRCode = require('qrcode');

let makeWASocket, DisconnectReason, useMultiFileAuthState;

// Fungsi init untuk memuat modul ESM
const loadBaileysModule = async () => {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    makeWASocket = baileys.default;
    DisconnectReason = baileys.DisconnectReason;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    console.log('Baileys module loaded successfully');
    return true;
  } catch (err) {
    console.error('Failed to load Baileys module:', err);
    return false;
  }
};

// Path untuk menyimpan session Baileys
const SESSION_PATH = path.join(__dirname, '../baileys_session');

// Membuat folder session jika belum ada
if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

let waSocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let qrCodeData = null;

// Fungsi untuk menginisialisasi koneksi WhatsApp
const initializeWhatsApp = async () => {
  try {
    // Ambil state autentikasi dari file
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    
    // Buat koneksi baru
    waSocket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      defaultQueryTimeoutMs: 60000,
    });
    
    // Reset QR code
    qrCodeData = null;
    
    // Handler untuk menyimpan kredensial
    waSocket.ev.on('creds.update', saveCreds);
    
    // Handler untuk koneksi
    waSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Simpan QR code jika tersedia
      if (qr) {
        try {
          qrCodeData = await QRCode.toDataURL(qr);
          console.log('QR Code diperbarui');
        } catch (qrErr) {
          console.error('Error saat membuat QR Code:', qrErr);
        }
      }
      
      if (connection === 'close') {
        const shouldReconnect = 
          (lastDisconnect?.error instanceof Boom)? 
          lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
        
        console.log('Koneksi WhatsApp terputus karena:', lastDisconnect?.error?.message || 'Alasan tidak diketahui');
        
        // Update status di database
        await db.sequelize.query(
          'UPDATE wa_baileys_config SET is_connected = ? WHERE id = ?',
          {
            replacements: [false, 1],
            type: db.sequelize.QueryTypes.UPDATE
          }
        );
        
        // Coba reconnect jika bukan karena logout
        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`Mencoba menghubungkan kembali (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(initializeWhatsApp, 5000);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log('Batas percobaan koneksi ulang tercapai');
        }
      } else if (connection === 'open') {
        console.log('WhatsApp berhasil terhubung!');
        reconnectAttempts = 0;
        
        // Reset QR Code
        qrCodeData = null;
        
        // Update status di database
        await db.sequelize.query(
          'UPDATE wa_baileys_config SET is_connected = ? WHERE id = ?',
          {
            replacements: [true, 1],
            type: db.sequelize.QueryTypes.UPDATE
          }
        );
        
        // Dapatkan info nomor WhatsApp
        const [waNumber] = waSocket.user.id.split(':');
        await db.sequelize.query(
          'UPDATE wa_baileys_config SET wa_number = ? WHERE id = ?',
          {
            replacements: [waNumber, 1],
            type: db.sequelize.QueryTypes.UPDATE
          }
        );
      }
    });
    
    // Handler untuk pesan
    waSocket.ev.on('messages.upsert', async (m) => {
      try {
        if (m.type !== 'notify') return;
        
        const msg = m.messages[0];
        if (!msg.message) return;
        
        // Cek apakah pesan dari grup
        const [settings] = await db.sequelize.query(
          'SELECT group_id FROM wa_baileys_config WHERE id = ?',
          {
            replacements: [1],
            type: db.sequelize.QueryTypes.SELECT
          }
        );
        
        const groupId = settings?.group_id;
        
        if (msg.key.remoteJid === groupId) {
          // Proses pesan grup untuk verifikasi pembayaran
          await processGroupMessage(msg);
        }
      } catch (error) {
        console.error('Error saat memproses pesan:', error);
      }
    });
    
    return waSocket;
  } catch (error) {
    console.error('Error saat inisialisasi WhatsApp:', error);
    throw error;
  }
};

// Fungsi untuk memproses pesan dari grup
const processGroupMessage = async (msg) => {
  try {
    // Ambil pesan
    const messageContent = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          '';
    
    // Periksa apakah ini adalah respon verifikasi (1 atau 2)
    if (messageContent === '1' || messageContent === '2') {
      // Cek apakah pesan ini adalah balasan
      const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quotedMsg) return;
      
      // Ambil pesan yang dibalas
      const quotedText = quotedMsg.conversation || 
                        quotedMsg.extendedTextMessage?.text || 
                        '';
      
      // Ekstrak reference_id dari pesan yang dibalas
      const refMatch = quotedText.match(/Nomor Pesanan: ([A-Z0-9-]+)/);
      if (!refMatch) return;
      
      const referenceId = refMatch[1];
      
      // Cari pembayaran berdasarkan reference_id
      const [payment] = await db.sequelize.query(
        'SELECT id FROM qris_payments WHERE payment_ref = ?',
        {
          replacements: [referenceId],
          type: db.sequelize.QueryTypes.SELECT
        }
      );
      
      if (!payment) return;
      
      if (messageContent === '1') {
        // Verifikasi pembayaran
        await verifyPayment(payment.id, 'whatsapp', msg.key.participant.split('@')[0]);
        
        // Kirim pesan konfirmasi ke grup
        await waSocket.sendMessage(msg.key.remoteJid, {
          text: `✅ Pembayaran dengan nomor referensi ${referenceId} telah diverifikasi.`
        });
      } else if (messageContent === '2') {
        // Tolak pembayaran
        await rejectPayment(payment.id, 'whatsapp', msg.key.participant.split('@')[0]);
        
        // Kirim pesan konfirmasi ke grup
        await waSocket.sendMessage(msg.key.remoteJid, {
          text: `❌ Pembayaran dengan nomor referensi ${referenceId} telah ditolak.`
        });
      }
    }
  } catch (error) {
    console.error('Error saat memproses pesan grup:', error);
  }
};

// Fungsi untuk verifikasi pembayaran
const verifyPayment = async (paymentId, method, verifiedBy) => {
  const transaction = await db.sequelize.transaction();
  
  try {
    // Dapatkan data pembayaran
    const [payment] = await db.sequelize.query(
      'SELECT p.*, u.id as user_id, sp.duration_days FROM qris_payments p ' +
      'JOIN Users u ON p.user_id = u.id ' +
      'JOIN SubscriptionPlans sp ON p.plan_id = sp.id ' +
      'WHERE p.id = ? AND p.payment_state = "pending"',
      {
        replacements: [paymentId],
        type: db.sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    
    if (!payment) {
      throw new Error('Pembayaran tidak ditemukan atau tidak dalam status pending');
    }
    
    // Update status pembayaran
    await db.sequelize.query(
      'UPDATE qris_payments SET ' +
      'payment_state = "verified", ' +
      'verified_at = NOW(), ' +
      'verified_by = ?, ' +
      'verification_method = ? ' +
      'WHERE id = ?',
      {
        replacements: [verifiedBy, method, paymentId],
        type: db.sequelize.QueryTypes.UPDATE,
        transaction
      }
    );
    
    // Cek apakah user sudah memiliki langganan aktif
    const [activeSubscription] = await db.sequelize.query(
      'SELECT id, end_date FROM Subscriptions ' +
      'WHERE user_id = ? AND status = "active" AND end_date > NOW()',
      {
        replacements: [payment.user_id],
        type: db.sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    
    if (activeSubscription) {
      // Perpanjang langganan yang ada
      const newEndDate = new Date(activeSubscription.end_date);
      newEndDate.setDate(newEndDate.getDate() + payment.duration_days);
      
      await db.sequelize.query(
        'UPDATE Subscriptions SET ' +
        'end_date = ?, ' +
        'payment_status = "paid" ' +
        'WHERE id = ?',
        {
          replacements: [newEndDate, activeSubscription.id],
          type: db.sequelize.QueryTypes.UPDATE,
          transaction
        }
      );
    } else {
      // Buat langganan baru
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + payment.duration_days);
      
      await db.sequelize.query(
        'INSERT INTO Subscriptions ' +
        '(user_id, start_date, end_date, status, payment_status, payment_method, createdAt, updatedAt) ' +
        'VALUES (?, ?, ?, "active", "paid", "qris", NOW(), NOW())',
        {
          replacements: [payment.user_id, startDate, endDate],
          type: db.sequelize.QueryTypes.INSERT,
          transaction
        }
      );
    }
    
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    console.error('Error saat verifikasi pembayaran:', error);
    throw error;
  }
};

// Fungsi untuk menolak pembayaran
const rejectPayment = async (paymentId, method, rejectedBy) => {
  try {
    // Dapatkan data pembayaran
    const [payment] = await db.sequelize.query(
      'SELECT * FROM qris_payments WHERE id = ? AND payment_state = "pending"',
      {
        replacements: [paymentId],
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    if (!payment) {
      throw new Error('Pembayaran tidak ditemukan atau tidak dalam status pending');
    }
    
    // Update status pembayaran
    await db.sequelize.query(
      'UPDATE qris_payments SET ' +
      'payment_state = "rejected", ' +
      'verified_at = NOW(), ' +
      'verified_by = ?, ' +
      'verification_method = ? ' +
      'WHERE id = ?',
      {
        replacements: [rejectedBy, method, paymentId],
        type: db.sequelize.QueryTypes.UPDATE
      }
    );
    
    return true;
  } catch (error) {
    console.error('Error saat menolak pembayaran:', error);
    throw error;
  }
};

// Fungsi untuk mengirim notifikasi pembayaran ke grup
const sendPaymentNotification = async (payment) => {
  try {
    if (!waSocket) {
      throw new Error('WhatsApp belum terhubung');
    }
    
    // Ambil pengaturan Baileys
    const [settings] = await db.sequelize.query(
      'SELECT group_id, wa_message_template FROM wa_baileys_config JOIN qris_settings ON 1=1 LIMIT 1',
      {
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    if (!settings || !settings.group_id) {
      throw new Error('ID grup WhatsApp belum dikonfigurasi');
    }
    
    // Ambil data user dan paket langganan
    const [user] = await db.sequelize.query(
      'SELECT username, email FROM Users WHERE id = ?',
      {
        replacements: [payment.user_id],
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    const [plan] = await db.sequelize.query(
      'SELECT name FROM SubscriptionPlans WHERE id = ?',
      {
        replacements: [payment.plan_id],
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    if (!user || !plan) {
      throw new Error('Data user atau paket langganan tidak ditemukan');
    }
    
    // Format pesan notifikasi
    const message = `*VERIFIKASI PEMBAYARAN*\n\n` +
                   `Username: ${user.username}\n` +
                   `Email: ${user.email}\n` +
                   `Paket: ${plan.name}\n` +
                   `Nominal Transfer: Rp ${payment.total_amount.toLocaleString('id-ID')}\n` +
                   `Nomor Pesanan: ${payment.payment_ref}\n\n` +
                   `Balas '1' untuk verifikasi\n` +
                   `Balas '2' untuk tolak`;
    
    // Kirim pesan ke grup
    await waSocket.sendMessage(settings.group_id, { text: message });
    
    return true;
  } catch (error) {
    console.error('Error saat mengirim notifikasi:', error);
    throw error;
  }
};

// Controller untuk mendapatkan QR code
const getQRCode = async (req, res) => {
  try {
    if (!qrCodeData) {
      return res.status(404).json({ error: 'QR Code belum tersedia' });
    }
    
    return res.status(200).json({ qrCode: qrCodeData });
  } catch (error) {
    console.error('Error saat mendapatkan QR Code:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat mendapatkan QR Code' });
  }
};

// Controller untuk scan QR dan login WhatsApp
const getLoginStatus = async (req, res) => {
  try {
    // Cek ketersediaan koneksi WhatsApp terlebih dahulu
    const connStatus = {
      isConnected: waSocket ? true : false,
      whatsappNumber: waSocket?.user?.id ? waSocket.user.id.split(':')[0] : '',
      groupId: '',
      groupName: '',
      qrCode: waSocket ? null : qrCodeData
    };
    
    // Periksa apakah db dan sequelize tersedia
    if (!db || !db.sequelize || typeof db.sequelize.query !== 'function') {
      console.log('Database not properly initialized in getLoginStatus');
      return res.status(200).json(connStatus);
    }
    
    try {
      // Query database jika tersedia
      const [settings] = await db.sequelize.query(
        'SELECT is_connected, wa_number, group_id, group_name FROM wa_baileys_config WHERE id = 1',
        {
          type: db.sequelize.QueryTypes.SELECT
        }
      );
      
      if (settings) {
        return res.status(200).json({
          isConnected: settings.is_connected || connStatus.isConnected,
          whatsappNumber: settings.wa_number || connStatus.whatsappNumber,
          groupId: settings.group_id || '',
          groupName: settings.group_name || '',
          qrCode: !settings.is_connected ? qrCodeData : null
        });
      } else {
        return res.status(200).json(connStatus);
      }
    } catch (dbError) {
      console.error('Database query error:', dbError);
      return res.status(200).json(connStatus);
    }
  } catch (error) {
    console.error('Error saat mendapatkan status login:', error);
    // Berikan respons fallback jika terjadi error
    return res.status(200).json({ 
      isConnected: waSocket ? true : false,
      whatsappNumber: waSocket?.user?.id ? waSocket.user.id.split(':')[0] : '',
      groupId: '',
      groupName: '',
      qrCode: waSocket ? null : qrCodeData
    });
  }
};

// Controller untuk logout WhatsApp
const logout = async (req, res) => {
  try {
    if (waSocket) {
      await waSocket.logout();
      waSocket = null;
      
      // Hapus semua file sesi
      fs.rmSync(SESSION_PATH, { recursive: true, force: true });
      fs.mkdirSync(SESSION_PATH, { recursive: true });
      
      // Update status di database
      await db.sequelize.query(
        'UPDATE wa_baileys_config SET is_connected = false WHERE id = 1',
        {
          type: db.sequelize.QueryTypes.UPDATE
        }
      );
    }
    
    return res.status(200).json({ message: 'Berhasil logout dari WhatsApp' });
  } catch (error) {
    console.error('Error saat logout WhatsApp:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat logout WhatsApp' });
  }
};

// Controller untuk update pengaturan grup WhatsApp
const updateGroupSettings = async (req, res) => {
  try {
    const { groupId, groupName } = req.body;
    
    if (!waSocket) {
      return res.status(400).json({ error: 'WhatsApp belum terhubung' });
    }
    
    // Validasi apakah group_id valid
    try {
      const groupMetadata = await waSocket.groupMetadata(groupId);
      if (!groupMetadata) {
        return res.status(400).json({ error: 'ID grup tidak valid atau WhatsApp tidak memiliki akses ke grup tersebut' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'ID grup tidak valid atau WhatsApp tidak memiliki akses ke grup tersebut' });
    }
    
    // Update pengaturan grup
    await db.sequelize.query(
      'UPDATE wa_baileys_config SET group_id = ?, group_name = ? WHERE id = 1',
      {
        replacements: [groupId, groupName],
        type: db.sequelize.QueryTypes.UPDATE
      }
    );
    
    return res.status(200).json({ message: 'Pengaturan grup berhasil diperbarui' });
  } catch (error) {
    console.error('Error saat update pengaturan grup:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat memperbarui pengaturan grup' });
  }
};

// Controller untuk mendapatkan daftar grup
const getGroups = async (req, res) => {
  try {
    if (!waSocket) {
      return res.status(400).json({ error: 'WhatsApp belum terhubung' });
    }
    
    // Ambil daftar grup
    const groups = [];
    const chats = await waSocket.groupFetchAllParticipating();
    
    for (const [id, chat] of Object.entries(chats)) {
      groups.push({
        id: id,
        name: chat.subject || 'Grup tanpa nama',
        participants: chat.participants.length
      });
    }
    
    return res.status(200).json({ groups });
  } catch (error) {
    console.error('Error saat mendapatkan daftar grup:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat mendapatkan daftar grup' });
  }
};

// Controller untuk menginisialisasi WhatsApp
const initialize = async (req, res) => {
  try {
    // Inisialisasi data baileys jika belum ada
    const [baileysSetting] = await db.sequelize.query(
      'SELECT id FROM wa_baileys_config WHERE id = 1',
      { type: db.sequelize.QueryTypes.SELECT }
    );
    
    if (!baileysSetting) {
      await db.sequelize.query(
        'INSERT INTO wa_baileys_config (id, wa_number, is_connected, created_at, updated_at) VALUES (1, "", 0, NOW(), NOW())',
        { type: db.sequelize.QueryTypes.INSERT }
      );
    }
    
    // Inisialisasi WhatsApp
    await initializeWhatsApp();
    
    return res.status(200).json({ message: 'Proses inisialisasi WhatsApp dimulai, silakan scan QR code' });
  } catch (error) {
    console.error('Error saat inisialisasi WhatsApp:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat inisialisasi WhatsApp' });
  }
};

module.exports = {
  initializeWhatsApp,
  sendPaymentNotification,
  verifyPayment,
  rejectPayment,
  getQRCode,
  getLoginStatus,
  logout,
  updateGroupSettings,
  getGroups,
  initialize
};