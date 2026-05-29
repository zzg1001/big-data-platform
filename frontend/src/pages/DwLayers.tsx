import { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Tag,
  Popconfirm,
  Typography,
  ColorPicker,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { dwLayerApi } from '../services/api'

const { Title, Text } = Typography

interface DwLayer {
  id: number
  name: string
  display_name: string
  description?: string
  level: number
  color?: string
  sync_task_count: number
  etl_task_count: number
}

export default function DwLayers() {
  const [layers, setLayers] = useState<DwLayer[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingLayer, setEditingLayer] = useState<DwLayer | null>(null)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadLayers()
  }, [])

  const loadLayers = async () => {
    setLoading(true)
    try {
      const res = await dwLayerApi.list()
      setLayers(res.data)
    } catch (err: any) {
      message.error('加载层级失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingLayer(null)
    form.resetFields()
    form.setFieldsValue({ level: layers.length + 1, color: '#1890ff' })
    setModalVisible(true)
  }

  const handleEdit = (layer: DwLayer) => {
    setEditingLayer(layer)
    form.setFieldsValue({
      name: layer.name,
      display_name: layer.display_name,
      description: layer.description,
      level: layer.level,
      color: layer.color || '#1890ff',
    })
    setModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      // Handle color value
      const color = typeof values.color === 'string' ? values.color : values.color?.toHexString?.() || '#1890ff'
      const data = { ...values, color }

      setSubmitting(true)
      if (editingLayer) {
        await dwLayerApi.update(editingLayer.id, data)
        message.success('层级已更新')
      } else {
        await dwLayerApi.create(data)
        message.success('层级已创建')
      }
      setModalVisible(false)
      loadLayers()
    } catch (err: any) {
      if (err.errorFields) return
      message.error('保存失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (layer: DwLayer) => {
    try {
      await dwLayerApi.delete(layer.id)
      message.success('层级已删除')
      loadLayers()
    } catch (err: any) {
      message.error('删除失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleInitDefaults = async () => {
    try {
      const res = await dwLayerApi.initDefaults()
      if (res.data.created.length > 0) {
        message.success(`已创建: ${res.data.created.join(', ')}`)
      }
      if (res.data.skipped.length > 0) {
        message.info(`已存在: ${res.data.skipped.join(', ')}`)
      }
      loadLayers()
    } catch (err: any) {
      message.error('初始化失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  const columns = [
    {
      title: '层级',
      dataIndex: 'level',
      key: 'level',
      width: 80,
      render: (level: number) => <Text strong>{level}</Text>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 100,
      render: (name: string, record: DwLayer) => (
        <Tag color={record.color || 'default'} style={{ fontSize: 13, padding: '2px 8px' }}>
          {name}
        </Tag>
      ),
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      key: 'display_name',
      width: 150,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '同步任务',
      dataIndex: 'sync_task_count',
      key: 'sync_task_count',
      width: 100,
      render: (count: number) => count > 0 ? <Tag color="blue">{count}</Tag> : '-',
    },
    {
      title: 'ETL任务',
      dataIndex: 'etl_task_count',
      key: 'etl_task_count',
      width: 100,
      render: (count: number) => count > 0 ? <Tag color="purple">{count}</Tag> : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: DwLayer) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确认删除?"
            description={
              record.sync_task_count + record.etl_task_count > 0
                ? `该层级有 ${record.sync_task_count + record.etl_task_count} 个关联任务，请先重新分配`
                : undefined
            }
            onConfirm={() => handleDelete(record)}
            okText="删除"
            cancelText="取消"
            disabled={record.sync_task_count + record.etl_task_count > 0}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.sync_task_count + record.etl_task_count > 0}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          <AppstoreOutlined style={{ marginRight: 8 }} />
          平台数据库层级管理
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadLayers}>
            刷新
          </Button>
          <Button onClick={handleInitDefaults}>
            初始化默认层级
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建层级
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={layers}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="middle"
      />

      <Modal
        title={editingLayer ? '编辑层级' : '新建层级'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={500}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="层级名称"
            rules={[
              { required: true, message: '请输入层级名称' },
              { max: 50, message: '最多50个字符' },
              { pattern: /^[A-Z_]+$/, message: '只允许大写字母和下划线' },
            ]}
          >
            <Input placeholder="如: ODS, DW, DWS, ADS" />
          </Form.Item>
          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[
              { required: true, message: '请输入显示名称' },
              { max: 100, message: '最多100个字符' },
            ]}
          >
            <Input placeholder="如: 原始数据层, 平台数据层" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
            rules={[{ max: 500, message: '最多500个字符' }]}
          >
            <Input.TextArea rows={2} placeholder="层级描述（可选）" />
          </Form.Item>
          <Space size={16}>
            <Form.Item
              name="level"
              label="排序级别"
              rules={[{ required: true, message: '请输入排序级别' }]}
            >
              <InputNumber min={1} max={99} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item
              name="color"
              label="颜色"
            >
              <ColorPicker />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
