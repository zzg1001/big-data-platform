import { useState } from 'react'
import {
  Card,
  Button,
  Table,
  Space,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Tag,
  Tooltip,
  Typography,
  Badge,
  Timeline,
  Collapse,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  HistoryOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { useFieldTemplateStore, FieldValueTemplate, TemplateVersion, DatabaseType, DATABASE_LABELS } from '../stores/fieldTemplateStore'

const { Text } = Typography

const DB_TYPES: DatabaseType[] = ['mysql', 'postgresql', 'oracle', 'sqlserver', 'hive']

export default function FieldTemplates() {
  const { templates, addTemplate, updateTemplate, deleteTemplate, getHistory } = useFieldTemplateStore()
  const [modalVisible, setModalVisible] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<FieldValueTemplate | null>(null)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [historyData, setHistoryData] = useState<{ template: FieldValueTemplate; versions: TemplateVersion[] } | null>(null)
  const [form] = Form.useForm()

  const handleAdd = () => {
    setEditingTemplate(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (template: FieldValueTemplate) => {
    setEditingTemplate(template)
    form.setFieldsValue({
      label: template.label,
      expression: template.expression,
      description: template.description,
      dbOverrides: template.dbOverrides || {},
    })
    setModalVisible(true)
  }

  const handleDelete = (id: string, label: string) => {
    const success = deleteTemplate(id)
    if (success) {
      message.success('模板已删除')
    } else {
      message.error(`模板 "${label}" 正在被使用，无法删除`)
    }
  }

  const handleCopy = (template: FieldValueTemplate) => {
    navigator.clipboard.writeText(template.expression)
    message.success('表达式已复制到剪贴板')
  }

  const handleShowHistory = (template: FieldValueTemplate) => {
    const versions = getHistory(template.id)
    setHistoryData({ template, versions })
    setHistoryVisible(true)
  }

  const handleRestoreVersion = (version: TemplateVersion) => {
    if (historyData) {
      form.setFieldsValue({
        label: historyData.template.label,
        expression: version.expression,
        description: version.description || '',
        dbOverrides: version.dbOverrides || {},
      })
      setEditingTemplate(historyData.template)
      setHistoryVisible(false)
      setModalVisible(true)
      message.info('已恢复历史版本，点击保存确认')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      // 检查标签名是否重复
      const existingTemplate = templates.find(
        (t) => t.label === values.label && t.id !== editingTemplate?.id
      )
      if (existingTemplate) {
        message.error('标签名已存在')
        return
      }

      // 过滤掉空的 dbOverrides
      const filteredOverrides: Partial<Record<DatabaseType, string>> = {}
      if (values.dbOverrides) {
        for (const [key, value] of Object.entries(values.dbOverrides)) {
          if (value && (value as string).trim()) {
            filteredOverrides[key as DatabaseType] = (value as string).trim()
          }
        }
      }

      const submitData = {
        ...values,
        dbOverrides: Object.keys(filteredOverrides).length > 0 ? filteredOverrides : undefined,
      }

      if (editingTemplate) {
        updateTemplate(editingTemplate.id, submitData)
        message.success('模板已更新')
      } else {
        addTemplate(submitData)
        message.success('模板已添加')
      }

      setModalVisible(false)
      form.resetFields()
      setEditingTemplate(null)
    } catch {
      // Form validation failed
    }
  }

  const columns = [
    {
      title: '标签名',
      dataIndex: 'label',
      key: 'label',
      width: 150,
      render: (text: string, record: FieldValueTemplate) => (
        <Space size={4}>
          <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 13 }}>
            {text}
          </Tag>
          {record.usageCount && record.usageCount > 0 && (
            <Tooltip title={`被 ${record.usageCount} 处引用`}>
              <Badge count={record.usageCount} size="small" style={{ backgroundColor: '#52c41a' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '默认表达式',
      dataIndex: 'expression',
      key: 'expression',
      width: 200,
      render: (text: string) => (
        <code
          style={{
            background: '#f6ffed',
            padding: '4px 8px',
            borderRadius: 4,
            color: '#52c41a',
            fontSize: 12,
          }}
        >
          {text}
        </code>
      ),
    },
    {
      title: '数据库适配',
      key: 'dbOverrides',
      width: 200,
      render: (_: any, record: FieldValueTemplate) => {
        const overrides = record.dbOverrides
        if (!overrides || Object.keys(overrides).length === 0) {
          return <Text type="secondary" style={{ fontSize: 11 }}>通用</Text>
        }
        return (
          <Space size={2} wrap>
            {Object.entries(overrides).map(([db, expr]) => (
              <Tooltip key={db} title={expr}>
                <Tag style={{ margin: 0, fontSize: 10 }}>
                  {DATABASE_LABELS[db as DatabaseType]}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        )
      },
    },
    {
      title: '说明',
      dataIndex: 'description',
      key: 'description',
      width: 150,
      render: (text: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {text || '-'}
        </Text>
      ),
    },
    {
      title: '历史版本',
      key: 'history',
      width: 100,
      render: (_: any, record: FieldValueTemplate) => {
        const historyCount = record.history?.length || 0
        return historyCount > 0 ? (
          <Button
            type="link"
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => handleShowHistory(record)}
            style={{ padding: 0 }}
          >
            {historyCount} 个版本
          </Button>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>无</Text>
        )
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      render: (text: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(text).toLocaleString()}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: any, record: FieldValueTemplate) => {
        const isInUse = record.usageCount && record.usageCount > 0
        return (
          <Space size={4}>
            <Tooltip title="复制表达式">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopy(record)}
              />
            </Tooltip>
            <Tooltip title="编辑">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              />
            </Tooltip>
            {isInUse ? (
              <Tooltip title={`正在被 ${record.usageCount} 处引用，无法删除`}>
                <Button
                  type="text"
                  size="small"
                  disabled
                  icon={<LockOutlined style={{ color: '#999' }} />}
                />
              </Tooltip>
            ) : (
              <Popconfirm
                title="确定删除此模板？"
                onConfirm={() => handleDelete(record.id, record.label)}
                okText="删除"
                cancelText="取消"
              >
                <Tooltip title="删除">
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <div style={{ padding: '0 4px' }}>
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          padding: '12px 16px',
          background: 'linear-gradient(to bottom, #fafafa, #f5f5f5)',
          borderRadius: 12,
          border: '1px solid #eee',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>字段值模板</span>
          <Tooltip title="定义字段值模板后，在字段映射中新增字段时可以选择模板作为值来源">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </div>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          style={{ borderRadius: 6 }}
        >
          新增模板
        </Button>
      </div>

      {/* 使用说明 */}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: '#fffbe6',
          borderRadius: 8,
          border: '1px solid #ffe58f',
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 8, color: '#ad8b00' }}>使用说明</div>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#8c6d00', fontSize: 13 }}>
          <li>在此定义字段值模板，如 <code>etl_time = CURRENT_TIMESTAMP</code></li>
          <li>在数据同步的字段映射中，新增字段时可选择模板作为值来源</li>
          <li>被引用的模板无法删除，修改时会保留历史版本</li>
          <li>常用表达式：<code>CURRENT_TIMESTAMP</code>、<code>CURRENT_DATE</code>、<code>'固定值'</code></li>
        </ul>
      </div>

      {/* 模板列表 */}
      <Card
        style={{
          borderRadius: 12,
          border: '1px solid #e8e8e8',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          columns={columns}
          dataSource={templates}
          rowKey="id"
          size="middle"
          pagination={false}
        />
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingTemplate ? '编辑模板' : '新增模板'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setEditingTemplate(null)
        }}
        onOk={handleSubmit}
        okText={editingTemplate ? '保存' : '添加'}
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="label"
            label="标签名"
            rules={[
              { required: true, message: '请输入标签名' },
              { pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/, message: '标签名只能包含字母、数字和下划线，且不能以数字开头' },
            ]}
          >
            <Input
              placeholder="如 etl_time"
              style={{ fontFamily: 'monospace' }}
              disabled={!!editingTemplate} // 编辑时不允许修改标签名
            />
          </Form.Item>
          <Form.Item
            name="expression"
            label="默认表达式（适用于 MySQL / PostgreSQL）"
            rules={[{ required: true, message: '请输入值表达式' }]}
          >
            <Input.TextArea
              placeholder="如 CURRENT_TIMESTAMP"
              style={{ fontFamily: 'monospace' }}
              rows={2}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input placeholder="简要描述此模板的用途" />
          </Form.Item>

          {/* 数据库特定表达式 */}
          <Collapse
            size="small"
            items={[{
              key: 'dbOverrides',
              label: (
                <span style={{ fontSize: 13 }}>
                  数据库特定表达式（可选）
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                    不同数据库语法不同时使用
                  </Text>
                </span>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {DB_TYPES.map((dbType) => (
                    <div key={dbType} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag style={{ width: 90, textAlign: 'center', margin: 0 }}>
                        {DATABASE_LABELS[dbType]}
                      </Tag>
                      <Form.Item
                        name={['dbOverrides', dbType]}
                        style={{ flex: 1, marginBottom: 0 }}
                      >
                        <Input
                          placeholder={`留空则使用默认表达式`}
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                          size="small"
                        />
                      </Form.Item>
                    </div>
                  ))}
                </div>
              ),
            }]}
            style={{ marginBottom: 16 }}
          />
        </Form>
        {editingTemplate && (
          <div style={{ padding: '8px 12px', background: '#f0f5ff', borderRadius: 6, fontSize: 12, color: '#1890ff' }}>
            修改后将自动保存历史版本，可随时恢复
          </div>
        )}
      </Modal>

      {/* 历史版本弹窗 */}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>历史版本 - {historyData?.template.label}</span>
          </Space>
        }
        open={historyVisible}
        onCancel={() => {
          setHistoryVisible(false)
          setHistoryData(null)
        }}
        footer={null}
        width={600}
      >
        {historyData && (
          <div>
            {/* 当前版本 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>当前版本</div>
              <div style={{
                padding: '12px 16px',
                background: '#f6ffed',
                borderRadius: 8,
                border: '1px solid #b7eb8f',
              }}>
                <code style={{ fontSize: 14, color: '#52c41a' }}>
                  {historyData.template.expression}
                </code>
                {historyData.template.dbOverrides && Object.keys(historyData.template.dbOverrides).length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Object.entries(historyData.template.dbOverrides).map(([db, expr]) => (
                      <Tooltip key={db} title={expr}>
                        <Tag style={{ fontSize: 10, margin: 0 }}>
                          {DATABASE_LABELS[db as DatabaseType]}
                        </Tag>
                      </Tooltip>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>
                  {historyData.template.description || '无说明'}
                </div>
              </div>
            </div>

            {/* 历史版本列表 */}
            <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
              历史版本 ({historyData.versions.length})
            </div>
            {historyData.versions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
                暂无历史版本
              </div>
            ) : (
              <Timeline
                items={[...historyData.versions].reverse().map((version, index) => ({
                  children: (
                    <div style={{
                      padding: '8px 12px',
                      background: '#fafafa',
                      borderRadius: 6,
                      marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <code style={{ fontSize: 13, color: '#666' }}>
                            {version.expression}
                          </code>
                          {version.dbOverrides && Object.keys(version.dbOverrides).length > 0 && (
                            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {Object.entries(version.dbOverrides).map(([db, expr]) => (
                                <Tooltip key={db} title={expr}>
                                  <Tag style={{ fontSize: 10, margin: 0 }}>
                                    {DATABASE_LABELS[db as DatabaseType]}
                                  </Tag>
                                </Tooltip>
                              ))}
                            </div>
                          )}
                          {version.description && (
                            <div style={{ marginTop: 2, fontSize: 11, color: '#999' }}>
                              {version.description}
                            </div>
                          )}
                          <div style={{ marginTop: 4, fontSize: 10, color: '#bbb' }}>
                            {new Date(version.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => handleRestoreVersion(version)}
                        >
                          恢复
                        </Button>
                      </div>
                    </div>
                  ),
                  color: index === 0 ? 'blue' : 'gray',
                }))}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
