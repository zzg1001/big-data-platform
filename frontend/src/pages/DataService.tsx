import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layout,
  Typography,
  Button,
  Table,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  InputNumber,
  message,
  Tabs,
  Card,
  Statistic,
  Row,
  Col,
  Tooltip,
  Empty,
  Alert,
  Divider,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  ReloadOutlined,
  KeyOutlined,
  ApiOutlined,
  BarChartOutlined,
  FileTextOutlined,
  HomeOutlined,
  CheckCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { dataServiceApi, tagApi } from '../services/api'
import dayjs from 'dayjs'

const { Header, Content } = Layout
const { Text, Paragraph } = Typography
const { TextArea } = Input

interface ApiKey {
  id: number
  name: string
  description?: string
  key_prefix: string
  scope_type: string
  scope_ids?: number[]
  rate_limit: number
  expires_at?: string
  is_active: boolean
  last_used_at?: string
  total_requests: number
  created_at: string
  updated_at: string
}

interface AccessLog {
  id: number
  api_key_id: number
  api_key_name?: string
  endpoint: string
  method: string
  status_code: number
  response_time_ms?: number
  row_count?: number
  client_ip?: string
  created_at: string
}

export default function DataService() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [activeTab, setActiveTab] = useState('keys')
  const [loading, setLoading] = useState(false)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [stats, setStats] = useState<any>(null)

  // Modal states
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [keyDetailModalVisible, setKeyDetailModalVisible] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null)

  // Tags for scope selection
  const [tags, setTags] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])

  const [form] = Form.useForm()

  // Load data
  const loadKeys = async () => {
    setLoading(true)
    try {
      const res = await dataServiceApi.listKeys()
      setKeys(res.data || [])
    } catch (error) {
      message.error('加载密钥列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const res = await dataServiceApi.getOverviewStats()
      setStats(res.data)
    } catch (error) {
      console.error('Failed to load stats')
    }
  }

  const loadLogs = async () => {
    setLoading(true)
    try {
      const res = await dataServiceApi.getAccessLogs({ page: 1, page_size: 50 })
      setLogs(res.data?.items || [])
    } catch (error) {
      message.error('加载访问日志失败')
    } finally {
      setLoading(false)
    }
  }

  const loadTags = async () => {
    try {
      const res = await tagApi.listNodes({})
      setTags(res.data || [])
    } catch (error) {
      console.error('Failed to load tags')
    }
  }

  const loadProjects = async () => {
    try {
      const res = await tagApi.listProjects()
      setProjects(res.data || [])
    } catch (error) {
      console.error('Failed to load projects')
    }
  }

  useEffect(() => {
    loadKeys()
    loadStats()
    loadTags()
    loadProjects()
  }, [])

  useEffect(() => {
    if (activeTab === 'stats') {
      loadLogs()
    }
  }, [activeTab])

  // Create API Key
  const handleCreateKey = async () => {
    try {
      const values = await form.validateFields()
      const data = {
        ...values,
        expires_at: values.expires_at ? values.expires_at.toISOString() : undefined,
      }
      const res = await dataServiceApi.createKey(data)
      setNewApiKey(res.data.api_key)
      setKeyDetailModalVisible(true)
      setCreateModalVisible(false)
      form.resetFields()
      loadKeys()
      message.success('创建成功')
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败')
    }
  }

  // Delete API Key
  const handleDeleteKey = async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后密钥将立即失效，是否继续？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await dataServiceApi.deleteKey(id)
          message.success('删除成功')
          loadKeys()
        } catch (error) {
          message.error('删除失败')
        }
      },
    })
  }

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  }

  // Key list columns
  const keyColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ApiKey) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{record.key_prefix}</div>
        </div>
      ),
    },
    {
      title: '权限范围',
      dataIndex: 'scope_type',
      key: 'scope_type',
      width: 100,
      render: (type: string) => {
        const map: Record<string, { color: string; label: string }> = {
          all: { color: 'blue', label: '全部' },
          project: { color: 'green', label: '项目' },
          tag: { color: 'orange', label: '标签' },
        }
        const item = map[type] || { color: 'default', label: type }
        return <Tag color={item.color}>{item.label}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (active: boolean, record: ApiKey) => {
        if (record.expires_at && new Date(record.expires_at) < new Date()) {
          return <Tag color="red">已过期</Tag>
        }
        return active ? <Tag color="success">启用</Tag> : <Tag color="default">禁用</Tag>
      },
    },
    {
      title: '调用次数',
      dataIndex: 'total_requests',
      key: 'total_requests',
      width: 100,
      align: 'right' as const,
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      width: 160,
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      width: 120,
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD') : '永久',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: ApiKey) => (
        <Space>
          <Tooltip title="查看详情">
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => { setSelectedKey(record); setKeyDetailModalVisible(true); setNewApiKey(null) }}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteKey(record.id)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  // Log list columns
  const logColumns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '密钥',
      dataIndex: 'api_key_name',
      key: 'api_key_name',
      width: 120,
      ellipsis: true,
    },
    {
      title: '接口',
      dataIndex: 'endpoint',
      key: 'endpoint',
      ellipsis: true,
    },
    {
      title: '状态码',
      dataIndex: 'status_code',
      key: 'status_code',
      width: 80,
      render: (code: number) => (
        <Tag color={code < 400 ? 'success' : 'error'}>{code}</Tag>
      ),
    },
    {
      title: '响应时间',
      dataIndex: 'response_time_ms',
      key: 'response_time_ms',
      width: 100,
      render: (ms: number) => ms ? `${ms}ms` : '-',
    },
    {
      title: '数据量',
      dataIndex: 'row_count',
      key: 'row_count',
      width: 80,
      render: (count: number) => count ?? '-',
    },
    {
      title: 'IP',
      dataIndex: 'client_ip',
      key: 'client_ip',
      width: 120,
    },
  ]

  // Render API Keys tab
  const renderKeysTab = () => (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>
          创建密钥
        </Button>
        <Button icon={<ReloadOutlined />} onClick={loadKeys}>
          刷新
        </Button>
      </div>
      <Table
        dataSource={keys}
        columns={keyColumns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="暂无密钥，点击上方按钮创建" /> }}
      />
    </div>
  )

  // Render API Documentation tab
  const renderDocsTab = () => (
    <div style={{ padding: '0 20px' }}>
      <Alert
        message="接口文档"
        description="使用 API 密钥访问开放数据接口，获取标签数据。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card title="认证方式" size="small" style={{ marginBottom: 16 }}>
        <Paragraph>支持两种认证方式：</Paragraph>
        <ul>
          <li><Text code>Header</Text>: <Text code>X-API-Key: bdk_your_key_here</Text> (推荐)</li>
          <li><Text code>Query</Text>: <Text code>?api_key=bdk_your_key_here</Text></li>
        </ul>
      </Card>

      <Card title="接口列表" size="small" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            <Tag color="green">GET</Tag> /api/v1/data-service/open/tags
          </div>
          <Paragraph type="secondary">获取授权的标签列表</Paragraph>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            <Tag color="green">GET</Tag> /api/v1/data-service/open/tags/{'{tag_id}'}
          </div>
          <Paragraph type="secondary">获取标签详情（包含字段列表和数据量）</Paragraph>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>
            <Tag color="green">GET</Tag> /api/v1/data-service/open/tags/{'{tag_id}'}/data
          </div>
          <Paragraph type="secondary">查询标签数据（核心接口）</Paragraph>
          <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, marginTop: 8 }}>
            <Text strong>参数：</Text>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
              <li><Text code>page</Text> - 页码，默认 1</li>
              <li><Text code>page_size</Text> - 每页条数，默认 100，最大 1000</li>
              <li><Text code>fields</Text> - 返回字段，逗号分隔（可选）</li>
              <li><Text code>sort</Text> - 排序字段（可选）</li>
              <li><Text code>sort_order</Text> - 排序方向：asc / desc</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card title="示例代码" size="small">
        <Tabs
          items={[
            {
              key: 'curl',
              label: 'cURL',
              children: (
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 16, borderRadius: 4, overflow: 'auto' }}>
{`curl -X GET "http://localhost:8000/api/v1/data-service/open/tags/123/data?page=1&page_size=100" \\
  -H "X-API-Key: bdk_your_api_key_here"`}
                </pre>
              ),
            },
            {
              key: 'python',
              label: 'Python',
              children: (
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 16, borderRadius: 4, overflow: 'auto' }}>
{`import requests

response = requests.get(
    "http://localhost:8000/api/v1/data-service/open/tags/123/data",
    headers={"X-API-Key": "bdk_your_api_key_here"},
    params={"page": 1, "page_size": 100}
)
data = response.json()
print(data)`}
                </pre>
              ),
            },
            {
              key: 'javascript',
              label: 'JavaScript',
              children: (
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 16, borderRadius: 4, overflow: 'auto' }}>
{`const response = await fetch(
  "http://localhost:8000/api/v1/data-service/open/tags/123/data?page=1&page_size=100",
  { headers: { "X-API-Key": "bdk_your_api_key_here" } }
);
const data = await response.json();
console.log(data);`}
                </pre>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )

  // Render Statistics tab
  const renderStatsTab = () => (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="密钥总数"
              value={stats?.total_keys || 0}
              prefix={<KeyOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="活跃密钥"
              value={stats?.active_keys || 0}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日请求"
              value={stats?.today_requests || 0}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="本月请求"
              value={stats?.month_requests || 0}
              prefix={<BarChartOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="访问日志" extra={<Button icon={<ReloadOutlined />} onClick={loadLogs}>刷新</Button>}>
        <Table
          dataSource={logs}
          columns={logColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="暂无访问记录" /> }}
          size="small"
        />
      </Card>
    </div>
  )

  return (
    <Layout style={{ height: '100vh', background: '#f5f7fa' }}>
      {/* Header */}
      <Header
        style={{
          background: 'linear-gradient(135deg, #1890ff 0%, #722ed1 100%)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button
            type="text"
            icon={<HomeOutlined />}
            onClick={() => navigate('/')}
            style={{ color: '#fff' }}
          >
            首页
          </Button>
          <div style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>
            <ApiOutlined style={{ marginRight: 8 }} />
            数据服务
          </div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.85)' }}>
          {user?.username}
        </div>
      </Header>

      {/* Content */}
      <Content style={{ padding: 24, overflow: 'auto' }}>
        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'keys',
                label: (
                  <span>
                    <KeyOutlined />
                    API 密钥
                  </span>
                ),
                children: renderKeysTab(),
              },
              {
                key: 'docs',
                label: (
                  <span>
                    <FileTextOutlined />
                    接口文档
                  </span>
                ),
                children: renderDocsTab(),
              },
              {
                key: 'stats',
                label: (
                  <span>
                    <BarChartOutlined />
                    调用统计
                  </span>
                ),
                children: renderStatsTab(),
              },
            ]}
          />
        </Card>
      </Content>

      {/* Create Key Modal */}
      <Modal
        title="创建 API 密钥"
        open={createModalVisible}
        onOk={handleCreateKey}
        onCancel={() => { setCreateModalVisible(false); form.resetFields() }}
        okText="创建"
        cancelText="取消"
        width={500}
      >
        <Form form={form} layout="vertical" initialValues={{ scope_type: 'all', rate_limit: 1000 }}>
          <Form.Item
            name="name"
            label="密钥名称"
            rules={[{ required: true, message: '请输入密钥名称' }]}
          >
            <Input placeholder="例如：移动端数据查询" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="密钥用途说明" />
          </Form.Item>
          <Form.Item name="scope_type" label="权限范围">
            <Select
              options={[
                { label: '全部数据', value: 'all' },
                { label: '按项目', value: 'project' },
                { label: '按标签', value: 'tag' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.scope_type !== curr.scope_type}>
            {({ getFieldValue }) => {
              const scopeType = getFieldValue('scope_type')
              if (scopeType === 'project') {
                return (
                  <Form.Item name="scope_ids" label="选择项目">
                    <Select
                      mode="multiple"
                      placeholder="选择允许访问的项目"
                      options={projects.map(p => ({ label: p.name, value: p.id }))}
                    />
                  </Form.Item>
                )
              }
              if (scopeType === 'tag') {
                return (
                  <Form.Item name="scope_ids" label="选择标签">
                    <Select
                      mode="multiple"
                      placeholder="选择允许访问的标签"
                      options={tags.filter(t => t.tag_table_name).map(t => ({ label: t.name, value: t.id }))}
                    />
                  </Form.Item>
                )
              }
              return null
            }}
          </Form.Item>
          <Form.Item name="rate_limit" label="请求限制（每小时）">
            <InputNumber min={1} max={100000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="expires_at" label="过期时间">
            <DatePicker style={{ width: '100%' }} placeholder="留空表示永不过期" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Key Detail Modal */}
      <Modal
        title={newApiKey ? "密钥创建成功" : "密钥详情"}
        open={keyDetailModalVisible}
        onCancel={() => { setKeyDetailModalVisible(false); setNewApiKey(null); setSelectedKey(null) }}
        footer={<Button onClick={() => { setKeyDetailModalVisible(false); setNewApiKey(null); setSelectedKey(null) }}>关闭</Button>}
        width={550}
      >
        {newApiKey ? (
          <div>
            <Alert
              message="请立即保存此密钥"
              description="密钥仅显示一次，关闭后将无法再次查看完整密钥。"
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 4, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text code style={{ fontSize: 14, wordBreak: 'break-all' }}>{newApiKey}</Text>
                <Button
                  type="link"
                  icon={<CopyOutlined />}
                  onClick={() => copyToClipboard(newApiKey)}
                >
                  复制
                </Button>
              </div>
            </div>
          </div>
        ) : selectedKey ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">名称：</Text>
              <Text strong>{selectedKey.name}</Text>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">密钥前缀：</Text>
              <Text code>{selectedKey.key_prefix}</Text>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">权限范围：</Text>
              <Tag>{selectedKey.scope_type === 'all' ? '全部' : selectedKey.scope_type === 'project' ? '项目' : '标签'}</Tag>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">请求限制：</Text>
              <Text>{selectedKey.rate_limit} 次/小时</Text>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">过期时间：</Text>
              <Text>{selectedKey.expires_at ? dayjs(selectedKey.expires_at).format('YYYY-MM-DD') : '永久'}</Text>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary">调用次数：</Text>
              <Text>{selectedKey.total_requests}</Text>
            </div>
            <div>
              <Text type="secondary">创建时间：</Text>
              <Text>{dayjs(selectedKey.created_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
            </div>
          </div>
        ) : null}
      </Modal>
    </Layout>
  )
}
