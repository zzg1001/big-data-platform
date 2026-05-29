import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Tag,
  Popconfirm,
  Typography,
  Drawer,
  Timeline,
  Spin,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { etlApi, dwLayerApi, taskDependencyApi } from '../services/api'
import Editor from '@monaco-editor/react'
import DependencySelector from '../components/DependencySelector'

const { Text } = Typography
const { TextArea } = Input

interface EtlTask {
  id: number
  name: string
  description?: string
  sql_content: string
  sql_preview: string
  datasource_id?: number
  datasource_name?: string
  dw_layer_id?: number
  dw_layer_name?: string
  dw_layer_color?: string
  is_scheduled: boolean
  cron_expression?: string
  dag_id?: string
  airflow_status?: string
  status: string
  last_run_at?: string
  last_run_rows?: number
  created_at: string
}

interface DwLayer {
  id: number
  name: string
  display_name: string
  color?: string
  level: number
}

interface EtlLog {
  id: number
  etl_task_id: number
  status: string
  rows_affected: number
  execution_time_ms?: number
  error_message?: string
  started_at: string
  finished_at?: string
}

interface Dependency {
  id?: number
  upstream_task_type: string
  upstream_task_id: number
  upstream_task_name?: string
  upstream_table_name?: string
  upstream_layer_name?: string
  upstream_layer_color?: string
  dependency_type?: string
  source_table?: string
}

