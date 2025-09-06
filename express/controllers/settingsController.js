// controllers/settingsController.js
const { Setting } = require('../models');

// Mendapatkan pengaturan Tripay
const getTripaySettings = async (req, res) => {
  try {
    const settings = await Promise.all([
      Setting.findOne({ where: { key: 'tripay_enabled' } }),
      Setting.findOne({ where: { key: 'tripay_api_key' } }),
      Setting.findOne({ where: { key: 'tripay_private_key' } }),
      Setting.findOne({ where: { key: 'tripay_merchant_code' } }),
      Setting.findOne({ where: { key: 'tripay_sandbox_mode' } })
    ]);
    
    res.json({
      tripay_enabled: settings[0] ? settings[0].value === 'true' : false,
      api_key: settings[1] ? settings[1].value : '',
      private_key: settings[2] ? settings[2].value : '',
      merchant_code: settings[3] ? settings[3].value : '',
      sandbox_mode: settings[4] ? settings[4].value === 'true' : true
    });
  } catch (err) {
    console.error('Error mengambil pengaturan Tripay:', err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Menyimpan pengaturan Tripay
const saveTripaySettings = async (req, res) => {
  try {
    const { tripay_enabled, api_key, private_key, merchant_code, sandbox_mode } = req.body;
    
    // Update atau buat pengaturan
    await updateOrCreateSetting('tripay_enabled', tripay_enabled.toString());
    await updateOrCreateSetting('tripay_api_key', api_key);
    await updateOrCreateSetting('tripay_private_key', private_key);
    await updateOrCreateSetting('tripay_merchant_code', merchant_code);
    await updateOrCreateSetting('tripay_sandbox_mode', sandbox_mode.toString());
    
    res.json({ success: true, message: 'Pengaturan Tripay berhasil diperbarui' });
  } catch (err) {
    console.error('Error menyimpan pengaturan Tripay:', err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Fungsi helper untuk update atau buat setting
async function updateOrCreateSetting(key, value) {
  let setting = await Setting.findOne({ where: { key } });
  if (setting) {
    setting.value = value;
    await setting.save();
  } else {
    setting = await Setting.create({ key, value });
  }
  return setting;
}

// Mendapatkan nomor WhatsApp dukungan
const getSupportNumber = async (req, res) => {
  try {
    const whatsappNumber = await Setting.findOne({ where: { key: 'support_whatsapp_number' } });
    res.json({
      whatsappNumber: whatsappNumber ? whatsappNumber.value : '6281284712684'
    });
  } catch (err) {
    console.error('Error mengambil nomor WhatsApp dukungan:', err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Menyimpan nomor WhatsApp dukungan
const saveSupportNumber = async (req, res) => {
  try {
    const { whatsappNumber } = req.body;
    await updateOrCreateSetting('support_whatsapp_number', whatsappNumber);
    res.json({ success: true, message: 'Nomor WhatsApp dukungan berhasil diperbarui' });
  } catch (err) {
    console.error('Error menyimpan nomor WhatsApp dukungan:', err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Mendapatkan pengaturan WhatsApp trial
const getWhatsappTrialSettings = async (req, res) => {
  try {
    const settings = await Promise.all([
      Setting.findOne({ where: { key: 'whatsapp_trial_enabled' } }),
      Setting.findOne({ where: { key: 'whatsapp_trial_number' } }),
      Setting.findOne({ where: { key: 'whatsapp_trial_template' } })
    ]);
    
    res.json({
      isEnabled: settings[0] ? settings[0].value === 'true' : true,
      whatsappNumber: settings[1] ? settings[1].value : '6281284712684',
      messageTemplate: settings[2] ? settings[2].value : 'Halo, saya {username} ({email}) ingin request trial dengan URL: {url_slug}'
    });
  } catch (err) {
    console.error('Error mengambil pengaturan WhatsApp trial:', err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Menyimpan pengaturan WhatsApp trial
const saveWhatsappTrialSettings = async (req, res) => {
  try {
    const { isEnabled, whatsappNumber, messageTemplate } = req.body;
    
    await updateOrCreateSetting('whatsapp_trial_enabled', isEnabled.toString());
    await updateOrCreateSetting('whatsapp_trial_number', whatsappNumber);
    await updateOrCreateSetting('whatsapp_trial_template', messageTemplate);
    
    res.json({ success: true, message: 'Pengaturan WhatsApp trial berhasil diperbarui' });
  } catch (err) {
    console.error('Error menyimpan pengaturan WhatsApp trial:', err);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = {
  getTripaySettings,
  saveTripaySettings,
  getSupportNumber,
  saveSupportNumber,
  getWhatsappTrialSettings,
  saveWhatsappTrialSettings
};