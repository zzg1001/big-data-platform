import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Button, theme } from 'antd'
import {
  DatabaseOutlined,
  FileOutlined,
  ScheduleOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  SyncOutlined,
  GoldOutlined,
  TagsOutlined,
  AppstoreOutlined,
  HomeOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

const { Header, Sider, Content } = Layout

const menuItems = [
  { key: '/bigdata', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/bigdata/datasources', icon: <DatabaseOutlined />, label: '数据源管理' },
  {
    key: 'sync-group',
    icon: <SyncOutlined />,
    label: '数据同步',
    children: [
      { key: '/bigdata/data-sync', icon: <SyncOutlined />, label: '同步任务' },
      { key: '/bigdata/field-templates', icon: <TagsOutlined />, label: '字段模板' },
    ],
  },
  {
    key: 'explorer-group',
    icon: <GoldOutlined />,
    label: '数据探索',
    children: [
      { key: '/bigdata/data-explorer', icon: <GoldOutlined />, label: '业务探索' },
      { key: '/bigdata/etl-tasks', icon: <SyncOutlined />, label: 'ETL任务' },
    ],
  },
  { key: '/bigdata/files', icon: <FileOutlined />, label: '文件管理' },
  { key: '/bigdata/scheduler', icon: <ScheduleOutlined />, label: '调度管理' },
  { key: '/bigdata/dw-layers', icon: <AppstoreOutlined />, label: '平台数据库层级' },
  { key: '/bigdata/admin', icon: <SettingOutlined />, label: '系统管理' },
]

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { token } = theme.useToken()

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key)
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人设置',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider trigger={null} collapsible collapsed={collapsed} theme="dark">
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: collapsed ? 16 : 18,
            fontWeight: 'bold',
          }}
        >
          {collapsed ? 'BDP' : 'Big Data Platform'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['sync-group', 'explorer-group']}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: token.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Button
              type="text"
              icon={<HomeOutlined />}
              onClick={() => window.open('/', '_blank')}
            >
              返回首页
            </Button>
          </div>
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user?.username || 'User'}</span>
            </div>
          </Dropdown>
        </Header>
        <Content
          style={(location.pathname === '/bigdata/data-explorer' || location.pathname === '/bigdata/etl-tasks') ? {
            margin: 0,
            padding: 0,
            background: token.colorBgContainer,
            overflow: 'hidden',
          } : {
            margin: 24,
            padding: 24,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            minHeight: 280,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
