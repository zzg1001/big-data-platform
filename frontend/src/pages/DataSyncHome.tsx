import { useNavigate } from 'react-router-dom'
import { Card, Typography, Tag } from 'antd'
import { DatabaseOutlined } from '@ant-design/icons'
import pythonLogo from '../assets/python.svg'
import dataxLogo from '../assets/datax.svg'

const { Title, Paragraph } = Typography

// 同步方式卡片配置。新增同步方式（如 Flink、Kafka 同步）时在此追加一项即可
// icon: antd 图标节点（走色块底）；logo: 品牌 logo 图片地址（走白底，原色显示）
const syncTypes = [
  {
    key: 'db',
    title: '数据库同步',
    desc: '库到库的表数据同步：选源表、生成目标表 DDL、字段映射、定时调度。',
    icon: <DatabaseOutlined />,
    logo: undefined as string | undefined,
    color: '#1890ff',
    path: '/bigdata/data-sync/db',
    ready: true,
  },
  {
    key: 'script',
    title: '脚本同步（Python）',
    desc: '上传写好的 Python 程序（.py / .zip），生成 Airflow DAG 提交运行，可定时调度。',
    icon: undefined,
    logo: pythonLogo,
    color: '#3776AB',
    path: '/bigdata/data-sync/script',
    ready: false,
  },
  {
    key: 'datax',
    title: 'DataX 同步',
    desc: '基于 DataX 的异构数据源离线同步，配置 job.json 即可跑大批量数据同步。',
    icon: undefined,
    logo: dataxLogo,
    color: '#1f6feb',
    path: '/bigdata/data-sync/datax',
    ready: false,
  },
]

export default function DataSyncHome() {
  const navigate = useNavigate()
  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 4 }}>数据同步</Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>选择一种同步方式开始</Paragraph>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {syncTypes.map((t) => (
          <Card
            key={t.key}
            hoverable
            onClick={() => navigate(t.path)}
            style={{ width: 320 }}
            styles={{ body: { padding: 20 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  background: t.logo ? '#f5f7fa' : `${t.color}1a`,
                  color: t.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  flexShrink: 0,
                }}
              >
                {t.logo
                  ? <img src={t.logo} alt={t.title} style={{ width: 32, height: 32, objectFit: 'contain' }} />
                  : t.icon}
              </div>
              <div>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{t.title}</span>
                {!t.ready && <Tag color="orange" style={{ marginLeft: 8 }}>开发中</Tag>}
              </div>
            </div>
            <Paragraph type="secondary" style={{ marginBottom: 0, minHeight: 44 }}>
              {t.desc}
            </Paragraph>
          </Card>
        ))}
      </div>
    </div>
  )
}
