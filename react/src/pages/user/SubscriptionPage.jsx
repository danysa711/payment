import React, { useState, useEffect, useContext } from 'react';
import { 
  Card, Row, Col, Typography, Button, Table, Tag, 
  Divider, Spin, Empty, Alert, Modal, Statistic, 
  Descriptions, Result, Steps, Radio, Input, Form, message, Tabs, Timeline
} from 'antd';
import { 
  ShoppingCartOutlined, CheckCircleOutlined, 
  CalendarOutlined, BankOutlined, WalletOutlined,
  InfoCircleOutlined, CreditCardOutlined, ClockCircleOutlined,
  CheckOutlined, CloseOutlined, DollarOutlined, ReloadOutlined
} from '@ant-design/icons';
import axiosInstance from '../../services/axios';
import moment from 'moment';
import { AuthContext } from '../../context/AuthContext';

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;
const { TextArea } = Input;
const { TabPane } = Tabs;

const SubscriptionPage = () => {
  // State variables
  const { user, updateUserData, fetchUserProfile } = useContext(AuthContext);
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [paymentDetail, setPaymentDetail] = useState(null);
  const [qrisSettings, setQrisSettings] = useState({
    image: null,
    merchant: 'KinterStore'
  });
  const [markingAsPaid, setMarkingAsPaid] = useState(false);
  const [form] = Form.useForm();

  // Helper Functions
  // Format date
  const formatDate = (dateString) => {
    return moment(dateString).format('DD MMMM YYYY HH:mm');
  };

  // Calculate remaining days
  const calculateRemainingDays = (endDate) => {
    const end = moment(endDate);
    const today = moment();
    const diffDays = end.diff(today, 'days');
    return diffDays > 0 ? diffDays : 0;
  };

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch subscription plans
      const plansResponse = await axiosInstance.get('/api/subscription-plans');
      setPlans(plansResponse.data);

      // Fetch user subscriptions
      const subsResponse = await axiosInstance.get('/api/subscriptions/user');
      
      // Sort subscriptions by start date (newest first)
      const sortedSubs = subsResponse.data.sort((a, b) => 
        moment(b.start_date).valueOf() - moment(a.start_date).valueOf()
      );
      
      setSubscriptions(sortedSubs);

      // Find active subscription
      const active = subsResponse.data.find(
        (sub) => sub.status === 'active' && moment(sub.end_date).isAfter(moment())
      );
      
      setActiveSubscription(active);
      
      // Fetch pending payments
      const pendingResponse = await axiosInstance.get('/api/qris/payments/user?status=pending');
      setPendingPayments(pendingResponse.data.payments || []);
      
      // Fetch payment history
      const historyResponse = await axiosInstance.get('/api/qris/payments/user');
      const payments = historyResponse.data.payments || [];
      setPaymentHistory(payments.filter(p => p.status !== 'pending'));
      
      // Fetch QRIS settings
      const settingsResponse = await axiosInstance.get('/api/qris/settings');
      if (settingsResponse.data.settings) {
        setQrisSettings({
          image: settingsResponse.data.settings.qris_image_path,
          merchant: settingsResponse.data.settings.qris_merchant_name
        });
      }
      
      // Update user data if needed
      if (updateUserData && active && !user.hasActiveSubscription) {
        const updatedUser = { ...user, hasActiveSubscription: true };
        updateUserData(updatedUser);
      } else if (updateUserData && !active && user.hasActiveSubscription) {
        const updatedUser = { ...user, hasActiveSubscription: false };
        updateUserData(updatedUser);
      }
    } catch (err) {
      console.error('Error fetching subscription data:', err);
      setError('Gagal memuat data langganan. Silakan coba lagi nanti.');
    } finally {
      setLoading(false);
    }
  };

  // Event Handlers
  const handlePurchase = (plan) => {
    setSelectedPlan(plan);
    form.resetFields();
    setPaymentDetail(null);
    setPaymentModalVisible(true);
  };
  
  const handleCreatePayment = async () => {
    try {
      setLoading(true);
      
      const response = await axiosInstance.post('/api/qris/payments', {
        subscription_plan_id: selectedPlan.id
      });
      
      setPaymentDetail(response.data.payment);
      message.success('Pembayaran berhasil dibuat');
      
      // Refresh data
      fetchData();
    } catch (error) {
      console.error('Error creating payment:', error);
      message.error(error.response?.data?.error || 'Gagal membuat pembayaran');
    } finally {
      setLoading(false);
    }
  };
  
  const handleMarkAsPaid = async (referenceId) => {
    try {
      setMarkingAsPaid(true);
      
      await axiosInstance.post(`/api/qris/payments/${referenceId}/mark-as-paid`);
      
      message.success('Notifikasi pembayaran berhasil dikirim. Mohon tunggu verifikasi dari admin.');
      
      // Refresh data
      fetchData();
      
      // Tutup modal
      setPaymentModalVisible(false);
    } catch (error) {
      console.error('Error marking payment as paid:', error);
      message.error(error.response?.data?.error || 'Gagal mengirim notifikasi pembayaran');
    } finally {
      setMarkingAsPaid(false);
    }
  };
  
  const handleViewPaymentDetail = async (payment) => {
    try {
      // Jika ini adalah referensi langsung ke objek pembayaran, gunakan itu
      if (payment.reference_id) {
        setPaymentDetail(payment);
        setPaymentModalVisible(true);
        return;
      }
      
      // Jika ini adalah ID, dapatkan detail dari API
      setLoading(true);
      const response = await axiosInstance.get(`/api/qris/payments/${payment}`);
      setPaymentDetail(response.data.payment);
      setPaymentModalVisible(true);
    } catch (error) {
      console.error('Error fetching payment details:', error);
      message.error('Gagal mendapatkan detail pembayaran');
    } finally {
      setLoading(false);
    }
  };

  // Use Effect hooks
  useEffect(() => {
    fetchData();
    
    // Refresh data setiap 1 menit
    const interval = setInterval(fetchData, 60000);
    
    return () => clearInterval(interval);
  }, []);

  // Render functions
  const renderPaymentDetail = () => {
    if (!paymentDetail) return null;
    
    const isExpired = moment(paymentDetail.expired_at).isBefore(moment());
    
    return (
      <div>
        <Result
          status={
            paymentDetail.status === 'verified' ? 'success' :
            paymentDetail.status === 'rejected' ? 'error' :
            paymentDetail.status === 'expired' ? 'warning' : 'info'
          }
          title={
            paymentDetail.status === 'verified' ? 'Pembayaran Berhasil' :
            paymentDetail.status === 'rejected' ? 'Pembayaran Ditolak' :
            paymentDetail.status === 'expired' ? 'Pembayaran Kedaluwarsa' : 'Menunggu Pembayaran'
          }
          subTitle={`Nomor Referensi: ${paymentDetail.reference_id}`}
        />
        
        <Descriptions
          title="Detail Pembayaran"
          bordered
          column={1}
        >
          <Descriptions.Item label="Nomor Referensi">
            <Text copyable>{paymentDetail.reference_id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Metode Pembayaran">
            QRIS
          </Descriptions.Item>
          <Descriptions.Item label="Jumlah">
            Rp {paymentDetail.amount.toLocaleString('id-ID')}
          </Descriptions.Item>
          <Descriptions.Item label="Kode Unik">
            Rp {paymentDetail.unique_code.toLocaleString('id-ID')}
          </Descriptions.Item>
          <Descriptions.Item label="Total Pembayaran">
            <Text strong>Rp {paymentDetail.total_amount.toLocaleString('id-ID')}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={
              paymentDetail.status === 'verified' ? 'success' :
              paymentDetail.status === 'rejected' ? 'error' :
              paymentDetail.status === 'expired' ? 'warning' : 'processing'
            }>
              {paymentDetail.status === 'verified' ? 'BERHASIL' :
               paymentDetail.status === 'rejected' ? 'DITOLAK' :
               paymentDetail.status === 'expired' ? 'KEDALUWARSA' : 'MENUNGGU'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Dibuat Pada">
            {formatDate(paymentDetail.created_at)}
          </Descriptions.Item>
          {paymentDetail.status === 'pending' && !isExpired && (
            <Descriptions.Item label="Batas Waktu">
              {formatDate(paymentDetail.expired_at)}
            </Descriptions.Item>
          )}
        </Descriptions>
        
        {paymentDetail.status === 'pending' && !isExpired && (
          <div style={{ marginTop: 24 }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <Title level={4}>Scan QRIS untuk Pembayaran</Title>
              <Text>Merchant: {qrisSettings.merchant}</Text>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              {qrisSettings.image ? (
                <img 
                  src={qrisSettings.image} 
                  alt="QRIS" 
                  style={{ maxWidth: 300, maxHeight: 300 }} 
                />
              ) : (
                <Empty description="Gambar QRIS tidak tersedia" />
              )}
            </div>
            
            <Alert
              message="Instruksi Pembayaran"
              description={
                <ol>
                  <li>Scan kode QR di atas dengan aplikasi e-wallet atau mobile banking Anda</li>
                  <li>Pastikan nominal pembayaran <strong>TEPAT Rp {paymentDetail.total_amount.toLocaleString('id-ID')}</strong> (termasuk kode unik)</li>
                  <li>Setelah pembayaran berhasil, klik tombol "Saya Sudah Transfer" di bawah</li>
                  <li>Tunggu hingga pembayaran diverifikasi oleh admin</li>
                </ol>
              }
              type="info"
              showIcon
            />
            
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <Button
                type="primary"
                size="large"
                onClick={() => handleMarkAsPaid(paymentDetail.reference_id)}
                loading={markingAsPaid}
              >
                Saya Sudah Transfer
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render loading state
  if (loading && !paymentDetail) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
        <div style={{ marginTop: 20 }}>Memuat data langganan...</div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div>
        <Title level={2}>Langganan</Title>
        <Alert
          message="Terjadi Kesalahan"
          description={error}
          type="error"
          showIcon
          style={{ marginBottom: 20 }}
          action={
            <Button type="primary" onClick={fetchData}>
              Coba Lagi
            </Button>
          }
        />
      </div>
    );
  }

  // Main component render
  return (
    <div>
      <Title level={2}>Langganan</Title>

      {/* Active Subscription Section */}
      <Card 
        title={<Title level={4}>Status Langganan Saat Ini</Title>} 
        style={{ marginBottom: 24 }}
        extra={
          activeSubscription ? (
            <Tag color="success" style={{ fontSize: '14px', padding: '4px 8px' }}>AKTIF</Tag>
          ) : (
            <Tag color="error" style={{ fontSize: '14px', padding: '4px 8px' }}>TIDAK AKTIF</Tag>
          )
        }
      >
        {activeSubscription ? (
          <Row gutter={[24, 24]}>
            <Col xs={24} sm={12} md={8}>
              <Statistic
                title="Sisa Waktu Langganan"
                value={calculateRemainingDays(activeSubscription.end_date)}
                suffix="hari"
                valueStyle={{ color: '#3f8600' }}
              />
            </Col>
            <Col xs={24} sm={12} md={16}>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="Mulai Langganan">
                  {formatDate(activeSubscription.start_date)}
                </Descriptions.Item>
                <Descriptions.Item label="Berakhir Pada">
                  {formatDate(activeSubscription.end_date)}
                </Descriptions.Item>
                <Descriptions.Item label="Status Pembayaran">
                  <Tag color={activeSubscription.payment_status === 'paid' ? 'green' : 'orange'}>
                    {activeSubscription.payment_status === 'paid' ? 'LUNAS' : 'MENUNGGU'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Metode Pembayaran">
                  {activeSubscription.payment_method || '-'}
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
        ) : (
          <Result
            status="warning"
            title="Anda belum memiliki langganan aktif"
            subTitle="Silakan pilih paket langganan di bawah untuk mengaktifkan fitur penuh"
            extra={
              <Button type="primary" onClick={() => window.scrollTo({
                top: document.getElementById('subscription-plans').offsetTop - 20,
                behavior: 'smooth'
              })}>
                Lihat Paket Langganan
              </Button>
            }
          />
        )}
      </Card>  
      
      {/* Available Plans Section */}
      <div id="subscription-plans">
        <Title level={4}>Paket Langganan Tersedia</Title>
        <Row gutter={[16, 16]}>
          {plans.length > 0 ? plans.map((plan) => (
            <Col xs={24} sm={12} md={8} lg={6} key={plan.id}>
              <Card
                hoverable
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{plan.name}</span>
                    <Tag color="green">Rp {plan.price.toLocaleString('id-ID')}</Tag>
                  </div>
                }
                actions={[
                  <Button 
                    type="primary" 
                    icon={<ShoppingCartOutlined />}
                    onClick={() => handlePurchase(plan)}
                    block
                  >
                    Beli Sekarang
                  </Button>
                ]}
              >
                <div style={{ marginBottom: 12 }}>
                  <Text strong>{plan.duration_days} hari</Text>
                </div>
                <div>{plan.description || `Langganan standar selama ${plan.name}`}</div>
              </Card>
            </Col>
          )) : (
            <Col span={24}>
              <Empty description="Belum ada paket langganan tersedia" />
            </Col>
          )}
        </Row>
      </div>

      {/* Pending Payments Section */}
      {pendingPayments.length > 0 && (
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          <Title level={4}>Pembayaran Menunggu Verifikasi</Title>
          <Table
            dataSource={pendingPayments}
            rowKey="reference_id"
            pagination={false}
            columns={[
              {
                title: 'Nomor Referensi',
                dataIndex: 'reference_id',
                key: 'reference_id',
                render: text => <Text copyable>{text}</Text>
              },
              {
                title: 'Jumlah',
                dataIndex: 'total_amount',
                key: 'total_amount',
                render: (amount) => `Rp ${amount.toLocaleString('id-ID')}`
              },
              {
                title: 'Batas Waktu',
                dataIndex: 'expired_at',
                key: 'expired_at',
                render: (date) => formatDate(date),
                sorter: (a, b) => moment(a.expired_at).valueOf() - moment(b.expired_at).valueOf()
              },
              {
                title: 'Status',
                key: 'status',
                render: (_, record) => {
                  const isExpired = moment(record.expired_at).isBefore(moment());
                  return (
                    <Tag color={isExpired ? 'warning' : 'processing'}>
                      {isExpired ? 'KEDALUWARSA' : 'MENUNGGU'}
                    </Tag>
                  );
                }
              },
              {
                title: 'Aksi',
                key: 'action',
                render: (_, record) => {
                  const isExpired = moment(record.expired_at).isBefore(moment());
                  return (
                    <Button 
                      type={isExpired ? 'default' : 'primary'}
                      onClick={() => handleViewPaymentDetail(record)}
                    >
                      {isExpired ? 'Lihat Detail' : 'Bayar Sekarang'}
                    </Button>
                  );
                }
              }
            ]}
          />
        </div>
      )}
      
      <Divider />
      
      {/* Subscription & Transaction History Tabs */}
      <Tabs defaultActiveKey="subscriptions">
        <TabPane tab="Riwayat Langganan" key="subscriptions">
          <Table
            dataSource={subscriptions}
            rowKey="id"
            columns={[
              {
                title: 'Tanggal Mulai',
                dataIndex: 'start_date',
                key: 'start_date',
                render: (date) => formatDate(date),
                sorter: (a, b) => moment(b.start_date).valueOf() - moment(a.start_date).valueOf(),
                defaultSortOrder: 'descend',
              },
              {
                title: 'Tanggal Berakhir',
                dataIndex: 'end_date',
                key: 'end_date',
                render: (date) => formatDate(date),
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (status, record) => {
                  let color = 'default';
                  let displayText = status.toUpperCase();
                  
                  if (status === 'active') {
                    const now = moment();
                    const endDate = moment(record.end_date);
                    
                    if (endDate.isAfter(now)) {
                      color = 'success';
                      displayText = 'AKTIF';
                    } else {
                      color = 'error';
                      displayText = 'KADALUARSA';
                    }
                  } else if (status === 'canceled') {
                    color = 'warning';
                    displayText = 'DIBATALKAN';
                  }
                  
                  return <Tag color={color}>{displayText}</Tag>;
                },
                filters: [
                  { text: 'Aktif', value: 'active' },
                  { text: 'Dibatalkan', value: 'canceled' },
                ],
                onFilter: (value, record) => record.status === value,
              },
              {
                title: 'Status Pembayaran',
                dataIndex: 'payment_status',
                key: 'payment_status',
                render: (status) => {
                  const statusMap = {
                    'paid': { color: 'green', text: 'LUNAS' },
                    'pending': { color: 'orange', text: 'MENUNGGU' },
                    'failed': { color: 'red', text: 'GAGAL' }
                  };
                  
                  const { color, text } = statusMap[status] || { color: 'default', text: status.toUpperCase() };
                  
                  return <Tag color={color}>{text}</Tag>;
                },
                filters: [
                  { text: 'Lunas', value: 'paid' },
                  { text: 'Menunggu', value: 'pending' },
                  { text: 'Gagal', value: 'failed' },
                ],
                onFilter: (value, record) => record.payment_status === value,
              },
              {
                title: 'Metode Pembayaran',
                dataIndex: 'payment_method',
                key: 'payment_method',
                render: (method) => method || '-',
              },
            ]}
            pagination={{ pageSize: 5 }}
            locale={{ emptyText: 'Belum ada riwayat langganan' }}
          />
        </TabPane>
        <TabPane tab="Riwayat Transaksi" key="transactions">
          <Table
            dataSource={paymentHistory}
            rowKey="reference_id"
            columns={[
              {
                title: 'Nomor Referensi',
                dataIndex: 'reference_id',
                key: 'reference_id',
                render: text => <Text copyable>{text}</Text>
              },
              {
                title: 'Total',
                dataIndex: 'total_amount',
                key: 'total_amount',
                render: (amount) => `Rp ${amount.toLocaleString('id-ID')}`,
                sorter: (a, b) => a.total_amount - b.total_amount,
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (status) => {
                  let color = 'default';
                  let text = status.toUpperCase();
                  
                  if (status === 'verified') {
                    color = 'success';
                    text = 'BERHASIL';
                  } else if (status === 'rejected') {
                    color = 'error';
                    text = 'DITOLAK';
                  } else if (status === 'expired') {
                    color = 'warning';
                    text = 'KEDALUWARSA';
                  }

                  return <Tag color={color}>{text}</Tag>;
                },
                filters: [
                  { text: 'Berhasil', value: 'verified' },
                  { text: 'Ditolak', value: 'rejected' },
                  { text: 'Kedaluwarsa', value: 'expired' },
                ],
                onFilter: (value, record) => record.status === value,
              },
              {
                title: 'Tanggal',
                dataIndex: 'created_at',
                key: 'created_at',
                render: (date) => formatDate(date),
                sorter: (a, b) => moment(a.created_at).valueOf() - moment(b.created_at).valueOf(),
                defaultSortOrder: 'descend',
              },
              {
                title: 'Aksi',
                key: 'action',
                render: (_, record) => (
                  <Button 
                    type="link"
                    onClick={() => handleViewPaymentDetail(record)}
                  >
                    Detail
                  </Button>
                ),
              },
            ]}
            pagination={{ pageSize: 5 }}
            locale={{ emptyText: 'Belum ada riwayat transaksi' }}
          />
        </TabPane>
      </Tabs>

      {/* Payment Modal */}
      <Modal
        title={paymentDetail ? "Detail Pembayaran" : "Buat Pembayaran"}
        open={paymentModalVisible}
        onCancel={() => setPaymentModalVisible(false)}
        footer={null}
        width={700}
      >
        {selectedPlan && !paymentDetail ? (
          <div>
            <Descriptions title="Detail Paket" bordered>
              <Descriptions.Item label="Nama Paket" span={3}>{selectedPlan.name}</Descriptions.Item>
              <Descriptions.Item label="Durasi">{selectedPlan.duration_days} hari</Descriptions.Item>
              <Descriptions.Item label="Harga" span={2}>Rp {selectedPlan.price.toLocaleString('id-ID')}</Descriptions.Item>
              <Descriptions.Item label="Deskripsi" span={3}>
                {selectedPlan.description || `Langganan standar selama ${selectedPlan.name}`}
              </Descriptions.Item>
            </Descriptions>
            
            <Alert
              message="Informasi Pembayaran"
              description="Setelah Anda membuat pembayaran, Anda akan mendapatkan kode QR QRIS yang dapat digunakan untuk membayar. Pembayaran akan kedaluwarsa jika tidak dibayar dalam batas waktu yang ditentukan."
              type="info"
              showIcon
              style={{ margin: '24px 0' }}
            />
            
            <div style={{ textAlign: 'right', marginTop: 24 }}>
              <Button onClick={() => setPaymentModalVisible(false)} style={{ marginRight: 8 }}>
                Batal
              </Button>
              <Button 
                type="primary" 
                onClick={handleCreatePayment}
                loading={loading}
              >
                Buat Pembayaran
              </Button>
            </div>
          </div>
        ) : (
          renderPaymentDetail()
        )}
      </Modal>
    </div>
  );
};

export default SubscriptionPage;