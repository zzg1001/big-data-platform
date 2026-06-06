import { useNavigate } from 'react-router-dom'
import { Result, Button } from 'antd'
import { BuildOutlined } from '@ant-design/icons'

export default function TagSystem() {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Result
        icon={<BuildOutlined style={{ color: '#1890ff' }} />}
        title="Tag Management Platform"
        subTitle="标签管理平台正在开发中，敬请期待..."
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />
    </div>
  )
}
