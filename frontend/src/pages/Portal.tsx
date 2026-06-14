import { useNavigate } from 'react-router-dom'
import { Row, Col, Avatar, Dropdown, Space } from 'antd'
import {
  DatabaseOutlined,
  TagsOutlined,
  AppstoreOutlined,
  UserOutlined,
  LogoutOutlined,
  RightOutlined,
  RobotOutlined,
  QuestionCircleOutlined,
  BellOutlined,
  ScheduleOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

interface ModuleCardProps {
  title: string
  description: string
  icon: React.ReactNode
  path: string
  iconBg: string
  disabled?: boolean
}

const modules: ModuleCardProps[] = [
  {
    title: '智能数据探索',
    description: '自然语言查询 · 智能 SQL · ETL 编排 · 数据同步',
    icon: <DatabaseOutlined />,
    path: '/bigdata',
    iconBg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  {
    title: 'AI 智能标签',
    description: '智能打标 · 规则引擎 · 数据赋魂 · 业务沉淀',
    icon: <TagsOutlined />,
    path: '/tags',
    iconBg: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
  },
  {
    title: '智能编排引擎',
    description: 'AI 编排 · DAG 调度 · 定时执行 · 运行监控',
    icon: <ScheduleOutlined />,
    path: '/scheduler',
    iconBg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  },
  {
    title: '智能 API 中心',
    description: 'AI 接口 · 数据开放 · 调用统计 · 智能文档',
    icon: <ApiOutlined />,
    path: '/data-service',
    iconBg: 'linear-gradient(135deg, #1890ff 0%, #722ed1 100%)',
  },
  {
    title: 'AI 资产治理',
    description: '智能元数据 · 血缘追踪 · 质量监控 · 资产沉淀',
    icon: <AppstoreOutlined />,
    path: '',
    iconBg: 'linear-gradient(135deg, #fc4a1a 0%, #f7b733 100%)',
    disabled: true,
  },
  {
    title: '智能决策引擎',
    description: '规则配置 · 智能决策 · 业务沉淀 · 实时响应',
    icon: <AppstoreOutlined />,
    path: '',
    iconBg: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)',
    disabled: true,
  },
]

function ModuleCard({ title, description, icon, path, iconBg, disabled, onNavigate }: ModuleCardProps & { onNavigate: (path: string) => void }) {
  return (
    <div
      onClick={() => !disabled && path && onNavigate(path)}
      style={{
        background: '#fff',
        borderRadius: 8,
        padding: '20px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.25s ease',
        border: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'
          e.currentTarget.style.borderColor = '#d9d9d9'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.borderColor = '#e8e8e8'
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 8,
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#1a1a1a', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ color: '#666', fontSize: 12 }}>
          {description}
        </div>
      </div>
      {!disabled ? (
        <RightOutlined style={{ color: '#bbb', fontSize: 12 }} />
      ) : (
        <span style={{ color: '#bbb', fontSize: 11, background: '#f5f5f5', padding: '2px 8px', borderRadius: 4 }}>即将上线</span>
      )}
    </div>
  )
}

export default function Portal() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  return (
    <div
      style={{
        height: '100vh',
        background: '#f5f7fa',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 顶部导航栏 - 阿里云风格 */}
      <header
        style={{
          height: 50,
          background: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          flexShrink: 0,
        }}
      >
        {/* 左侧 Logo + 导航 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 14,
              }}
            >
              <RobotOutlined />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
              Grok Data
            </span>
          </div>

          {/* 导航菜单 */}
          <nav style={{ display: 'flex', gap: 24 }}>
            {['控制台', '产品', '文档', '支持'].map((item, i) => (
              <span
                key={i}
                style={{
                  color: i === 0 ? '#fff' : 'rgba(255,255,255,0.7)',
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
                onMouseLeave={(e) => e.currentTarget.style.color = i === 0 ? '#fff' : 'rgba(255,255,255,0.7)'}
              >
                {item}
              </span>
            ))}
          </nav>
        </div>

        {/* 右侧工具栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Space size={16}>
            <QuestionCircleOutlined style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, cursor: 'pointer' }} />
            <BellOutlined style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, cursor: 'pointer' }} />
          </Space>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)' }} />
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size={26} icon={<UserOutlined />} style={{ background: '#667eea' }} />
              <span style={{ color: '#fff', fontSize: 13 }}>{user?.username || 'User'}</span>
            </div>
          </Dropdown>
        </div>
      </header>

      {/* 主体内容区 */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Hero 区域 */}
        <div
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: '48px 24px 56px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 背景装饰 */}
          <div
            style={{
              position: 'absolute',
              top: -100,
              right: -100,
              width: 300,
              height: 300,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: -50,
              left: -50,
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.05)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 16,
                padding: '4px 14px',
                marginBottom: 16,
              }}
            >
              <RobotOutlined style={{ color: '#fff', fontSize: 12 }} />
              <span style={{ color: '#fff', fontSize: 12 }}>Learn · Adapt · Grok</span>
            </div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: '#fff',
                marginBottom: 8,
              }}
            >
              Grok Data
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.85)',
                margin: 0,
              }}
            >
              AI 驱动 · 深度理解 · 超越
            </p>
          </div>
        </div>

        {/* 产品卡片区域 */}
        <div
          style={{
            flex: 1,
            padding: '32px 24px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '100%', maxWidth: 900 }}>
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>产品服务</span>
              <span style={{ fontSize: 12, color: '#999' }}>选择要进入的平台</span>
            </div>
            <Row gutter={[16, 16]}>
              {modules.map((module, index) => (
                <Col xs={24} sm={12} key={index}>
                  <ModuleCard {...module} onNavigate={navigate} />
                </Col>
              ))}
            </Row>
          </div>
        </div>
      </main>

      {/* 底部 */}
      <footer
        style={{
          height: 40,
          background: '#fff',
          borderTop: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#999', fontSize: 12 }}>
          Grok Data v1.0 · Learn · Adapt · Grok
        </span>
      </footer>
    </div>
  )
}
