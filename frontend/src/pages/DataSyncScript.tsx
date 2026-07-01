import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Typography, Table, Tag, Space, Modal, Form, Input, Upload, message, Tooltip, Alert, Select,
} from 'antd'
import {
  ArrowLeftOutlined, UploadOutlined, PlayCircleOutlined, CloudUploadOutlined,
  DeleteOutlined, ReloadOutlined, ScheduleOutlined, FileTextOutlined, AppstoreOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { scriptSyncApi, pyEnvApi } from '../services/api'
import CronExpressionInput from '../components/CronExpressionInput'
import PyEnvManager from '../components/PyEnvManager'

const noCancel = { style: { display: 'none' } }  // 隐藏弹窗取消按钮

const { Title, Text } = Typography

interface ScriptTask {
  id: number
  name: string
  description?: string
  original_filename?: string
  entrypoint: string
  has_requirements: boolean
  cron_expression?: string
  is_scheduled: boolean
  dag_id?: string
  status: string
  last_run_at?: string
  last_run_status?: string
  last_error?: string
  env_id?: number | null
}

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '未上线' },
  active: { color: 'green', text: '已上线' },
  paused: { color: 'orange', text: '已下线' },
  failed: { color: 'red', text: '失败' },
}

export default function DataSyncScript() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<ScriptTask[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [form] = Form.useForm()
  // 运行环境
  const [pyEnvOpen, setPyEnvOpen] = useState(false)
  const [envs, setEnvs] = useState<{ id: number; name: string }[]>([])
  // 调度（上线）弹窗：cron 在列表里配置，风格同数据库同步（支持批量）
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleTasks, setScheduleTasks] = useState<ScriptTask[]>([])
  const [scheduleCron, setScheduleCron] = useState('0 2 * * *')
  const [scheduling, setScheduling] = useState(false)
  // 批量选择
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)

  const loadTasks = async () => {
    setLoading(true)
    try {
      const res = await scriptSyncApi.list()
      setTasks(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const loadEnvs = async () => {
    try {
      const res = await pyEnvApi.list()
      setEnvs((res.data || []).map((e: any) => ({ id: e.id, name: e.name })))
    } catch { /* ignore */ }
  }

  useEffect(() => { loadTasks(); loadEnvs() }, [])

  const handleUpload = async () => {
    try {
      const values = await form.validateFields()
      const file = fileList[0]?.originFileObj
      if (!file) {
        message.warning('请选择要上传的 .py 或 .zip 文件')
        return
      }
      setSubmitting(true)
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', values.name)
      if (values.description) fd.append('description', values.description)
      if (values.entrypoint) fd.append('entrypoint', values.entrypoint)
      if (values.env_id !== undefined && values.env_id !== null) fd.append('env_id', String(values.env_id))
      await scriptSyncApi.upload(fd)
      message.success('上传成功')
      setModalOpen(false)
      form.resetFields()
      setFileList([])
      loadTasks()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.response?.data?.detail || '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  const doAction = async (fn: () => Promise<any>, okMsg: string) => {
    try {
      const res = await fn()
      message.success(res?.data?.message || okMsg)
      loadTasks()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  const handleRun = async (r: ScriptTask) => {
    const hide = message.loading(`正在执行「${r.name}」...`, 0)
    try {
      const res = await scriptSyncApi.run(r.id)
      const data = res.data || {}
      Modal[data.success ? 'success' : 'error']({
        title: data.message || (data.success ? '执行成功' : '执行失败'),
        width: 720,
        content: (
          <pre style={{ maxHeight: 420, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, margin: 0 }}>
            {data.output || '(无输出)'}
          </pre>
        ),
      })
      loadTasks()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '执行失败')
    } finally {
      hide()
    }
  }

  const openSchedule = (tasks: ScriptTask | ScriptTask[]) => {
    const list = Array.isArray(tasks) ? tasks : [tasks]
    if (list.length === 0) return
    setScheduleTasks(list)
    setScheduleCron(list[0].cron_expression || '0 2 * * *')
    setScheduleOpen(true)
  }

  const handleConfirmSchedule = async () => {
    if (scheduleTasks.length === 0) return
    setScheduling(true)
    let ok = 0, fail = 0
    for (const t of scheduleTasks) {
      try {
        // 先把 cron 存到任务，再上线（deploy 会用该 cron 生成 DAG）
        await scriptSyncApi.update(t.id, { cron_expression: scheduleCron })
        await scriptSyncApi.deploy(t.id)
        ok++
      } catch {
        fail++
      }
    }
    setScheduling(false)
    if (fail === 0) message.success(`上线成功${scheduleTasks.length > 1 ? ` (${ok}个)` : ''}`)
    else message.warning(`成功 ${ok} 个，失败 ${fail} 个`)
    setScheduleOpen(false)
    setSelectedIds([])
    loadTasks()
  }

  const handleViewLog = (r: ScriptTask) => {
    Modal.info({
      title: `运行日志 - ${r.name}`,
      width: 760,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>
            上次运行：
            {r.last_run_status
              ? <Tag color={r.last_run_status === 'success' ? 'green' : 'red'}>{r.last_run_status === 'success' ? '成功' : '失败'}</Tag>
              : <Tag>未运行</Tag>}
            {r.last_run_at && <Text type="secondary" style={{ marginLeft: 8 }}>{new Date(r.last_run_at).toLocaleString()}</Text>}
          </div>
          <pre style={{ maxHeight: 440, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, margin: 0 }}>
            {r.last_error || '（暂无手动运行日志。定时调度的运行日志请到「调度管理 → 查看」或 Airflow 中查看）'}
          </pre>
        </div>
      ),
    })
  }

  // 删除单个：若任务仍在调度（有 dag_id），先去调度管理下线并移出调度
  const handleDelete = (r: ScriptTask) => {
    if (r.dag_id) {
      Modal.confirm({
        title: '请先在「调度管理」处理调度',
        content: '该任务已在调度任务里。请先到调度管理：下线 → 点「删除」(移出调度)，之后才能在此删除。',
        okText: '前往调度管理',
        cancelText: '取消',
        onOk: () => window.open(`/bigdata/scheduler?script_ids=${r.id}`, '_blank'),
      })
      return
    }
    Modal.confirm({
      title: '确定删除该脚本任务？',
      content: '将清理脚本文件和 DAG',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => doAction(() => scriptSyncApi.delete(r.id), '已删除'),
    })
  }

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return
    const selected = tasks.filter(t => selectedIds.includes(t.id))
    const scheduled = selected.filter(t => t.dag_id)
    const deletable = selected.filter(t => !t.dag_id)
    if (scheduled.length > 0) {
      message.warning(`${scheduled.length} 个任务仍在调度中，请先到调度管理下线并移出调度后再删除`)
    }
    if (deletable.length === 0) return
    setBatchDeleting(true)
    let ok = 0, fail = 0
    for (const t of deletable) {
      try { await scriptSyncApi.delete(t.id); ok++ } catch { fail++ }
    }
    setBatchDeleting(false)
    setSelectedIds([])
    if (fail === 0) message.success(`已删除 ${ok} 个`)
    else message.warning(`成功 ${ok} 个，失败 ${fail} 个`)
    loadTasks()
  }

  const isZip = fileList[0]?.name?.toLowerCase().endsWith('.zip')

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 200, ellipsis: true, render: (v: string, r: ScriptTask) => (
      <div>
        <div style={{ fontWeight: 500 }}>{v}</div>
        {r.description && <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.description}</Text>}
      </div>
    ) },
    { title: '入口', dataIndex: 'entrypoint', key: 'entrypoint', width: 150, ellipsis: true, render: (v: string, r: ScriptTask) => (
      <Space size={4}>
        <code style={{ fontSize: 12 }}>{v}</code>
        {r.has_requirements && <Tag color="blue" style={{ fontSize: 10 }}>req</Tag>}
      </Space>
    ) },
    { title: '运行环境', key: 'env', width: 150, render: (_: any, r: ScriptTask) => (
      <Select
        size="small"
        style={{ width: 130 }}
        allowClear
        placeholder="默认环境"
        value={r.env_id ?? undefined}
        options={envs.map(e => ({ label: e.name, value: e.id }))}
        onChange={async (v) => {
          try {
            await scriptSyncApi.update(r.id, { env_id: v ?? null })
            message.success('已切换运行环境')
            loadTasks()
          } catch (e: any) {
            message.error(e.response?.data?.detail || '切换失败')
          }
        }}
      />
    ) },
    { title: '调度', dataIndex: 'cron_expression', key: 'cron', render: (v?: string) => v ? <code style={{ fontSize: 12 }}>{v}</code> : <Text type="secondary">手动</Text> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => {
      const t = STATUS_TAG[v] || { color: 'default', text: v }
      return <Tag color={t.color}>{t.text}</Tag>
    } },
    { title: 'DAG', dataIndex: 'dag_id', key: 'dag_id', render: (v?: string) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '-' },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, r: ScriptTask) => (
        <Space>
          {r.status === 'active' ? (
            <Tooltip title="管理调度">
              <Button
                type="text"
                size="small"
                icon={<ScheduleOutlined style={{ color: '#52c41a' }} />}
                onClick={() => navigate(`/bigdata/scheduler?script_ids=${r.id}`)}
              />
            </Tooltip>
          ) : (
            <Tooltip title="上线调度">
              <Button
                type="text"
                size="small"
                icon={<CloudUploadOutlined style={{ color: '#1890ff' }} />}
                onClick={() => openSchedule(r)}
              />
            </Tooltip>
          )}
          <Tooltip title="执行（当前环境，不经 Airflow）">
            <Button
              type="text"
              size="small"
              icon={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
              onClick={() => handleRun(r)}
            />
          </Tooltip>
          <Tooltip title="运行日志">
            <Button
              type="text"
              size="small"
              icon={<FileTextOutlined style={{ color: r.last_run_status === 'failed' ? '#ff4d4f' : '#8c8c8c' }} />}
              onClick={() => handleViewLog(r)}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} />
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bigdata/data-sync')} style={{ marginBottom: 16 }}>
        返回同步方式
      </Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>脚本同步</Title>
        <Space>
          {selectedIds.length > 0 && (
            <>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={() => openSchedule(tasks.filter(t => selectedIds.includes(t.id)))}
              >
                上线 ({selectedIds.length})
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={batchDeleting}
                onClick={handleBatchDelete}
              >
                删除 ({selectedIds.length})
              </Button>
            </>
          )}
          <Button icon={<AppstoreOutlined />} onClick={() => setPyEnvOpen(true)}>运行环境</Button>
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>刷新</Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setModalOpen(true)}>上传脚本</Button>
        </Space>
      </div>

      <PyEnvManager open={pyEnvOpen} onClose={() => { setPyEnvOpen(false); loadEnvs() }} />

      <Table
        rowKey="id"
        loading={loading}
        dataSource={tasks}
        columns={columns as any}
        pagination={false}
        size="middle"
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
        }}
      />

      <Modal
        title="上传 Python 脚本"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); setFileList([]) }}
        onOk={handleUpload}
        confirmLoading={submitting}
        okText="上传"
        cancelButtonProps={noCancel}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="任务名称" name="name" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="如：用户行为数据抽取" autoComplete="off" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <Form.Item label="程序文件（.py 或 .zip）" required>
            <Upload
              accept=".py,.zip"
              maxCount={1}
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList }) => setFileList(fileList.slice(-1))}
            >
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>
          {isZip && (
            <Form.Item label="入口文件" name="entrypoint" tooltip="zip 解压后要运行的入口脚本，相对压缩包根目录" initialValue="main.py">
              <Input placeholder="main.py" autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item label="运行环境" name="env_id" tooltip="手动运行时用哪个 Python 环境执行；留空=后端默认环境。可在「运行环境」里管理">
            <Select
              allowClear
              placeholder="默认环境"
              options={envs.map(e => ({ label: e.name, value: e.id }))}
            />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            提示：脚本需自带数据库连接信息；若有第三方依赖，请在压缩包内放 requirements.txt，运行前会自动 pip install。定时调度在列表中「上线」时配置。
          </Text>
        </Form>
      </Modal>

      <Modal
        title={<Space><ScheduleOutlined /><span>上线脚本任务{scheduleTasks.length > 1 ? ` (${scheduleTasks.length}个)` : scheduleTasks[0] ? ` - ${scheduleTasks[0].name}` : ''}</span></Space>}
        open={scheduleOpen}
        onCancel={() => setScheduleOpen(false)}
        onOk={handleConfirmSchedule}
        confirmLoading={scheduling}
        okText="确定上线"
        cancelButtonProps={noCancel}
        width={550}
      >
        <Alert
          message="上线后将生成 Airflow DAG 并按 Cron 定时执行（也可在列表点「运行」手动触发）"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        {scheduleTasks.length === 1 ? (
          <Space direction="vertical" style={{ marginBottom: 16, width: '100%' }}>
            <Text>任务名称：<Tag color="blue">{scheduleTasks[0].name}</Tag></Text>
            <Text>入口脚本：<Text code style={{ fontSize: 11 }}>{scheduleTasks[0].entrypoint}</Text></Text>
          </Space>
        ) : (
          <div style={{ marginBottom: 16, maxHeight: 150, overflow: 'auto' }}>
            {scheduleTasks.map(t => (
              <div key={t.id} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Tag color="blue">{t.name}</Tag>
                <Text type="secondary" style={{ fontSize: 11 }}>{t.entrypoint}</Text>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <Text strong>Cron 表达式：</Text>
        </div>
        <CronExpressionInput value={scheduleCron} onChange={(v) => setScheduleCron(v)} />
      </Modal>
    </div>
  )
}
