import React, { useState, useEffect } from 'react';
import { 
  Card, Typography, Table, Button, Tag, Badge, 
  Space, Modal, Descriptions, Divider, message,
  Image, Row, Col, Statistic, Tabs, Alert, Input, DatePicker
} from 'antd';
import { 
  CheckCircleOutlined, CloseCircleOutlined, 
  SearchOutlined, ReloadOutlined, 
  ExclamationCircleOutlined, ClockCircleOutlined
} from '@ant-design/icons';
import axiosInstance from '../../services/axios';
import moment from 'moment';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { confirm } = Modal;
const { RangePicker } = DatePicker;

const PaymentVerification = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [statistics, setStatistics] = useState({
    pending: 0,
    verified: 0,
    rejected: 0,
    expired: 0,
    total: 0
  });
  const [filters, setFilters] = useState({
    status: null,
    keyword: '',
    dateRange: null
  });

  // Format currency
  const formatCurrency = (amount) => {
    return `Rp ${amount.toLocaleString('id-ID')}`;
  };

  // Format date
  const formatDate = (dateString) => {
    return moment(dateString).format('DD MMMM YYYY HH:mm:ss');
  };

  // Fetch payments
  const fetchPayments = async () => {
    try {
      setLoading(true);
      
      // Buat parameter URL
      let url = '/api/qris/payments';
      const params = [];
      
      if (filters.status) {
        params.push(`status=${filters.status}`);
      }
      
      if (filters.keyword) {
        params.push(`keyword=${encodeURIComponent(filters.keyword)}`);
      }
      
      if (filters.dateRange && filters.dateRange[0] && filters.dateRange[1]) {
        const startDate = filters.dateRange[0].format('YYYY-MM-DD');
        const endDate = filters.dateRange[1].format('YYYY-MM-DD');
        params.push(`startDate=${startDate}&endDate=${endDate}`);
      }
      
      if (params.length > 0) {
        url += `?${params.join('&')}`;
      }
      
      const response = await axiosInstance.get(url);
      
      setPayments(response.data.payments || []);
      
      // Hitung statistik
      const stats = {
        pending: 0,
        verified: 0,
        rejected: 0,
        expired: 0,
        total: (response.data.payments || []).length
      };
      
      (response.data.payments || []).forEach(payment => {
        stats[payment.status]++;
      });
      
      setStatistics(stats);
    } catch (error) {
      console.error('Error fetching payments:', error);
      message.error('Gagal mengambil data pembayaran');
    } finally {
      setLoading(false);
    }
  };

  // Verify payment
  const handleVerify = (payment) => {
    confirm({
      title: 'Verifikasi Pembayaran',
      icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
      content: `Apakah Anda yakin ingin memverifikasi pembayaran dengan referensi ${payment.reference_id}?`,
      okText: 'Verifikasi',
      okType: 'primary',
      cancelText: 'Batal',
      onOk: async () => {
        try {
          setLoading(true);
          await axiosInstance.post(`/api/qris/payments/${payment.id}/verify`);
          message.success('Pembayaran berhasil diverifikasi');
          fetchPayments();
          
          if (detailVisible && selectedPayment && selectedPayment.id === payment.id) {
            setDetailVisible(false);
          }
        } catch (error) {
          console.error('Error verifying payment:', error);
          message.error('Gagal memverifikasi pembayaran');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // Reject payment
  const handleReject = (payment) => {
    confirm({
      title: 'Tolak Pembayaran',
      icon: <CloseCircleOutlined style={{ color: '#f5222d' }} />,
      content: `Apakah Anda yakin ingin menolak pembayaran dengan referensi ${payment.reference_id}?`,
      okText: 'Tolak',
      okType: 'danger',
      cancelText: 'Batal',
      onOk: async () => {
        try {
          setLoading(true);
          await axiosInstance.post(`/api/qris/payments/${payment.id}/reject`);
          message.success('Pembayaran berhasil ditolak');
          fetchPayments();
          
          if (detailVisible && selectedPayment && selectedPayment.id === payment.id) {
            setDetailVisible(false);
          }
        } catch (error) {
          console.error('Error rejecting payment:', error);
          message.error('Gagal menolak pembayaran');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // Show payment detail
  const showDetail = (payment) => {
    setSelectedPayment(payment);
    setDetailVisible(true);
  };

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters({
      ...filters,
      [key]: value
    });
  };

  // Handle search
  const handleSearch = () => {
    fetchPayments();
  };

  // Handle reset filters
  const handleResetFilters = () => {
    setFilters({
      status: null,
      keyword: '',
      dateRange: null
    });
    fetchPayments();
  };

  // Columns for payment table
  const columns = [
    {
      title: 'Referensi',
      dataIndex: 'reference_id',
      key: 'reference_id',
      render: text => <Text copyable>{text}</Text>
    },
    {
      title: 'Pengguna',
      dataIndex: 'User',
      key: 'user',
      render: user => (
        <div>
          <div>{user.username}</div>
          <div>{user.email}</div>
        </div>
      )
    },
    {
      title: 'Paket Langganan',
      dataIndex: 'SubscriptionPlan',
      key: 'subscription_plan',
      render: plan => plan.name
    },
    {
      title: 'Total',
      dataIndex: 'total_amount',
      key: 'total_amount',
      render: amount => formatCurrency(amount),
      sorter: (a, b) => a.total_amount - b.total_amount
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: status => {
        let color = 'default';
        let text = status.toUpperCase();
        
        if (status === 'verified') {
          color = 'success';
          text = 'DIVERIFIKASI';
        } else if (status === 'rejected') {
          color = 'error';
          text = 'DITOLAK';
        } else if (status === 'expired') {
          color = 'warning';
          text = 'KEDALUWARSA';
        } else if (status === 'pending') {
          color = 'processing';
          text = 'MENUNGGU';
        }
        
        return <Tag color={color}>{text}</Tag>;
      },
      filters: [
        { text: 'Menunggu', value: 'pending' },
        { text: 'Diverifikasi', value: 'verified' },
        { text: 'Ditolak', value: 'rejected' },
        { text: 'Kedaluwarsa', value: 'expired' }
      ],
      onFilter: (value, record) => record.status === value
    },
    {
      title: 'Tanggal',
      dataIndex: 'created_at',
      key: 'created_at',
      render: date => formatDate(date),
      sorter: (a, b) => moment(a.created_at).valueOf() - moment(b.created_at).valueOf(),
      defaultSortOrder: 'descend'
    },
    {
      title: 'Aksi',
      key: 'action',
      render: (_, record) => (
        <Space size="small">
          <Button 
            type="primary" 
            size="small" 
            onClick={() => showDetail(record)}
          >
            Detail
          </Button>
          
          {record.status === 'pending' && (
            <>
              <Button 
                type="primary" 
                size="small" 
                icon={<CheckCircleOutlined />} 
                onClick={() => handleVerify(record)}
              >
                Verifikasi
              </Button>
              <Button 
                type="primary" 
                danger 
                size="small" 
                icon={<CloseCircleOutlined />} 
                onClick={() => handleReject(record)}
              >
                Tolak
              </Button>
            </>
          )}
        </Space>
      )
    }
  ];

  useEffect(() => {
    fetchPayments();
    
    // Refresh data setiap 30 detik
    const refreshInterval = setInterval(fetchPayments, 30000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  return (
    <div>
      <Title level={2}>Verifikasi Pembayaran</Title>
      
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Statistic 
            title="Total Pembayaran" 
            value={statistics.total} 
            prefix={<Badge status="default" />} 
          />
        </Col>
        <Col span={6}>
          <Statistic 
            title="Menunggu Verifikasi" 
            value={statistics.pending} 
            valueStyle={{ color: '#1890ff' }}
            prefix={<Badge status="processing" />} 
          />
        </Col>
        <Col span={6}>
          <Statistic 
            title="Terverifikasi" 
            value={statistics.verified} 
            valueStyle={{ color: '#52c41a' }}
            prefix={<Badge status="success" />} 
          />
        </Col>
        <Col span={6}>
          <Statistic 
            title="Ditolak/Kedaluwarsa" 
            value={(statistics.rejected || 0) + (statistics.expired || 0)} 
            valueStyle={{ color: '#f5222d' }}
            prefix={<Badge status="error" />} 
          />
        </Col>
      </Row>
      
      <Card style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Input
                placeholder="Cari referensi, username, atau email"
                value={filters.keyword}
                onChange={e => handleFilterChange('keyword', e.target.value)}
                prefix={<SearchOutlined />}
              />
            </Col>
            <Col span={8}>
              <RangePicker
                style={{ width: '100%' }}
                value={filters.dateRange}
                onChange={value => handleFilterChange('dateRange', value)}
              />
            </Col>
            <Col span={8}>
              <Space>
                <Button 
                  type="primary" 
                  onClick={handleSearch}
                  icon={<SearchOutlined />}
                >
                  Cari
                </Button>
                <Button 
                  onClick={handleResetFilters}
                  icon={<ReloadOutlined />}
                >
                  Reset
                </Button>
              </Space>
            </Col>
          </Row>
        </div>
        
        <Table 
          dataSource={payments} 
          columns={columns} 
          rowKey="id" 
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
      
      <Modal
        title="Detail Pembayaran"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        {selectedPayment && (
          <div>
            <Descriptions title="Informasi Pembayaran" bordered column={1}>
              <Descriptions.Item label="Nomor Referensi">
                <Text copyable>{selectedPayment.reference_id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={
                  selectedPayment.status === 'verified' ? 'success' :
                  selectedPayment.status === 'rejected' ? 'error' :
                  selectedPayment.status === 'expired' ? 'warning' : 'processing'
                }>
                  {selectedPayment.status === 'verified' ? 'DIVERIFIKASI' :
                   selectedPayment.status === 'rejected' ? 'DITOLAK' :
                   selectedPayment.status === 'expired' ? 'KEDALUWARSA' : 'MENUNGGU'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Dibuat Pada">
                {formatDate(selectedPayment.created_at)}
              </Descriptions.Item>
              {selectedPayment.verified_at && (
                <Descriptions.Item label="Diverifikasi/Ditolak Pada">
                  {formatDate(selectedPayment.verified_at)}
                </Descriptions.Item>
              )}
              {selectedPayment.verified_by && (
                <Descriptions.Item label="Diverifikasi/Ditolak Oleh">
                  {selectedPayment.verified_by}
                </Descriptions.Item>
              )}
              {selectedPayment.status === 'pending' && (
                <Descriptions.Item label="Batas Waktu">
                  {formatDate(selectedPayment.expired_at)}
                </Descriptions.Item>
              )}
            </Descriptions>
            
            <Divider />
            
            <Descriptions title="Detail Pengguna" bordered column={1}>
              <Descriptions.Item label="Username">
                {selectedPayment.User.username}
              </Descriptions.Item>
              <Descriptions.Item label="Email">
                {selectedPayment.User.email}
              </Descriptions.Item>
            </Descriptions>
            
            <Divider />
            
            <Descriptions title="Detail Paket Langganan" bordered column={1}>
              <Descriptions.Item label="Nama Paket">
                {selectedPayment.SubscriptionPlan.name}
              </Descriptions.Item>
              <Descriptions.Item label="Durasi">
                {selectedPayment.SubscriptionPlan.duration_days} hari
              </Descriptions.Item>
              <Descriptions.Item label="Harga Paket">
                {formatCurrency(selectedPayment.amount)}
              </Descriptions.Item>
              <Descriptions.Item label="Kode Unik">
                {formatCurrency(selectedPayment.unique_code)}
              </Descriptions.Item>
              <Descriptions.Item label="Total Pembayaran">
                <Text strong>{formatCurrency(selectedPayment.total_amount)}</Text>
              </Descriptions.Item>
            </Descriptions>
            
            {selectedPayment.status === 'pending' && (
              <div style={{ marginTop: 24, textAlign: 'right' }}>
                <Space>
                  <Button 
                    type="primary" 
                    icon={<CheckCircleOutlined />} 
                    onClick={() => handleVerify(selectedPayment)}
                  >
                    Verifikasi Pembayaran
                    </Button>
                  <Button 
                    type="primary" 
                    danger 
                    icon={<CloseCircleOutlined />} 
                    onClick={() => handleReject(selectedPayment)}
                  >
                    Tolak Pembayaran
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PaymentVerification;