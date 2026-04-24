import { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Tag,
  message,
  Popconfirm,
  Typography,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PauseOutlined,
  CloudUploadOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { scheduleApi, datasourceApi } from '../services/api'

const { Title, Text } = Typography
const { TextArea } = Input

export default function Scheduler() {
  const [schedules, setSchedules] = useState<any[]>([])
  const [datasources, setDatasources] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [codeVisible, setCodeVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [dagCode, setDagCode] = useState('')
  const [form] = Form.useForm()

  useEffect(() => {
    loadSchedules()
    loadDatasources()
  }, [])

  const loadSchedules = async () => {
    setLoading(true)
    try {
      const res = await scheduleApi.list()
      setSchedules(res.data)
    } catch (error) {
      message.error('加载调度列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadDatasources = async () => {
    try {
      const res = await datasourceApi.listAll()
      setDatasources(res.data)
    } catch (error) {
      console.error('Failed to load datasources')
    }
  }

  const handleCreate = () => {
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({
      cron_expression: '0 0 * * *',
      alert_on_failure: true,
    })
    setModalVisible(true)
  }

  const handleEdit = (record: any) => {
    setEditingId(record.id)
    form.setFieldsValue(record)
    setModalVisible(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await scheduleApi.delete(id)
      message.success('删除成功')
      loadSchedules()
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (editingId) {
        await scheduleApi.update(editingId, values)
        message.success('更新成功')
      } else {
        await scheduleApi.create(values)
        message.success('创建成功')
      }

      setModalVisible(false)
      loadSchedules()
    } catch (error: any) {
      if (error.errorFields) return
      message.error('操作失败')
    }
  }

  const handleGenerateDag = async (id: number) => {
    try {
      const res = await scheduleApi.generateDag(id)
      setDagCode(res.data.dag_code)
      setCodeVisible(true)
      message.success('DAG代码生成成功')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '生成失败')
    }
  }

  const handleDeploy = async (id: number) => {
    try {
      await scheduleApi.deploy(id)
      message.success('部署成功')
      loadSchedules()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '部署失败')
    }
  }

  const handlePause = async (id: number) => {
    try {
      await scheduleApi.pause(id)
      message.success('已暂停')
      loadSchedules()
    } catch (error) {
      message.error('操作失败')
    }
  }

  const handleResume = async (id: number) => {
    try {
      await scheduleApi.resume(id)
      message.success('已恢复')
      loadSchedules()
    } catch (error) {
      message.error('操作失败')
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'DAG ID', dataIndex: 'dag_id', key: 'dag_id' },
    {
      title: 'Cron',
      dataIndex: 'cron_expression',
      key: 'cron',
      render: (cron: string) => <Text code>{cron}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colors: any = {
          draft: 'default',
          active: 'green',
          paused: 'orange',
          failed: 'red',
        }
        const labels: any = {
          draft: '草稿',
          active: '运行中',
          paused: '已暂停',
          failed: '失败',
        }
        return <Tag color={colors[status]}>{labels[status] || status}</Tag>
      },
    },
    {
      title: '已部署',
      dataIndex: 'is_deployed',
      key: 'deployed',
      render: (deployed: boolean) => (
        <Tag color={deployed ? 'blue' : 'default'}>
          {deployed ? '是' : '否'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Tooltip title="生成DAG代码">
            <Button
              type="link"
              icon={<CodeOutlined />}
              onClick={() => handleGenerateDag(record.id)}
            />
          </Tooltip>
          <Tooltip title="部署到Airflow">
            <Button
              type="link"
              icon={<CloudUploadOutlined />}
              onClick={() => handleDeploy(record.id)}
              disabled={!record.dag_code}
            />
          </Tooltip>
          {record.status === 'active' ? (
            <Tooltip title="暂停">
              <Button
                type="link"
                icon={<PauseOutlined />}
                onClick={() => handlePause(record.id)}
              />
            </Tooltip>
          ) : record.is_deployed ? (
            <Tooltip title="恢复">
              <Button
                type="link"
                icon={<PlayCircleOutlined />}
                onClick={() => handleResume(record.id)}
              />
            </Tooltip>
          ) : null}
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="确定删除该调度?"
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
        <Title level={4}>调度管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建调度
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={schedules}
          rowKey="id"
          loading={loading}
        />
      </Card>

      <Modal
        title={editingId ? '编辑调度' : '新建调度'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="调度名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea placeholder="调度描述" rows={2} />
          </Form.Item>
          <Form.Item
            name="cron_expression"
            label="Cron表达式"
            rules={[{ required: true }]}
            extra="例如: 0 0 * * * (每天0点)"
          >
            <Input placeholder="0 0 * * *" />
          </Form.Item>
          <Form.Item name="datasource_id" label="数据源">
            <Select
              placeholder="选择数据源"
              allowClear
              options={datasources.map((ds) => ({
                value: ds.id,
                label: `${ds.name} (${ds.type})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="sql_content" label="SQL">
            <TextArea placeholder="要执行的SQL语句" rows={6} />
          </Form.Item>
          <Form.Item name="alert_email" label="告警邮箱">
            <Input placeholder="告警通知邮箱" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="DAG 代码"
        open={codeVisible}
        onCancel={() => setCodeVisible(false)}
        width={900}
        footer={null}
      >
        <Editor
          height={500}
          language="python"
          value={dagCode}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
          }}
        />
      </Modal>
    </div>
  )
}
