const db = require('../models/index');

// Middleware untuk memeriksa status koneksi WhatsApp
const checkWhatsAppConnection = async (req, res, next) => {
  try {
    const [settings] = await db.sequelize.query(
      'SELECT is_connected FROM wa_baileys_config WHERE id = 1',
      {
        type: db.sequelize.QueryTypes.SELECT
      }
    );
    
    if (!settings || !settings.is_connected) {
      return res.status(400).json({ error: 'WhatsApp belum terhubung' });
    }
    
    next();
  } catch (error) {
    console.error('Error saat memeriksa koneksi WhatsApp:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat memeriksa koneksi WhatsApp' });
  }
};

module.exports = {
  checkWhatsAppConnection
};