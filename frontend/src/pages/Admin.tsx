import { useState, useEffect } from 'react'
import {
  Card,
  Tabs,
  Typography,
  Form,
  Select,
  Button,
  Space,
  message,
  Spin,
  Alert,
  Descriptions,
  Tag,
  Divider,
  Input,
  InputNumber,
  Row,
  Col,
} from 'antd'
import {
  UserOutlined,
  SafetyOutlined,
  AuditOutlined,
  GoldOutlined,
  DatabaseOutlined,
  SaveOutlined,
  CloudServerOutlined,
  CheckCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { configApi } from '../services/api'

const { Title, Text } = Typography

const dbTypeOptions = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'hive', label: 'Hive' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'doris', label: 'Doris' },
  { value: 'starrocks', label: 'StarRocks' },
  { value: 'spark', label: 'Spark SQL' },
]

function UserManagement() {
  return (
    <Card>
      <Typography.Text type="secondary">
        用户管理功能开发中...
      </Typography.Text>
    </Card>
  )
}

function RoleManagement() {
  return (
    <Card>
      <Typography.Text type="secondary">
        角色权限管理功能开发中...
      </Typography.Text>
    </Card>
  )
}

function AuditLogs() {
  return (
    <Card>
      <Typography.Text type="secondary">
        审计日志功能开发中...
      </Typography.Text>
    </Card>
  )
}

function WarehouseConfig() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testPassed, setTestPassed] = useState(false)
  const [currentConfig, setCurrentConfig] = useState<any>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const res = await configApi.getWarehouse()
      setCurrentConfig(res.data)
      if (res.data.configured) {
        form.setFieldsValue({
          name: res.data.name,
          type: res.data.type,
          host: res.data.host,
          port: res.data.port,
          database: res.data.database,
          username: res.data.username,
          schema_name: res.data.schema_name,
          extra_params: res.data.extra_params,
          password: '', // 密码不回显
        })
      }
    } catch (error) {
      message.error('加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async () => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      const res = await configApi.testWarehouse(values)
      if (res.data.success) {
        message.success('连接成功')
        setTestPassed(true)
      } else {
        message.error(`连接失败: ${res.data.message}`)
        setTestPassed(false)
      }
    } catch (error: any) {
      if (error.errorFields) {
        message.error('请填写完整的连接信息')
        return
      }
      message.error('测试失败')
      setTestPassed(false)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const res = await configApi.setWarehouse(values)
      setCurrentConfig(res.data)
      message.success('平台数据库配置保存成功')
      setTestPassed(false)
    } catch (error: any) {
      if (error.errorFields) return
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin tip="加载中..." />
      </div>
    )
  }

  return (
    <div>
      <Alert
        message="平台数据库/数据湖配置"
        description="配置数据同步的目标数据库连接信息。此配置独立于数据源管理，后续可扩展支持数据湖(Iceberg、Hudi、Delta Lake)。"
        type="info"
        showIcon
        icon={<CloudServerOutlined />}
        style={{ marginBottom: 24 }}
      />

      {/* 当前配置状态 */}
      {currentConfig?.configured && (
        <Card
          title={
            <Space>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <span>当前配置</span>
            </Space>
          }
          size="small"
          style={{ marginBottom: 24 }}
        >
          <Descriptions column={3} size="small">
            <Descriptions.Item label="名称">
              <Text strong>{currentConfig.name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="类型">
              <Tag color="gold">{currentConfig.type?.toUpperCase()}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="主机">{currentConfig.host}:{currentConfig.port}</Descriptions.Item>
            <Descriptions.Item label="数据库">{currentConfig.database}</Descriptions.Item>
            <Descriptions.Item label="用户名">{currentConfig.username}</Descriptions.Item>
            <Descriptions.Item label="Schema">{currentConfig.schema_name || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 配置表单 */}
      <Card
        title={
          <Space>
            <DatabaseOutlined />
            <span>{currentConfig?.configured ? '修改配置' : '配置平台数据库连接'}</span>
          </Space>
        }
      >
        <div style={{ maxWidth: 480 }}>
          <Form
            form={form}
            layout="vertical"
            onValuesChange={() => setTestPassed(false)}
            initialValues={{ port: 3306 }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="name"
                  label="平台数据库名称"
                  rules={[{ required: true, message: '请输入平台数据库名称' }]}
                >
                  <Input placeholder="生产平台数据库" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="type"
                  label="数据库类型"
                  rules={[{ required: true, message: '请选择数据库类型' }]}
                >
                  <Select
                    placeholder="选择类型"
                    options={dbTypeOptions}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={16}>
                <Form.Item
                  name="host"
                  label="主机地址"
                  rules={[{ required: true, message: '请输入主机地址' }]}
                >
                  <Input placeholder="192.168.1.100" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="port"
                  label="端口"
                  rules={[{ required: true, message: '请输入端口' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="database"
                  label="数据库名"
                  rules={[{ required: true, message: '请输入数据库名' }]}
                >
                  <Input placeholder="数据库名称" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="schema_name"
                  label="Schema"
                >
                  <Input placeholder="可选" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={[{ required: true, message: '请输入用户名' }]}
                >
                  <Input placeholder="用户名" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="password"
                  label="密码"
                  rules={[{ required: !currentConfig?.configured, message: '请输入密码' }]}
                >
                  <Input.Password placeholder={currentConfig?.configured ? '留空不修改' : '密码'} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="extra_params"
              label="额外参数"
            >
              <Input placeholder="charset=utf8mb4&timeout=30" />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  icon={<ApiOutlined />}
                  onClick={handleTest}
                  loading={testing}
                >
                  测试连接
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={saving}
                  disabled={!testPassed && !currentConfig?.configured}
                >
                  保存配置
                </Button>
                {testPassed && (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    连接测试通过
                  </Tag>
                )}
              </Space>
            </Form.Item>
          </Form>
        </div>
      </Card>

      <Divider />

      <Card title="说明" size="small">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>平台数据库配置是全局唯一的，所有数据同步任务共用此目标</li>
          <li>修改配置后，新创建的同步任务将使用新的目标数据库</li>
          <li>密码将加密存储，不会明文保存</li>
          <li>
            <Text strong>支持的数据库类型：</Text>
            <Space style={{ marginLeft: 8 }}>
              {dbTypeOptions.map(opt => (
                <Tag key={opt.value}>{opt.label}</Tag>
              ))}
            </Space>
          </li>
          <li>后续将支持数据湖：Iceberg、Hudi、Delta Lake</li>
        </ul>
      </Card>
    </div>
  )
}

export default function Admin() {
  const items = [
    {
      key: 'warehouse',
      label: (
        <span>
          <GoldOutlined />
          平台数据库配置
        </span>
      ),
      children: <WarehouseConfig />,
    },
    {
      key: 'users',
      label: (
        <span>
          <UserOutlined />
          用户管理
        </span>
      ),
      children: <UserManagement />,
    },
    {
      key: 'roles',
      label: (
        <span>
          <SafetyOutlined />
          角色权限
        </span>
      ),
      children: <RoleManagement />,
    },
    {
      key: 'audit',
      label: (
        <span>
          <AuditOutlined />
          审计日志
        </span>
      ),
      children: <AuditLogs />,
    },
  ]

  return (
    <div>
      <Title level={4}>系统管理</Title>
      <Tabs items={items} />
    </div>
  )
}
