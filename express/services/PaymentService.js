// Gunakan try-catch untuk impor sehingga file tidak crash jika ada masalah
let cron;
try {
  cron = require('node-cron');
} catch (err) {
  console.error('Failed to load node-cron module:', err);
  // Buat dummy cron jika modul tidak tersedia
  cron = {
    schedule: (cronTime, callback) => {
      console.log(`[DUMMY CRON] Would schedule "${cronTime}"`);
      return { stop: () => {} };
    }
  };
}

// Import db dengan penanganan error
let db;
try {
  db = require('../models/index');
} catch (err) {
  console.error('Failed to load database module:', err);
  db = null;
}

// Helper function untuk mengecek ketersediaan database
const isDbAvailable = () => {
  if (!db || !db.sequelize || typeof db.sequelize.query !== 'function') {
    console.warn('Database not properly initialized, skipping database operation');
    return false;
  }
  return true;
};

// Fungsi untuk menandai pembayaran kedaluwarsa
const expirePayments = async () => {
  try {
    // Cek ketersediaan database
    if (!isDbAvailable()) return;
    
    // Tandai semua pembayaran yang sudah lewat batas waktu
    await db.sequelize.query(
      'UPDATE qris_payments SET payment_state = "expired" ' +
      'WHERE payment_state = "pending" AND expired_at < NOW()',
      {
        type: db.sequelize.QueryTypes.UPDATE
      }
    );
    
    console.log('Cron job: Pembayaran kedaluwarsa berhasil diperbarui');
  } catch (error) {
    console.error('Error saat memperbarui pembayaran kedaluwarsa:', error);
  }
};

// Fungsi untuk menghapus pembayaran kedaluwarsa yang melebihi batas maksimum
const cleanupExcessPendingPayments = async () => {
  try {
    // Cek ketersediaan database
    if (!isDbAvailable()) return;
    
    try {
      // Ambil pengaturan pembayaran
      const [paymentSetting] = await db.sequelize.query(
        'SELECT max_pending_transactions FROM qris_settings WHERE id = 1',
        {
          type: db.sequelize.QueryTypes.SELECT
        }
      );
      
      if (!paymentSetting) {
        console.log('Pengaturan pembayaran tidak ditemukan, menggunakan nilai default');
        return;
      }
      
      const maxPendingOrders = paymentSetting.max_pending_transactions || 3;
      
      // Ambil semua user yang memiliki pembayaran pending
      const users = await db.sequelize.query(
        'SELECT user_id, COUNT(*) as pending_count ' +
        'FROM qris_payments ' +
        'WHERE payment_state = "pending" ' +
        'GROUP BY user_id ' +
        'HAVING COUNT(*) > ?',
        {
          replacements: [maxPendingOrders],
          type: db.sequelize.QueryTypes.SELECT
        }
      );
      
      // Untuk setiap user, hapus pembayaran pending yang melebihi batas
      for (const user of users) {
        const payments = await db.sequelize.query(
          'SELECT id FROM qris_payments ' +
          'WHERE user_id = ? AND payment_state = "pending" ' +
          'ORDER BY created_at ASC',
          {
            replacements: [user.user_id],
            type: db.sequelize.QueryTypes.SELECT
          }
        );
        
        // Hapus pembayaran lama yang melebihi batas
        const paymentsToExpire = payments.slice(0, payments.length - maxPendingOrders);
        
        if (paymentsToExpire.length > 0) {
          const paymentIds = paymentsToExpire.map(p => p.id);
          
          // Gunakan IN clause untuk memperbarui semua sekaligus
          await db.sequelize.query(
            'UPDATE qris_payments SET payment_state = "expired" WHERE id IN (?)',
            {
              replacements: [paymentIds],
              type: db.sequelize.QueryTypes.UPDATE
            }
          );
          
          console.log(`${paymentIds.length} pembayaran pending dari user ${user.user_id} ditandai sebagai expired`);
        }
      }
      
      console.log('Cron job: Pembayaran pending berlebih berhasil dibersihkan');
    } catch (dbError) {
      console.error('Database error saat membersihkan pembayaran pending:', dbError);
    }
  } catch (error) {
    console.error('Error saat membersihkan pembayaran pending berlebih:', error);
  }
};

// Jalankan cron job dengan interval yang lebih wajar
const initCronJobs = () => {
  try {
    // Validasi bahwa cron tersedia
    if (!cron || typeof cron.schedule !== 'function') {
      console.error('Cron module not properly loaded, payment automation will not work');
      return false;
    }
    
    // Cek pembayaran kedaluwarsa setiap 15 menit (mengurangi beban server)
    cron.schedule('*/15 * * * *', async () => {
      console.log('Running expired payment check cron job');
      try {
        await expirePayments();
      } catch (error) {
        console.error('Error in expired payment check cron job:', error);
      }
    });
    
    // Bersihkan pembayaran berlebih setiap jam
    cron.schedule('0 * * * *', async () => {
      console.log('Running excess pending payment cleanup cron job');
      try {
        await cleanupExcessPendingPayments();
      } catch (error) {
        console.error('Error in excess pending payment cleanup cron job:', error);
      }
    });
    
    console.log('Cron jobs untuk pembayaran berhasil diinisialisasi');
    return true;
  } catch (error) {
    console.error('Error saat inisialisasi cron jobs:', error);
    return false;
  }
};

module.exports = {
  expirePayments,
  cleanupExcessPendingPayments,
  initCronJobs
};