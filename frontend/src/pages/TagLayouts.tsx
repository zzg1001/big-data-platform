import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layout,
  Button,
  Typography,
  Card,
  Empty,
  Modal,
  message,
  Tag,
  Space,
  Tooltip,
} from 'antd'
import {
  LeftOutlined,
  DeleteOutlined,
  EyeOutlined,
  ExportOutlined,
  HomeOutlined,
} from '@ant-design/icons'

const { Header, Content } = Layout
const { Title, Text } = Typography

interface SavedLayout {
  id: string
  name: string
  createdAt: string
  nodes: Array<{
    id: number
    x: number
    y: number
    tagId: number
    tagName: string
    nodeType: string
    color?: string
  }>
  connections: Array<{
    fromId: number
    toId: number
  }>
}

const typeColors: Record<string, string> = {
  category: '#1890ff',
  type: '#722ed1',
  tag: '#52c41a',
}

export default function TagLayouts() {
  const navigate = useNavigate()
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const [previewLayout, setPreviewLayout] = useState<SavedLayout | null>(null)

  useEffect(() => {
    loadLayouts()
  }, [])

  const loadLayouts = () => {
    const saved = JSON.parse(localStorage.getItem('tagLayouts') || '[]')
    setLayouts(saved.sort((a: SavedLayout, b: SavedLayout) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ))
  }

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个布局吗？',
      onOk: () => {
        const updated = layouts.filter(l => l.id !== id)
        localStorage.setItem('tagLayouts', JSON.stringify(updated))
        setLayouts(updated)
        message.success('已删除')
      }
    })
  }

  const handleLoadLayout = (layout: SavedLayout) => {
    // 将布局数据存储到 sessionStorage，然后跳转到标签管理页面加载
    sessionStorage.setItem('loadLayout', JSON.stringify(layout))
    navigate('/tags')
    message.info('正在加载布局...')
  }

  const handleExport = (layout: SavedLayout) => {
    const dataStr = JSON.stringify(layout, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${layout.name}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    message.success('已导出')
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#1a1a1a', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Title level={5} style={{ margin: 0, color: '#fff' }}>标签布局管理</Title>
        </div>
        <Button type="text" icon={<HomeOutlined />} onClick={() => window.open('/', '_blank')} style={{ color: 'rgba(255,255,255,0.7)' }}>
          返回首页
        </Button>
      </Header>

      <Content style={{ padding: '24px 40px' }}>
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button type="text" icon={<LeftOutlined />} onClick={() => navigate('/tags')}>
            返回标签管理
          </Button>
          <Title level={4} style={{ margin: 0 }}>已保存的布局</Title>
          <Text type="secondary">共 {layouts.length} 个</Text>
        </div>

        {layouts.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 8, padding: 48 }}>
            <Empty description="暂无保存的布局">
              <Button type="primary" onClick={() => navigate('/tags')}>
                去创建布局
              </Button>
            </Empty>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {layouts.map(layout => (
              <Card
                key={layout.id}
                hoverable
                style={{ borderRadius: 8 }}
                actions={[
                  <Tooltip key="load" title="加载此布局">
                    <Button type="text" icon={<EyeOutlined />} onClick={() => handleLoadLayout(layout)}>
                      加载
                    </Button>
                  </Tooltip>,
                  <Tooltip key="export" title="导出 JSON">
                    <Button type="text" icon={<ExportOutlined />} onClick={() => handleExport(layout)}>
                      导出
                    </Button>
                  </Tooltip>,
                  <Tooltip key="delete" title="删除">
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(layout.id)}>
                      删除
                    </Button>
                  </Tooltip>,
                ]}
              >
                <Card.Meta
                  title={layout.name}
                  description={
                    <div>
                      <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
                        {new Date(layout.createdAt).toLocaleString()}
                      </div>
                      <Space size={4} wrap>
                        <Tag color="blue">{layout.nodes.length} 个节点</Tag>
                        <Tag color="green">{layout.connections.length} 条连接</Tag>
                      </Space>
                      <div style={{ marginTop: 12 }}>
                        {layout.nodes.slice(0, 5).map(node => (
                          <Tag
                            key={node.id}
                            color={node.color || typeColors[node.nodeType]}
                            style={{ marginBottom: 4 }}
                          >
                            {node.tagName}
                          </Tag>
                        ))}
                        {layout.nodes.length > 5 && (
                          <Tag style={{ marginBottom: 4 }}>+{layout.nodes.length - 5}</Tag>
                        )}
                      </div>
                    </div>
                  }
                />
              </Card>
            ))}
          </div>
        )}

        {/* 预览弹框 */}
        <Modal
          title={previewLayout?.name}
          open={!!previewLayout}
          onCancel={() => setPreviewLayout(null)}
          footer={[
            <Button key="close" onClick={() => setPreviewLayout(null)}>关闭</Button>,
            <Button key="load" type="primary" onClick={() => previewLayout && handleLoadLayout(previewLayout)}>
              加载此布局
            </Button>
          ]}
          width={800}
        >
          {previewLayout && (
            <div style={{ position: 'relative', height: 400, background: '#f5f5f5', borderRadius: 8, overflow: 'hidden' }}>
              {/* 简单的预览，显示节点位置 */}
              <svg style={{ position: 'absolute', width: '100%', height: '100%' }}>
                {previewLayout.connections.map(conn => {
                  const fromNode = previewLayout.nodes.find(n => n.id === conn.fromId)
                  const toNode = previewLayout.nodes.find(n => n.id === conn.toId)
                  if (!fromNode || !toNode) return null
                  const scale = 0.5
                  return (
                    <line
                      key={`${conn.fromId}-${conn.toId}`}
                      x1={fromNode.x * scale + 40}
                      y1={fromNode.y * scale + 30}
                      x2={toNode.x * scale + 40}
                      y2={toNode.y * scale + 30}
                      stroke="#999"
                      strokeWidth="1"
                    />
                  )
                })}
              </svg>
              {previewLayout.nodes.map(node => (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    left: node.x * 0.5,
                    top: node.y * 0.5,
                    width: 80,
                    padding: '4px 8px',
                    background: '#fff',
                    borderRadius: 4,
                    borderLeft: `3px solid ${node.color || typeColors[node.nodeType]}`,
                    fontSize: 11,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.tagName}
                </div>
              ))}
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  )
}
