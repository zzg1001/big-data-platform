import { useEffect, useState } from 'react'
import {
  Modal, Table, Button, Space, Tag, Form, Input, Select, message, Tooltip, Radio, Typography,
} from 'antd'
import {
  PlusOutlined, CloudDownloadOutlined, AppstoreAddOutlined, DeleteOutlined, ReloadOutlined,
  ProfileOutlined,
} from '@ant-design/icons'
import { pyEnvApi } from '../services/api'

const { Text } = Typography
const noCancel = { style: { display: 'none' } }  // 隐藏弹窗的取消按钮

interface PyEnv {
  id: number
  name: string
  description?: string
  python_path: string
  kind: string
  status: string
  python_version?: string
}

export default function PyEnvManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [envs, setEnvs] = useState<PyEnv[]>([])
  const [loading, setLoading] = useState(false)

  // 登记已有环境
  const [regOpen, setRegOpen] = useState(false)
  const [regForm] = Form.useForm()
  const [candidates, setCandidates] = useState<{ name: string; python_path: string }[]>([])
  const [regSubmitting, setRegSubmitting] = useState(false)

  // 新建 venv
  const [venvOpen, setVenvOpen] = useState(false)
  const [venvForm] = Form.useForm()
  const [venvSubmitting, setVenvSubmitting] = useState(false)

  // 装包
  const [installOpen, setInstallOpen] = useState(false)
  const [installEnv, setInstallEnv] = useState<PyEnv | null>(null)
  const [installMode, setInstallMode] = useState<'packages' | 'requirements'>('packages')
  const [installText, setInstallText] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await pyEnvApi.list()
      setEnvs(res.data || [])
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) load() }, [open])

  const openRegister = async () => {
    regForm.resetFields()
    setRegOpen(true)
    try {
      const res = await pyEnvApi.discover()
      setCandidates(res.data?.candidates || [])
    } catch { setCandidates([]) }
  }

  const submitRegister = async () => {
    try {
      const v = await regForm.validateFields()
      setRegSubmitting(true)
      await pyEnvApi.register({ name: v.name, python_path: v.python_path, description: v.description })
      message.success('已登记')
      setRegOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.response?.data?.detail || '登记失败')
    } finally {
      setRegSubmitting(false)
    }
  }

  const submitVenv = async () => {
    try {
      const v = await venvForm.validateFields()
      setVenvSubmitting(true)
      await pyEnvApi.createVenv({ name: v.name, description: v.description })
      message.success('虚拟环境已创建')
      setVenvOpen(false)
      venvForm.resetFields()
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.response?.data?.detail || '创建失败')
    } finally {
      setVenvSubmitting(false)
    }
  }

  const openInstall = (env: PyEnv) => {
    setInstallEnv(env)
    setInstallMode('packages')
    setInstallText('')
    setInstallLog('')
    setInstallOpen(true)
  }

  const submitInstall = async () => {
    if (!installEnv || !installText.trim()) { message.warning('请填写要安装的包'); return }
    setInstalling(true)
    setInstallLog('安装中...')
    try {
      const payload = installMode === 'packages' ? { packages: installText } : { requirements: installText }
      const res = await pyEnvApi.install(installEnv.id, payload)
      setInstallLog(res.data?.output || '(无输出)')
      message[res.data?.success ? 'success' : 'error'](res.data?.message || '完成')
    } catch (e: any) {
      setInstallLog(e.response?.data?.detail || '安装失败')
      message.error('安装失败')
    } finally {
      setInstalling(false)
    }
  }

  const viewPackages = async (env: PyEnv) => {
    const hide = message.loading('加载包列表...', 0)
    try {
      const res = await pyEnvApi.packages(env.id)
      Modal.info({
        title: `已安装的包 - ${env.name}`,
        width: 640,
        content: (
          <pre style={{ maxHeight: 440, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, margin: 0 }}>
            {res.data?.output || '(空)'}
          </pre>
        ),
      })
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      hide()
    }
  }

  const handleDelete = (env: PyEnv) => {
    Modal.confirm({
      title: `删除环境「${env.name}」？`,
      content: env.kind === 'managed' ? '将删除该虚拟环境目录' : '仅取消登记，不影响该解释器本身',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await pyEnvApi.delete(env.id)
          message.success('已删除')
          load()
        } catch (e: any) {
          message.error(e.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  const columns = [
    { title: '名称', dataIndex: 'name', width: 140, ellipsis: true, render: (v: string, r: PyEnv) => (
      <div><div style={{ fontWeight: 500 }}>{v}</div>{r.description && <Text type="secondary" style={{ fontSize: 11 }} ellipsis>{r.description}</Text>}</div>
    ) },
    { title: '解释器', dataIndex: 'python_path', ellipsis: true, render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code> },
    { title: '类型', dataIndex: 'kind', width: 80, render: (v: string) => v === 'managed' ? <Tag color="purple">托管venv</Tag> : <Tag color="blue">外部</Tag> },
    { title: '版本', dataIndex: 'python_version', width: 120, ellipsis: true, render: (v?: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text> },
    {
      title: '操作', key: 'action', width: 130,
      render: (_: any, r: PyEnv) => (
        <Space>
          <Tooltip title="安装包"><Button type="text" size="small" icon={<CloudDownloadOutlined />} onClick={() => openInstall(r)} /></Tooltip>
          <Tooltip title="查看已装包"><Button type="text" size="small" icon={<ProfileOutlined />} onClick={() => viewPackages(r)} /></Tooltip>
          <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)} /></Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Modal
        title="运行环境管理"
        open={open}
        onCancel={onClose}
        footer={null}
        width={860}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={openRegister}>登记已有环境</Button>
          <Button icon={<AppstoreAddOutlined />} onClick={() => { venvForm.resetFields(); setVenvOpen(true) }}>新建虚拟环境</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </div>
        <Table rowKey="id" size="small" loading={loading} dataSource={envs} columns={columns as any} pagination={false} />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          脚本手动运行时可选择在这些环境里执行；包装在哪个环境，脚本就在哪个环境用得上。（仅用于手动运行）
        </Text>
      </Modal>

      {/* 登记已有环境 */}
      <Modal
        title="登记已有环境"
        open={regOpen}
        onCancel={() => setRegOpen(false)}
        onOk={submitRegister}
        confirmLoading={regSubmitting}
        okText="确定"
        cancelButtonProps={noCancel}
        width={560}
      >
        <Form form={regForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：爬虫环境" autoComplete="off" />
          </Form.Item>
          <Form.Item label="从自动发现的环境选择（可选）">
            <Select
              placeholder="选择后自动填入下方解释器路径"
              allowClear
              options={candidates.map(c => ({ label: `${c.name}  (${c.python_path})`, value: c.python_path }))}
              onChange={(v) => regForm.setFieldsValue({ python_path: v })}
            />
          </Form.Item>
          <Form.Item label="Python 解释器路径" name="python_path" rules={[{ required: true, message: '请输入或选择解释器路径' }]}>
            <Input placeholder="如：D:/install/Conda3/envs/bigdata/python.exe" autoComplete="off" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input placeholder="可选" autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建虚拟环境 */}
      <Modal
        title="新建虚拟环境"
        open={venvOpen}
        onCancel={() => setVenvOpen(false)}
        onOk={submitVenv}
        confirmLoading={venvSubmitting}
        okText="创建"
        cancelButtonProps={noCancel}
        width={480}
      >
        <Form form={venvForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：sync_env" autoComplete="off" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input placeholder="可选" autoComplete="off" />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>将用后端解释器执行 python -m venv 创建，可能需要几十秒。</Text>
        </Form>
      </Modal>

      {/* 装包 */}
      <Modal
        title={`安装包 - ${installEnv?.name || ''}`}
        open={installOpen}
        onCancel={() => setInstallOpen(false)}
        onOk={submitInstall}
        confirmLoading={installing}
        okText="安装"
        cancelButtonProps={noCancel}
        width={640}
      >
        <Radio.Group value={installMode} onChange={(e) => setInstallMode(e.target.value)} style={{ marginBottom: 12 }}>
          <Radio value="packages">输入包名</Radio>
          <Radio value="requirements">粘贴 requirements</Radio>
        </Radio.Group>
        <Input.TextArea
          rows={5}
          value={installText}
          onChange={(e) => setInstallText(e.target.value)}
          placeholder={installMode === 'packages' ? '空格或换行分隔，如：pandas==2.1.4 requests pymysql' : '每行一个，如：\npandas==2.1.4\nrequests'}
        />
        {installLog && (
          <pre style={{ marginTop: 12, maxHeight: 300, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
            {installLog}
          </pre>
        )}
      </Modal>
    </>
  )
}
