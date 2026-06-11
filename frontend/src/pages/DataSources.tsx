import { useEffect, useState, useCallback } from 'react'
import {
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Space,
  Tag,
  message,
  Popconfirm,
  Typography,
  Table,
  Tabs,
} from 'antd'
import {
  PlusOutlined,
  LeftOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import { datasourceApi } from '../services/api'

const { Title, Text } = Typography

// 数据库类型配置
const dbTypes = [
  {
    key: 'mysql',
    name: 'MySQL',
    icon: '🐬',
    enabled: true,
    description: '关系型数据库',
  },
  {
    key: 'postgresql',
    name: 'PostgreSQL',
    icon: '🐘',
    enabled: false,
    description: '关系型数据库',
  },
  {
    key: 'hive',
    name: 'Hive',
    icon: '🐝',
    enabled: false,
    description: '数据仓库',
  },
  {
    key: 'oracle',
    name: 'Oracle',
    icon: '🔴',
    enabled: false,
    description: '企业级数据库',
  },
]

export default function DataSources() {
  const [datasources, setDatasources] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)  // 密码是否被修改

  // 当前选中的数据库类型（null 表示在类型选择页）
  const [selectedDbType, setSelectedDbType] = useState<string | null>(null)

  // Tab 状态
  const [activeTab, setActiveTab] = useState<'all' | 'added'>('all')

  const loadDatasources = useCallback(async () => {
    setLoading(true)
    try {
      const res = await datasourceApi.listAll()
      setDatasources(res.data || [])
    } catch (error) {
      message.error('加载数据源失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDatasources()
  }, [loadDatasources])

  // 获取各类型的数据源数量（不区分大小写）
  const getCountByType = (type: string) => {
    return datasources.filter((ds) => ds.type?.toLowerCase() === type.toLowerCase()).length
  }

  // 获取当前类型的数据源列表（不区分大小写）
  const getCurrentTypeDatasources = () => {
    if (!selectedDbType) return []
    return datasources.filter((ds) => ds.type?.toLowerCase() === selectedDbType.toLowerCase())
  }

  const handleCreate = () => {
    setEditingId(null)
    setPasswordChanged(false)
    form.resetFields()
    form.setFieldsValue({ port: 3306 })
    setModalVisible(true)
  }

  const handleEdit = (record: any) => {
    setEditingId(record.id)
    setPasswordChanged(false)
    form.setFieldsValue({
      name: record.name,
      host: record.host,
      port: record.port,
      database: record.database,
      username: record.username,
      password: '••••••••',  // 显示掩码
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

  const handleSetDefault = async (id: number) => {
    try {
      await datasourceApi.setDefault(id)
      message.success('已设为默认数据源')
      loadDatasources()
    } catch (error) {
      message.error('设置失败')
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      // 编辑模式且密码未修改时，使用已保存的密码测试
      if (editingId && !passwordChanged) {
        const result = await datasourceApi.testSaved(editingId)
        if (result.data.success) {
          message.success('连接测试成功')
        } else {
          message.error(`连接失败: ${result.data.message}`)
        }
      } else {
        // 新建或密码已修改时，使用表单中的密码测试
        const values = await form.validateFields()
        const result = await datasourceApi.test({
          ...values,
          type: selectedDbType,
        })

        if (result.data.success) {
          message.success('连接测试成功')
        } else {
          message.error(`连接失败: ${result.data.message}`)
        }
      }
    } catch (error: any) {
      if (error.errorFields) {
        message.error('请填写完整的连接信息')
        return
      }
      message.error(`测试失败: ${error.response?.data?.detail || error.message}`)
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const values = await form.validateFields()
      const data: any = {
        ...values,
        type: selectedDbType,
      }

      // 编辑模式下，如果密码未修改则不提交密码字段
      if (editingId && !passwordChanged) {
        delete data.password
      }

      if (editingId) {
        await datasourceApi.update(editingId, data)
        message.success('更新成功')
      } else {
        await datasourceApi.create(data)
        message.success('创建成功')
      }

      setModalVisible(false)
      loadDatasources()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '操作失败')
    } finally {
      setSaving(false)
    }
  }

  // 数据源类型选择页面
  const renderTypeSelection = () => {
    const addedCount = datasources.length
    const allCount = dbTypes.length

    return (
      <div style={{ padding: '0 24px' }}>
        <Title level={4} style={{ marginBottom: 24 }}>数据源管理</Title>

        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'all' | 'added')}
          items={[
            { key: 'all', label: <span>全部数据源 <Tag color="green">{allCount}</Tag></span> },
            { key: 'added', label: <span>已添加数据源 <Tag>{addedCount}</Tag></span> },
          ]}
        />

        {activeTab === 'all' ? (
          <>
            <div style={{ marginTop: 24, marginBottom: 16 }}>
              <Text type="secondary">数据库 ({dbTypes.length})</Text>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {dbTypes.map((db) => {
                const count = getCountByType(db.key)
                return (
                  <div
                    key={db.key}
                    onClick={() => db.enabled && setSelectedDbType(db.key)}
                    style={{
                      width: 280,
                      padding: '20px 24px',
                      background: '#fff',
                      borderRadius: 8,
                      border: '1px solid #e8e8e8',
                      cursor: db.enabled ? 'pointer' : 'not-allowed',
                      opacity: db.enabled ? 1 : 0.5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (db.enabled) {
                        e.currentTarget.style.borderColor = '#1890ff'
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(24,144,255,0.15)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e8e8e8'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <div style={{
                      width: 48,
                      height: 48,
                      background: '#f5f5f5',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 24,
                    }}>
                      {db.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 500, color: '#1d1d1f' }}>
                        {db.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#86868b' }}>
                        {db.description}
                      </div>
                    </div>
                    {db.enabled ? (
                      count > 0 && (
                        <Tag color="green" style={{ margin: 0 }}>{count} 个连接</Tag>
                      )
                    ) : (
                      <Tag style={{ margin: 0 }}>即将上线</Tag>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          // 已添加数据源列表
          <div style={{ marginTop: 24 }}>
            {datasources.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#86868b' }}>
                暂无已添加的数据源
              </div>
            ) : (
              <Table
                dataSource={datasources}
                rowKey="id"
                loading={loading}
                columns={[
                  {
                    title: '连接名称',
                    dataIndex: 'name',
                    key: 'name',
                    render: (name: string, record: any) => (
                      <Space>
                        <span style={{ fontSize: 18 }}>
                          {dbTypes.find(d => d.key === record.type?.toLowerCase())?.icon || '📦'}
                        </span>
                        <span style={{ fontWeight: 500 }}>{name}</span>
                      </Space>
                    ),
                  },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    key: 'type',
                    render: (type: string) => (
                      <Tag color="blue">{type?.toUpperCase()}</Tag>
                    ),
                  },
                  {
                    title: '服务器地址',
                    key: 'address',
                    render: (_: any, record: any) => (
                      <span>{record.host}:{record.port}</span>
                    ),
                  },
                  {
                    title: '数据库',
                    dataIndex: 'database',
                    key: 'database',
                  },
                  {
                    title: '创建时间',
                    dataIndex: 'created_at',
                    key: 'created_at',
                    render: (date: string) => date ? new Date(date).toLocaleString() : '-',
                  },
                  {
                    title: '操作',
                    key: 'actions',
                    width: 120,
                    render: (_: any, record: any) => (
                      <Space>
                        <a onClick={() => {
                          setSelectedDbType(record.type?.toLowerCase())
                          setTimeout(() => handleEdit(record), 100)
                        }}>编辑</a>
                        <Popconfirm
                          title="确定删除该数据源?"
                          onConfirm={() => handleDelete(record.id)}
                        >
                          <a style={{ color: '#ff4d4f' }}>删除</a>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
                pagination={{ pageSize: 10 }}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  // MySQL 数据源管理页面
  const renderMySQLManagement = () => {
    const currentDatasources = getCurrentTypeDatasources()
    const dbInfo = dbTypes.find(d => d.key === selectedDbType)

    return (
      <div style={{ display: 'flex', height: '100%' }}>
        {/* 左侧信息栏 */}
        <div style={{
          width: 240,
          background: '#fafafa',
          borderRight: '1px solid #e8e8e8',
          padding: '20px',
        }}>
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={() => setSelectedDbType(null)}
            style={{ marginBottom: 20, padding: '4px 0' }}
          >
            返回
          </Button>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 24,
          }}>
            <div style={{
              width: 64,
              height: 64,
              background: '#fff',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              marginBottom: 12,
              border: '1px solid #e8e8e8',
            }}>
              {dbInfo?.icon}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{dbInfo?.name}</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: '#1d1d1f',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <DatabaseOutlined /> 需要的信息
            </div>
            <div style={{ fontSize: 12, color: '#666', lineHeight: 2 }}>
              <div>• 服务器地址</div>
              <div>• 端口号</div>
              <div>• 数据库名（可选）</div>
              <div>• 用户名</div>
              <div>• 密码</div>
            </div>
          </div>
        </div>

        {/* 右侧列表区 */}
        <div style={{ flex: 1, padding: '20px 24px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>
              连接信息列表
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreate}
            >
              添加连接
            </Button>
          </div>

          <Table
            dataSource={currentDatasources}
            rowKey="id"
            loading={loading}
            columns={[
              {
                title: '连接名称',
                dataIndex: 'name',
                key: 'name',
                sorter: (a, b) => a.name.localeCompare(b.name),
              },
              {
                title: '服务器地址',
                key: 'address',
                render: (_: any, record: any) => (
                  <span>{record.host}</span>
                ),
              },
              {
                title: '数据库',
                dataIndex: 'database',
                key: 'database',
                render: (db: string) => db || '-',
              },
              {
                title: '创建时间',
                dataIndex: 'created_at',
                key: 'created_at',
                sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                render: (date: string) => date ? new Date(date).toLocaleString() : '-',
              },
              {
                title: '默认',
                key: 'is_default',
                width: 70,
                render: (_: any, record: any) => (
                  <Tag
                    color={record.is_default ? 'blue' : 'default'}
                    style={{
                      cursor: 'pointer',
                      opacity: record.is_default ? 1 : 0.5,
                    }}
                    onClick={() => !record.is_default && handleSetDefault(record.id)}
                  >
                    默认
                  </Tag>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 100,
                render: (_: any, record: any) => (
                  <Space>
                    <a onClick={() => handleEdit(record)}>编辑</a>
                    <Popconfirm
                      title="确定删除该连接?"
                      onConfirm={() => handleDelete(record.id)}
                    >
                      <a style={{ color: '#ff4d4f' }}>删除</a>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            pagination={{
              pageSize: 10,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', background: '#fff' }}>
      {selectedDbType ? renderMySQLManagement() : renderTypeSelection()}

      {/* 添加/编辑弹窗 */}
      <Modal
        title={`${editingId ? '编辑' : '添加'} MySQL 数据源连接`}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={480}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setModalVisible(false)}>
              取消
            </Button>
            <Button onClick={handleTest} loading={testing}>
              测试连接
            </Button>
            <Button type="primary" onClick={handleSubmit} loading={saving}>
              保存
            </Button>
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="name"
            label="数据源连接名称"
            rules={[{ required: true, message: '请输入连接名称' }]}
          >
            <Input placeholder="请输入连接名称" />
          </Form.Item>

          <Form.Item
            name="host"
            label="服务器"
            rules={[{ required: true, message: '请输入服务器地址' }]}
          >
            <Input placeholder="如 127.0.0.1 或 db.example.com" />
          </Form.Item>

          <Form.Item
            name="port"
            label="端口号"
            rules={[{ required: true, message: '请输入端口号' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="3306"
              min={1}
              max={65535}
            />
          </Form.Item>

          <Form.Item
            name="database"
            label="数据库名"
          >
            <Input placeholder="可选，留空则连接后选择" />
          </Form.Item>

          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: !editingId, message: '请输入密码' }]}
          >
            <Input.Password
              placeholder={editingId ? '留空则不修改' : '请输入密码'}
              onChange={() => {
                if (editingId && !passwordChanged) {
                  setPasswordChanged(true)
                  form.setFieldValue('password', '')  // 清空掩码，让用户输入新密码
                }
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
