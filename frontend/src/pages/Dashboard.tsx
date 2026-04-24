import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Typography, List, Tag } from 'antd'
import {
  DatabaseOutlined,
  FileOutlined,
  ScheduleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { datasourceApi, queryApi, scheduleApi } from '../services/api'

const { Title } = Typography

export default function Dashboard() {
  const [stats, setStats] = useState({
    datasources: 0,
    queries: 0,
    schedules: 0,
    activeSchedules: 0,
  })
  const [recentQueries, setRecentQueries] = useState<any[]>([])

  useEffect(() => {
    loadStats()
    loadRecentQueries()
  }, [])

  const loadStats = async () => {
    try {
      const [dsRes, schedRes] = await Promise.all([
        datasourceApi.listAll(),
        scheduleApi.list(),
      ])

      setStats({
        datasources: dsRes.data.length,
        queries: 0,
        schedules: schedRes.data.length,
        activeSchedules: schedRes.data.filter((s: any) => s.status === 'active').length,
      })
    } catch (error) {
      console.error('Failed to load stats', error)
    }
  }

  const loadRecentQueries = async () => {
    try {
      const res = await queryApi.getHistory(10)
      setRecentQueries(res.data)
    } catch (error) {
      console.error('Failed to load recent queries', error)
    }
  }

  return (
    <div>
      <Title level={4}>仪表盘</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="数据源"
              value={stats.datasources}
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="调度任务"
              value={stats.schedules}
              prefix={<ScheduleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="活跃调度"
              value={stats.activeSchedules}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="文件"
              value={0}
              prefix={<FileOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近查询" style={{ marginTop: 16 }}>
        <List
          dataSource={recentQueries}
          renderItem={(item: any) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <span>
                    {item.sql_content.substring(0, 100)}
                    {item.sql_content.length > 100 ? '...' : ''}
                  </span>
                }
                description={new Date(item.started_at).toLocaleString()}
              />
              <Tag color={item.status === 'success' ? 'green' : 'red'}>
                {item.status}
              </Tag>
            </List.Item>
          )}
          locale={{ emptyText: '暂无查询记录' }}
        />
      </Card>
    </div>
  )
}
