# 部署命令

所有命令需在项目根目录执行：
```bash
cd /Users/ledi/myspace/big-data-platform
```

---

## 一、Docker 部署

### 首次启动
```bash
# 复制环境变量文件
cp .env.example .env

# 启动所有服务
docker-compose up -d
```

### 启动服务
```bash
# 启动所有服务
docker-compose up -d

# 单独启动后端
docker-compose up -d backend

# 单独启动前端
docker-compose up -d frontend

# 启动基础设施
docker-compose up -d postgres redis

# 启动 Airflow 调度
docker-compose up -d airflow-webserver airflow-scheduler airflow-worker
```

### 重新构建（代码更新后）
```bash
# 重新构建并启动后端
docker-compose up -d --build backend

# 重新构建并启动前端
docker-compose up -d --build frontend

# 重新构建所有服务
docker-compose up -d --build
```

### 查看日志
```bash
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f airflow-webserver
```

### 停止/重启
```bash
# 重启单个服务
docker-compose restart backend

# 停止所有服务
docker-compose stop

# 停止并删除容器
docker-compose down

# 停止并删除容器和数据卷（慎用，会清除数据）
docker-compose down -v
```

---

## 二、本地部署（开发调试用）

> 代码在本地运行，PostgreSQL、Redis 等基础设施使用 Docker

### 1. 先启动基础设施
```bash
docker-compose up -d postgres redis
```

### 2. 启动后端
```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动开发服务器（热重载）
uvicorn app.main:app --reload --port 8000
```

### 3. 启动前端
```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（热重载）
npm run dev
```

### 4. 测试
```bash
# 后端测试
cd backend && pytest

# 前端构建检查
cd frontend && npm run build
```

---

## 三、端口映射

| 服务 | 端口 | 地址 |
|------|------|------|
| 前端 | 3000 | http://localhost:3000 |
| 后端 | 8000 | http://localhost:8000 |
| Airflow | 8080 | http://localhost:8080 |
| PostgreSQL | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |

---

## 四、常用排查命令

```bash
# 查看容器状态
docker-compose ps

# 进入容器
docker-compose exec backend bash
docker-compose exec frontend sh

# 查看容器资源使用
docker stats

# 清理未使用的镜像
docker image prune -f
```
