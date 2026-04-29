# Docker 启动命令

所有命令需在项目根目录执行：
```bash
cd /Users/ledi/myspace/big-data-platform
```

## 启动服务

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

## 查看日志

```bash
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f airflow-webserver
```

## 停止/重启

```bash
# 重启单个服务
docker-compose restart backend

# 停止所有服务
docker-compose stop

# 停止并删除容器
docker-compose down
```

## 端口映射

| 服务 | 端口 | 地址 |
|------|------|------|
| 前端 | 3000 | http://localhost:3000 |
| 后端 | 8000 | http://localhost:8000 |
| Airflow | 8080 | http://localhost:8080 |
| PostgreSQL | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |
