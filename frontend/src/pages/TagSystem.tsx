import { useNavigate } from 'react-router-dom'
import { Layout, Button, Avatar, Dropdown } from 'antd'
import { TagsOutlined, HomeOutlined, UserOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

const { Header, Content } = Layout

export default function TagSystem() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userMenuItems = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
  ]

  return (
    <Layout style={{ height: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#1a1a1a', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>
              <TagsOutlined />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>标签管理平台</span>
          </div>
          <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/')} style={{ color: 'rgba(255,255,255,0.7)' }}>
            返回首页
          </Button>
        </div>
        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size={26} icon={<UserOutlined />} style={{ background: '#11998e' }} />
            <span style={{ color: '#fff', fontSize: 13 }}>{user?.username || 'User'}</span>
          </div>
        </Dropdown>
      </Header>

      <Content style={{ padding: 24, overflow: 'auto' }}>
        {/* 在这里重新设计你的内容 */}
      </Content>
    </Layout>
  )
}
