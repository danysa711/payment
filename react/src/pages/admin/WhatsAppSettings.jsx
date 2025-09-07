import React, { useState, useEffect } from 'react';
import { 
  Card, Typography, Button, Form, Input, Select, Switch, 
  Divider, Steps, Alert, Space, Table, Tag, Modal, Spin, 
  Upload, message, Row, Col, Tabs, Descriptions, Image
} from 'antd';
import { 
  WhatsAppOutlined, QrcodeOutlined, UserOutlined, 
  LogoutOutlined, UploadOutlined, UsergroupAddOutlined,
  SyncOutlined, CheckCircleOutlined, CloseCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import axiosInstance from '../../services/axios';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { TabPane } = Tabs;
const { Step } = Steps;
const { TextArea } = Input;

const WhatsAppSettings = () => {
  const [loading, setLoading] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState({
    isConnected: false,
    whatsappNumber: '',
    groupId: '',
    groupName: ''
  });
  const [qrCodeData, setQrCodeData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState({
    timeout_seconds: 3600,
    max_pending_transactions: 3,
    qris_image_path: null,
    qris_merchant_name: 'KinterStore',
    wa_message_template: 'Balas 1 untuk verifikasi, 2 untuk tolak'
  });
  const [uploadLoading, setUploadLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('1');
  const [groupForm] = Form.useForm();
  const [settingsForm] = Form.useForm();

  // Fetch WhatsApp status
  const fetchWhatsAppStatus = async () => {
    try {
      setLoading(true);
      const response = await axiosInstance.get('/api/baileys/status');
      setWhatsappStatus(response.data);
      
      // Jika tidak terhubung, coba dapatkan QR code
      if (!response.data.isConnected) {
        fetchQRCode();
      } else {
        setQrCodeData(null);
      }
    } catch (error) {
      console.error('Error fetching WhatsApp status:', error);
      message.error('Gagal mengambil status WhatsApp');
    } finally {
      setLoading(false);
    }
  };

  // Fetch QR code
  const fetchQRCode = async () => {
    try {
      const response = await axiosInstance.get('/api/baileys/qrcode');
      if (response.data.qrCode) {
        setQrCodeData(response.data.qrCode);
      }
    } catch (error) {
      console.error('Error fetching QR code:', error);
      // Tidak perlu menampilkan error, karena QR code memang bisa tidak tersedia
    }
  };

  // Fetch payment settings
  const fetchPaymentSettings = async () => {
    try {
      setLoading(true);
      const response = await axiosInstance.get('/api/qris/settings');
      setPaymentSettings(response.data.settings);
      settingsForm.setFieldsValue({
        timeout_seconds: response.data.settings.timeout_seconds,
        max_pending_transactions: response.data.settings.max_pending_transactions,
        qris_merchant_name: response.data.settings.qris_merchant_name,
        wa_message_template: response.data.settings.wa_message_template
      });
    } catch (error) {
      console.error('Error fetching payment settings:', error);
      message.error('Gagal mengambil pengaturan pembayaran');
    } finally {
      setLoading(false);
    }
  };

  // Fetch WhatsApp groups
  const fetchGroups = async () => {
    try {
      setLoadingGroups(true);
      const response = await axiosInstance.get('/api/baileys/groups');
      setGroups(response.data.groups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      message.error('Gagal mengambil daftar grup');
    } finally {
      setLoadingGroups(false);
    }
  };

  // Initialize WhatsApp
  const handleInitialize = async () => {
    try {
      setLoading(true);
      await axiosInstance.post('/api/baileys/initialize');
      message.success('Inisialisasi WhatsApp dimulai, silakan scan QR code');
      
      // Tunggu sebentar kemudian cek QR code
      setTimeout(fetchQRCode, 2000);
      
      // Periksa status setiap 5 detik
      const checkInterval = setInterval(async () => {
        const response = await axiosInstance.get('/api/baileys/status');
        setWhatsappStatus(response.data);
        
        if (response.data.isConnected) {
          clearInterval(checkInterval);
          message.success('WhatsApp berhasil terhubung!');
          setQrCodeData(null);
          fetchGroups();
        } else {
          // Jika belum terhubung, coba dapatkan QR code
          fetchQRCode();
        }
      }, 5000);
      
      // Hentikan pengecekan setelah 2 menit
      setTimeout(() => {
        clearInterval(checkInterval);
      }, 120000);
    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      message.error('Gagal menginisialisasi WhatsApp');
    } finally {
      setLoading(false);
    }
  };

  // Logout WhatsApp
  const handleLogout = async () => {
    try {
      setLoading(true);
      await axiosInstance.post('/api/baileys/logout');
      message.success('Berhasil logout dari WhatsApp');
      setWhatsappStatus({
        isConnected: false,
        whatsappNumber: '',
        groupId: '',
        groupName: ''
      });
      setQrCodeData(null);
    } catch (error) {
      console.error('Error logging out WhatsApp:', error);
      message.error('Gagal logout dari WhatsApp');
    } finally {
      setLoading(false);
    }
  };

  // Update group settings
  const handleUpdateGroup = async (values) => {
    try {
      setLoading(true);
      await axiosInstance.put('/api/baileys/group-settings', values);
      message.success('Pengaturan grup berhasil diperbarui');
      fetchWhatsAppStatus();
    } catch (error) {
      console.error('Error updating group settings:', error);
      message.error('Gagal memperbarui pengaturan grup');
    } finally {
      setLoading(false);
    }
  };

  // Update payment settings
  const handleUpdatePaymentSettings = async (values) => {
    try {
      setUploadLoading(true);
      
      // Buat form data untuk upload file
      const formData = new FormData();
      formData.append('timeout_seconds', values.timeout_seconds);
      formData.append('max_pending_transactions', values.max_pending_transactions);
      formData.append('qris_merchant_name', values.qris_merchant_name);
      formData.append('wa_message_template', values.wa_message_template);
      
      if (values.qris_image && values.qris_image.fileList && values.qris_image.fileList.length > 0) {
        formData.append('qris_image', values.qris_image.fileList[0].originFileObj);
      }
      
      // Kirim dengan Content-Type: multipart/form-data
      const response = await axiosInstance.put('/api/qris/settings', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      message.success('Pengaturan pembayaran berhasil diperbarui');
      fetchPaymentSettings();
    } catch (error) {
      console.error('Error updating payment settings:', error);
      message.error('Gagal memperbarui pengaturan pembayaran');
    } finally {
      setUploadLoading(false);
    }
  };

  // Upload props for QRIS image
  const uploadProps = {
    beforeUpload: (file) => {
      const isImage = file.type.startsWith('image/');
      if (!isImage) {
        message.error('Hanya file gambar yang diperbolehkan!');
      }
      return isImage || Upload.LIST_IGNORE;
    },
    maxCount: 1
  };

  useEffect(() => {
    fetchWhatsAppStatus();
    fetchPaymentSettings();
    
    // Polling QR code dan status setiap 10 detik jika belum terhubung
    const statusInterval = setInterval(() => {
      if (!whatsappStatus.isConnected) {
        fetchWhatsAppStatus();
      }
    }, 10000);
    
    return () => clearInterval(statusInterval);
  }, []);

  return (
    <div>
      <Title level={2}>Pengaturan WhatsApp & Pembayaran</Title>
      
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane 
          tab={
            <span>
              <WhatsAppOutlined /> Koneksi WhatsApp
            </span>
          } 
          key="1"
        >
          <Card>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Title level={4}>Status Koneksi WhatsApp</Title>
              
              {whatsappStatus.isConnected ? (
                <Alert
                  message="WhatsApp Terhubung"
                  description={`Nomor: ${whatsappStatus.whatsappNumber || 'Tidak tersedia'}`}
                  type="success"
                  showIcon
                  icon={<CheckCircleOutlined />}
                />
              ) : (
                <Alert
                  message="WhatsApp Tidak Terhubung"
                  description="Silakan scan QR code untuk menghubungkan WhatsApp"
                  type="warning"
                  showIcon
                  icon={<CloseCircleOutlined />}
                />
              )}
            </div>
            
            {!whatsappStatus.isConnected && qrCodeData && (
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <Title level={4}>Scan QR Code dengan WhatsApp</Title>
                <div style={{ marginBottom: 16 }}>
                  <Image 
                    src={qrCodeData} 
                    alt="WhatsApp QR Code" 
                    style={{ maxWidth: 250 }}
                    preview={false}
                  />
                </div>
                <Text type="secondary">
                  Buka WhatsApp di ponsel Anda, tap Menu atau Pengaturan dan pilih WhatsApp Web, 
                  lalu scan QR code ini.
                </Text>
              </div>
            )}
            
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              {whatsappStatus.isConnected ? (
                <Button 
                  type="primary" 
                  danger 
                  icon={<LogoutOutlined />} 
                  onClick={handleLogout}
                  loading={loading}
                >
                  Logout WhatsApp
                </Button>
              ) : (
                <Button 
                  type="primary" 
                  icon={<QrcodeOutlined />} 
                  onClick={handleInitialize}
                  loading={loading}
                >
                  {qrCodeData ? 'Refresh QR Code' : 'Scan QR Code'}
                </Button>
              )}
            </div>
            
            <Divider>Pengaturan Grup</Divider>
            
            {whatsappStatus.isConnected ? (
              <div>
                <Form
                  form={groupForm}
                  layout="vertical"
                  initialValues={{
                    groupId: whatsappStatus.groupId,
                    groupName: whatsappStatus.groupName
                  }}
                  onFinish={handleUpdateGroup}
                >
                  <Row gutter={16}>
                    <Col span={16}>
                      <Form.Item
                        name="groupId"
                        label="ID Grup"
                        rules={[{ required: true, message: 'Silakan pilih grup WhatsApp' }]}
                      >
                        <Select
                          placeholder="Pilih grup WhatsApp"
                          loading={loadingGroups}
                          onFocus={fetchGroups}
                          suffixIcon={loadingGroups ? <SyncOutlined spin /> : null}
                        >
                          {groups.map(group => (
                            <Option key={group.id} value={group.id}>
                              {group.name} ({group.participants} anggota)
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name="groupName"
                        label="Nama Grup (untuk referensi)"
                        rules={[{ required: true, message: 'Silakan masukkan nama grup' }]}
                      >
                        <Input placeholder="Nama grup untuk referensi" />
                      </Form.Item>
                    </Col>
                  </Row>
                  
                  <Form.Item>
                    <Button 
                      type="primary" 
                      htmlType="submit" 
                      icon={<UsergroupAddOutlined />}
                      loading={loading}
                    >
                      Simpan Pengaturan Grup
                    </Button>
                  </Form.Item>
                </Form>
                
                <Alert
                  message="Informasi"
                  description="Grup yang dipilih akan digunakan untuk mengirim notifikasi verifikasi pembayaran."
                  type="info"
                  showIcon
                />
              </div>
            ) : (
              <Alert
                message="WhatsApp Belum Terhubung"
                description="Silakan hubungkan WhatsApp terlebih dahulu untuk mengatur grup notifikasi."
                type="warning"
                showIcon
              />
            )}
          </Card>
        </TabPane>
        
        <TabPane 
          tab={
            <span>
              <InfoCircleOutlined /> Pengaturan Pembayaran
            </span>
          } 
          key="2"
        >
          <Card>
            <Form
              form={settingsForm}
              layout="vertical"
              initialValues={paymentSettings}
              onFinish={handleUpdatePaymentSettings}
            >
              <Title level={4}>Pengaturan Umum</Title>
              
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="timeout_seconds"
                    label="Batas Waktu Pembayaran (detik)"
                    rules={[
                      { required: true, message: 'Silakan masukkan batas waktu pembayaran' },
                      { type: 'number', min: 60, message: 'Minimal 60 detik' }
                    ]}
                    tooltip="Waktu yang diberikan kepada pengguna untuk menyelesaikan pembayaran sebelum kedaluwarsa"
                  >
                    <Input 
                      type="number" 
                      min={60} 
                      placeholder="3600 (1 jam)" 
                      addonAfter="detik"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="max_pending_transactions"
                    label="Jumlah Maksimal Pesanan Tertunda"
                    rules={[
                      { required: true, message: 'Silakan masukkan jumlah maksimal pesanan tertunda' },
                      { type: 'number', min: 1, message: 'Minimal 1 pesanan' }
                    ]}
                    tooltip="Jumlah maksimal pesanan tertunda yang diizinkan per pengguna"
                  >
                    <Input 
                      type="number" 
                      min={1} 
                      placeholder="3" 
                      addonAfter="pesanan"
                    />
                  </Form.Item>
                </Col>
              </Row>
              
              <Divider>Pengaturan QRIS</Divider>
              
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="qris_merchant_name"
                    label="Nama Merchant QRIS"
                    rules={[{ required: true, message: 'Silakan masukkan nama merchant QRIS' }]}
                  >
                    <Input placeholder="Nama merchant yang muncul di pembayaran QRIS" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="qris_image"
                    label="Gambar QRIS"
                    valuePropName="file"
                    tooltip="Gambar kode QR untuk pembayaran QRIS"
                  >
                    <Upload {...uploadProps} listType="picture-card">
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>Upload</div>
                      </div>
                    </Upload>
                  </Form.Item>
                </Col>
              </Row>
              
              {paymentSettings.qris_image_path && (
                <div style={{ marginBottom: 16, textAlign: 'center' }}>
                  <Text strong>Gambar QRIS Saat Ini:</Text>
                  <div style={{ marginTop: 8 }}>
                    <img 
                      src={paymentSettings.qris_image_path} 
                      alt="QRIS" 
                      style={{ maxWidth: 200, maxHeight: 200, border: '1px solid #d9d9d9', borderRadius: 4 }} 
                    />
                  </div>
                </div>
              )}
              
              <Divider>Template Notifikasi</Divider>
              
              <Form.Item
                name="wa_message_template"
                label="Template Notifikasi WhatsApp"
                rules={[{ required: true, message: 'Silakan masukkan template notifikasi' }]}
                tooltip="Template pesan notifikasi yang dikirim ke grup WhatsApp"
              >
                <TextArea 
                  rows={4} 
                  placeholder="Template notifikasi pembayaran untuk grup WhatsApp" 
                />
              </Form.Item>
              
              <Form.Item>
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  loading={uploadLoading}
                >
                  Simpan Pengaturan Pembayaran
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </TabPane>
      </Tabs>
    </div>
  );
};

export default WhatsAppSettings;