export default function EtlTasks() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState<EtlTask[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingTask, setEditingTask] = useState<EtlTask | null>(null)
  const [form] = Form.useForm()
  const [executing, setExecuting] = useState<number | null>(null)
  const [logsDrawerVisible, setLogsDrawerVisible] = useState(false)
  const [viewingTask, setViewingTask] = useState<EtlTask | null>(null)
  const [logs, setLogs] = useState<EtlLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [sqlModalVisible, setSqlModalVisible] = useState(false)
  const [viewingSqlTask, setViewingSqlTask] = useState<EtlTask | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [layers, setLayers] = useState<DwLayer[]>([])
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [currentSql, setCurrentSql] = useState('')

  useEffect(() => {
    loadTasks()
    loadLayers()
  }, [])

  // 从 URL 参数获取 id 并自动搜索
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      setSearchKeyword(`id:${id}`)
      // 清除 URL 参数
      setSearchParams({})
    }
  }, [searchParams])

  const loadTasks = async () => {
    setLoading(true)
    try {
      const res = await etlApi.list()
      setTasks(res.data)
    } catch (err: any) {
      message.error('Failed to load ETL tasks: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }

  const loadLayers = async () => {
    try {
      const res = await dwLayerApi.list()
      setLayers(res.data)
    } catch (err) {
      console.error('Failed to load layers:', err)
    }
  }

  const handleCreate = () => {
    setEditingTask(null)
    form.resetFields()
    setDependencies([])
    setCurrentSql('')
    setModalVisible(true)
  }

  // 提示用户先下线再操作
  const [warningVisible, setWarningVisible] = useState(false)
  const [warningTaskId, setWarningTaskId] = useState<number | null>(null)

  const showScheduledWarning = (task: EtlTask) => {
    setWarningTaskId(task.id)
    setWarningVisible(true)
  }

  const handleEdit = (task: EtlTask) => {
    // 检查任务是否已调度上线
    if (task.is_scheduled) {
      showScheduledWarning(task)
      return
    }
    // 跳转到数据探索页面编辑
    navigate(`/data-explorer?etl_id=${task.id}&etl_name=${encodeURIComponent(task.name)}`)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      let taskId: number

      if (editingTask) {
        await etlApi.update(editingTask.id, values)
        taskId = editingTask.id
        message.success('ETL task updated')
      } else {
        const res = await etlApi.create(values)
        taskId = res.data.id
        message.success('ETL task created')
      }

      // Save dependencies for the task
      if (dependencies.length > 0) {
        for (const dep of dependencies) {
          // Skip if already has an id (existing dependency)
          if (dep.id) continue
          try {
            await taskDependencyApi.create({
              task_type: 'etl',
              task_id: taskId,
              upstream_task_type: dep.upstream_task_type,
              upstream_task_id: dep.upstream_task_id,
              dependency_type: dep.dependency_type,
              source_table: dep.source_table,
            })
          } catch (err) {
            console.error('Failed to save dependency:', err)
          }
        }
      }

      setModalVisible(false)
      loadTasks()
    } catch (err: any) {
      if (err.errorFields) return
      message.error('Failed to save task: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDelete = async (task: EtlTask) => {
    // 检查任务是否已调度上线
    if (task.is_scheduled) {
      showScheduledWarning(task)
      return
    }
    try {
      await etlApi.delete(task.id)
      message.success('ETL task deleted')
      loadTasks()
    } catch (err: any) {
      message.error('Failed to delete task: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleExecute = async (task: EtlTask) => {
    setExecuting(task.id)
    try {
      const res = await etlApi.execute(task.id)
      if (res.data.status === 'success') {
        message.success(`执行成功，影响行数: ${res.data.rows_affected}`)
      } else {
        message.error('执行失败: ' + res.data.error_message)
      }
      loadTasks()
    } catch (err: any) {
      message.error('执行失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setExecuting(null)
    }
  }

  const handleViewSql = async (task: EtlTask) => {
    try {
      const res = await etlApi.get(task.id)
      setViewingSqlTask(res.data)
      setSqlModalVisible(true)
    } catch (err: any) {
      message.error('加载失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleViewLogs = async (task: EtlTask) => {
    setViewingTask(task)
    setLogsDrawerVisible(true)
    setLogsLoading(true)
    try {
      const res = await etlApi.getLogs(task.id, 20)
      setLogs(res.data)
    } catch (err: any) {
      message.error('Failed to load logs: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLogsLoading(false)
    }
  }

  const getStatusTag = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'default',
      active: 'success',
      disabled: 'warning',
    }
    const labels: Record<string, string> = {
      draft: '草稿',
      active: '已激活',
      disabled: '已禁用',
    }
    return <Tag color={colors[status] || 'default'}>{labels[status] || status}</Tag>
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name: string, record: EtlTask) => (
        <div>
          <Text strong>{name}</Text>
          {record.description && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {record.description}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'SQL',
      dataIndex: 'sql_preview',
      key: 'sql_preview',
      width: 100,
      render: (_: string, record: EtlTask) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={() => handleViewSql(record)}
        >
          查看SQL
        </Button>
      ),
    },
    {
      title: '数据源',
      dataIndex: 'datasource_name',
      key: 'datasource_name',
      width: 120,
      render: (name: string) => name || '平台数据库',
    },
    {
      title: '层级',
      dataIndex: 'dw_layer_name',
      key: 'dw_layer_name',
      width: 100,
      render: (_: string, record: EtlTask) =>
        record.dw_layer_name ? (
          <Tag color={record.dw_layer_color || 'default'}>{record.dw_layer_name}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (_: string, record: EtlTask) => (
        <Space size={4}>
          {getStatusTag(record.status)}
          {record.is_scheduled && <Tag color="blue">已调度</Tag>}
        </Space>
      ),
    },
    {
      title: '最近执行',
      key: 'last_run',
      width: 160,
      render: (_: any, record: EtlTask) =>
        record.last_run_at ? (
          <div>
            <Text style={{ fontSize: 12 }}>
              {new Date(record.last_run_at).toLocaleString()}
            </Text>
            {record.last_run_rows !== undefined && (
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  影响行数: {record.last_run_rows}
                </Text>
              </div>
            )}
          </div>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: any, record: EtlTask) => (
        <Space split={<span style={{ color: '#e8e8e8' }}>|</span>} size={4}>
          <a
            onClick={() => handleExecute(record)}
            style={{ color: '#1890ff', fontSize: 13 }}
          >
            {executing === record.id ? '执行中...' : '执行'}
          </a>
          <a
            onClick={() => handleEdit(record)}
            style={{ color: '#1890ff', fontSize: 13 }}
          >
            编辑
          </a>
          <a
            onClick={() => handleViewLogs(record)}
            style={{ color: '#1890ff', fontSize: 13 }}
          >
            日志
          </a>
          {record.is_scheduled ? (
            <a
              onClick={() => handleDelete(record)}
              style={{ color: '#ff4d4f', fontSize: 13 }}
            >
              删除
            </a>
          ) : (
            <Popconfirm
              title="确认删除?"
              onConfirm={() => handleDelete(record)}
              okText="删除"
              cancelText="取消"
            >
              <a style={{ color: '#ff4d4f', fontSize: 13 }}>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  // 根据搜索关键词过滤
  const filteredTasks = tasks.filter((t) => {
    if (!searchKeyword) return true
    const keyword = searchKeyword.toLowerCase()
    // 支持精准搜索 id:xxx 格式
    if (keyword.startsWith('id:')) {
      const id = keyword.replace('id:', '')
      return t.id.toString() === id
    }
    // 普通搜索：名称、描述、SQL预览
    return (
      t.name.toLowerCase().includes(keyword) ||
      (t.description || '').toLowerCase().includes(keyword) ||
      (t.sql_preview || '').toLowerCase().includes(keyword)
    )
  })

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建ETL任务
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>
            刷新
          </Button>
        </Space>
        <Input.Search
          placeholder="搜索任务名称"
          allowClear
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      <Table
        columns={columns}
        dataSource={filteredTasks}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1200 }}
      />

      {/* Create/Edit Modal */}
      <Modal
        title={editingTask ? '编辑ETL任务' : '新建ETL任务'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={800}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
          >
            <Input placeholder="输入任务名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="任务描述（可选）" />
          </Form.Item>
          <Form.Item name="dw_layer_id" label="平台数据库层级">
            <Select
              placeholder="选择平台数据库层级（可选）"
              allowClear
              options={layers.map((l) => ({
                value: l.id,
                label: (
                  <Space>
                    <Tag color={l.color || 'default'} style={{ marginRight: 0 }}>
                      {l.name}
                    </Tag>
                    <span>{l.display_name}</span>
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="sql_content"
            label="SQL脚本"
            rules={[{ required: true, message: '请输入SQL脚本' }]}
          >
            <div style={{ border: '1px solid #d9d9d9', borderRadius: 4 }}>
              <Editor
                height="200px"
                language="sql"
                theme="vs-dark"
                value={form.getFieldValue('sql_content') || ''}
                onChange={(value) => {
                  form.setFieldsValue({ sql_content: value })
                  setCurrentSql(value || '')
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </Form.Item>

          <Form.Item label="上游依赖">
            <DependencySelector
              taskType="etl"
              taskId={editingTask?.id}
              sqlContent={currentSql}
              value={dependencies}
              onChange={setDependencies}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Logs Drawer */}
      <Drawer
        title={`执行日志 - ${viewingTask?.name}`}
        open={logsDrawerVisible}
        onClose={() => setLogsDrawerVisible(false)}
        width={500}
      >
        {logsLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : logs.length === 0 ? (
          <Text type="secondary">暂无执行日志</Text>
        ) : (
          <Timeline>
            {logs.map((log) => (
              <Timeline.Item
                key={log.id}
                color={log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'blue'}
              >
                <div>
                  <Text strong>
                    {log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : '运行中'}
                  </Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    {new Date(log.started_at).toLocaleString()}
                  </Text>
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {log.execution_time_ms !== undefined && (
                    <span>耗时: {log.execution_time_ms}ms | </span>
                  )}
                  <span>影响行数: {log.rows_affected}</span>
                </div>
                {log.error_message && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {log.error_message}
                    </Text>
                  </div>
                )}
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Drawer>

      {/* SQL View Modal */}
      <Modal
        title={`SQL - ${viewingSqlTask?.name}`}
        open={sqlModalVisible}
        onCancel={() => setSqlModalVisible(false)}
        footer={null}
        width={700}
      >
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 4 }}>
          <Editor
            height="400px"
            language="sql"
            theme="vs-dark"
            value={viewingSqlTask?.sql_content || ''}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      </Modal>

      {/* Warning Modal */}
      <Modal
        open={warningVisible}
        onCancel={() => setWarningVisible(false)}
        closable={true}
        footer={null}
        width={280}
        centered
        styles={{ body: { textAlign: 'center', padding: '20px 24px' } }}
      >
        <ExclamationCircleOutlined style={{ fontSize: 32, color: '#faad14', marginBottom: 12 }} />
        <div style={{ fontSize: 14, marginBottom: 16 }}>请先下线该任务</div>
        <Button
          type="primary"
          onClick={() => {
            setWarningVisible(false)
            navigate(`/scheduler?etl_id=${warningTaskId}`)
          }}
        >
          调度管理
        </Button>
      </Modal>
    </div>
  )
}
