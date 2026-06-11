import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Typography, List, Tag } from 'antd'
import {
  DatabaseOutlined,
  FileOutlined,
  ScheduleOutlined,
  CheckCircleOutlined,
  TagsOutlined,
  FilterOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import { datasourceApi, queryApi, scheduleApi, tagApi } from '../services/api'

const { Title } = Typography

export default function Dashboard() {
  const [stats, setStats] = useState({
    datasources: 0,
    queries: 0,
    schedules: 0,
    activeSchedules: 0,
    // 标签统计
    categoryCount: 0,
    tagCount: 0,
    taggedData: 0,
    ruleTagCount: 0,
  })
  const [recentQueries, setRecentQueries] = useState<any[]>([])

  useEffect(() => {
    loadStats()
    loadRecentQueries()
  }, [])

  const loadStats = async () => {
    try {
      const [dsRes, schedRes, tagRes] = await Promise.all([
        datasourceApi.listAll(),
        scheduleApi.list(),
        tagApi.getStatistics().catch(() => ({ data: {} })),
      ])

      setStats({
        datasources: dsRes.data.length,
        queries: 0,
        schedules: schedRes.data.length,
        activeSchedules: schedRes.data.filter((s: any) => s.status === 'active').length,
        // 标签统计
        categoryCount: tagRes.data?.category_count || 0,
        tagCount: tagRes.data?.tag_count || 0,
        taggedData: tagRes.data?.total_tagged_data || 0,
        ruleTagCount: tagRes.data?.rule_tag_count || 0,
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
              prefix={<DatabaseOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="调度任务"
              value={stats.schedules}
              prefix={<ScheduleOutlined style={{ color: '#722ed1' }} />}
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
              prefix={<FileOutlined style={{ color: '#13c2c2' }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* 标签统计 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="标签分类"
              value={stats.categoryCount}
              prefix={<FolderOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="标签数"
              value={stats.tagCount}
              prefix={<TagsOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="已打标数据"
              value={stats.taggedData}
              prefix={<DatabaseOutlined style={{ color: '#fa8c16' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="规则标签"
              value={stats.ruleTagCount}
              prefix={<FilterOutlined style={{ color: '#722ed1' }} />}
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
