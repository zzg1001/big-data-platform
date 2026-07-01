import { useNavigate } from 'react-router-dom'
import { Button, Empty, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'

export default function DataSyncDataX() {
  const navigate = useNavigate()
  return (
    <div style={{ padding: 24 }}>
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/bigdata/data-sync')}
        style={{ marginBottom: 16 }}
      >
        返回同步方式
      </Button>
      <Typography.Title level={4}>DataX 同步</Typography.Title>
      <Empty description="DataX 同步功能开发中，敬请期待" style={{ marginTop: 80 }} />
    </div>
  )
}
