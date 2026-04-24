import { useEffect, useState, useCallback } from 'react'
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Space,
  Tag,
  message,
  Popconfirm,
  Typography,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { datasourceApi } from '../services/api'

const { Title } = Typography
const { Search } = Input

const typeOptions = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'hive', label: 'Hive' },
  { value: 'sqlserver', label: 'SQL Server' },
]

export default function DataSources() {
  const [datasources, setDatasources] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [testPassed, setTestPassed] = useState(false)

  // 分页和搜索状态
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [keyword, setKeyword] = useState('')

  const loadDatasources = useCallback(async (page = 1, pageSize = 20, search = '') => {
    setLoading(true)
    try {
      const res = await datasourceApi.list({
        page,
        page_size: pageSize,
        keyword: search || undefined,
      })
      setDatasources(res.data.items)
      setPagination({
        current: res.data.page,
        pageSize: res.data.page_size,
        total: res.data.total,
      })
    } catch (error) {
      message.error('加载数据源失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDatasources()
  }, [loadDatasources])

  const handleTableChange = (pag: any) => {
    loadDatasources(pag.current, pag.pageSize, keyword)
  }

  const handleSearch = (value: string) => {
    setKeyword(value)
    loadDatasources(1, pagination.pageSize, value)
  }

  const handleRefresh = () => {
    loadDatasources(pagination.current, pagination.pageSize, keyword)
  }

  const handleCreate = () => {
    setEditingId(null)
    setTestPassed(false)
    form.resetFields()
    form.setFieldsValue({ port: 3306, pool_size: 5, max_overflow: 10 })
    setModalVisible(true)
  }

  const handleEdit = (record: any) => {
    setEditingId(record.id)
    setTestPassed(false)
    form.setFieldsValue({
      ...record,
      password: '', // Don't show existing password
    })
    setModalVisible(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await datasourceApi.delete(id)
      message.success('删除成功')
      loadDatasources()
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const values = await form.validateFields()
      const result = await datasourceApi.test(values)

      if (result.data.success) {
        message.success('连接成功，可以保存')
        setTestPassed(true)
      } else {
        message.error(`连接失败: ${result.data.message}`)
        setTestPassed(false)
      }
    } catch (error: any) {
      if (error.errorFields) {
        message.error('请填写完整的连接信息')
        return
      }
      message.error(`测试失败: ${error.response?.data?.detail || error.message}`)
      setTestPassed(false)
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (editingId) {
        await datasourceApi.update(editingId, values)
        message.success('更新成功')
      } else {
        await datasourceApi.create(values)
        message.success('创建成功')
      }

      setModalVisible(false)
      setTestPassed(false)
      loadDatasources()
    } catch (error: any) {
      if (error.errorFields) return
      message.error('操作失败')
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag color="blue">{type.toUpperCase()}</Tag>,
    },
    { title: '主机', dataIndex: 'host', key: 'host' },
    { title: '端口', dataIndex: 'port', key: 'port' },
    { title: '数据库', dataIndex: 'database', key: 'database' },
    {
      title: '状态',
      dataIndex: 'connection_status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'connected' ? 'green' : status === 'failed' ? 'red' : 'default'}>
          {status === 'connected' ? '已连接' : status === 'failed' ? '失败' : '未知'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: any) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该数据源?"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>数据源管理</Title>
        <Space>
          <Search
            placeholder="搜索名称/主机/数据库"
            allowClear
            onSearch={handleSearch}
            style={{ width: 250 }}
          />
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建数据源
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={datasources}
          rowKey="id"
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
          onChange={handleTableChange}
        />
      </Card>

      <Modal
        title={editingId ? '编辑数据源' : '新建数据源'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => { setModalVisible(false); setTestPassed(false) }}
        width={600}
        footer={[
          <Button key="test" onClick={() => handleTest()} loading={testing}>
            测试连接
          </Button>,
          <Button key="cancel" onClick={() => { setModalVisible(false); setTestPassed(false) }} disabled={testing}>
            取消
          </Button>,
          <Button key="submit" type="primary" onClick={handleSubmit} disabled={!testPassed || testing}>
            确定
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical" onValuesChange={() => setTestPassed(false)}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="数据源名称" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={typeOptions} placeholder="选择数据库类型" />
          </Form.Item>
          <Form.Item name="host" label="主机" rules={[{ required: true }]}>
            <Input placeholder="localhost" />
          </Form.Item>
          <Form.Item name="port" label="端口" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} placeholder="3306" />
          </Form.Item>
          <Form.Item name="database" label="数据库" rules={[{ required: true }]}>
            <Input placeholder="数据库名" />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input placeholder="用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: !editingId }]}
          >
            <Input.Password placeholder={editingId ? '留空则不修改' : '密码'} />
          </Form.Item>
          <Form.Item name="schema_name" label="Schema">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
