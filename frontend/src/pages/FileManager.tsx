import { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Upload,
  Modal,
  Form,
  Select,
  Input,
  Space,
  Tag,
  message,
  Popconfirm,
  Typography,
} from 'antd'
import {
  UploadOutlined,
  EyeOutlined,
  DeleteOutlined,
  ImportOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import { fileApi, datasourceApi } from '../services/api'

const { Title } = Typography

export default function FileManager() {
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewData, setPreviewData] = useState<any>(null)
  const [importVisible, setImportVisible] = useState(false)
  const [importingFile, setImportingFile] = useState<any>(null)
  const [datasources, setDatasources] = useState<any[]>([])
  const [form] = Form.useForm()

  useEffect(() => {
    loadFiles()
    loadDatasources()
  }, [])

  const loadFiles = async () => {
    setLoading(true)
    try {
      const res = await fileApi.list()
      setFiles(res.data)
    } catch (error) {
      message.error('加载文件列表失败')
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

  const handleUpload = async (options: any) => {
    const { file, onSuccess, onError } = options
    try {
      await fileApi.upload(file)
      message.success('上传成功')
      onSuccess()
      loadFiles()
    } catch (error: any) {
      message.error(error.response?.data?.detail || '上传失败')
      onError(error)
    }
  }

  const handlePreview = async (record: any) => {
    try {
      const res = await fileApi.preview(record.id, 100)
      setPreviewData({ ...res.data, filename: record.original_name })
      setPreviewVisible(true)
    } catch (error) {
      message.error('预览失败')
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await fileApi.delete(id)
      message.success('删除成功')
      loadFiles()
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleImportClick = (record: any) => {
    setImportingFile(record)
    form.resetFields()
    setImportVisible(true)
  }

  const handleImport = async () => {
    try {
      const values = await form.validateFields()
      await fileApi.import(importingFile.id, values)
      message.success('导入成功')
      setImportVisible(false)
      loadFiles()
    } catch (error: any) {
      if (error.errorFields) return
      message.error(error.response?.data?.detail || '导入失败')
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const columns = [
    { title: '文件名', dataIndex: 'original_name', key: 'name' },
    {
      title: '类型',
      dataIndex: 'file_type',
      key: 'type',
      render: (type: string) => <Tag>{type.toUpperCase()}</Tag>,
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'size',
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colors: any = {
          uploaded: 'blue',
          processing: 'orange',
          completed: 'green',
          failed: 'red',
        }
        return <Tag color={colors[status] || 'default'}>{status}</Tag>
      },
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handlePreview(record)}
          >
            预览
          </Button>
          <Button
            type="link"
            icon={<ImportOutlined />}
            onClick={() => handleImportClick(record)}
            disabled={record.status !== 'uploaded'}
          >
            导入
          </Button>
          <Popconfirm
            title="确定删除该文件?"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const previewColumns = previewData?.columns?.map((col: string) => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
  })) || []

  const previewDataSource = previewData?.rows?.map((row: any[], i: number) => {
    const obj: any = { key: i }
    previewData.columns.forEach((col: string, j: number) => {
      obj[col] = row[j]
    })
    return obj
  }) || []

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4}>文件管理</Title>
        <Upload customRequest={handleUpload} showUploadList={false}>
          <Button type="primary" icon={<UploadOutlined />}>
            上传文件
          </Button>
        </Upload>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={files}
          rowKey="id"
          loading={loading}
        />
      </Card>

      <Modal
        title={`预览: ${previewData?.filename}`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        width={1000}
        footer={null}
      >
        <Table
          columns={previewColumns}
          dataSource={previewDataSource}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 20 }}
          size="small"
        />
        <div style={{ marginTop: 8, color: '#999' }}>
          显示前 {previewData?.preview_rows} 行，共 {previewData?.total_rows} 行
        </div>
      </Modal>

      <Modal
        title="导入到数据库"
        open={importVisible}
        onOk={handleImport}
        onCancel={() => setImportVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="datasource_id"
            label="目标数据源"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="选择数据源"
              options={datasources.map((ds) => ({
                value: ds.id,
                label: `${ds.name} (${ds.type})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="table_name"
            label="表名"
            rules={[{ required: true }]}
          >
            <Input placeholder="目标表名" />
          </Form.Item>
          <Form.Item name="if_exists" label="如果表存在" initialValue="fail">
            <Select
              options={[
                { value: 'fail', label: '报错' },
                { value: 'replace', label: '替换' },
                { value: 'append', label: '追加' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
