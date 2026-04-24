# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Big Data Platform (数据平台) - An enterprise-level data platform with SQL workbench, AI assistant, multi-datasource management, file upload/download, Airflow scheduling, and permission control.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Ant Design 5 + Monaco Editor |
| Backend | Python 3.11 + FastAPI + SQLAlchemy + Celery |
| Metadata DB | PostgreSQL 15 |
| Cache/Queue | Redis 7 |
| Scheduler | Apache Airflow 2.x |
| AI Service | OpenAI API (GPT-4) |
| Deployment | Docker Compose |

## Build and Development Commands

### Quick Start
```bash
# Copy environment file
cp .env.example .env

# Start all services
docker-compose up -d

# Backend only (development)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend only (development)
cd frontend
npm install
npm run dev
```

### Testing
```bash
# Backend tests
cd backend
pytest

# Frontend build check
cd frontend
npm run build
```

### Common Operations
```bash
# View logs
docker-compose logs -f backend
docker-compose logs -f airflow-webserver

# Restart services
docker-compose restart backend

# Database migrations (if using alembic)
cd backend
alembic upgrade head
```

## Architecture

### Directory Structure
```
big-data-platform/
├── docker-compose.yml          # Container orchestration
├── .env.example                # Environment variables template
├── backend/                    # FastAPI backend
│   ├── app/
│   │   ├── main.py            # FastAPI entry point
│   │   ├── core/              # Config, security, database
│   │   ├── api/v1/            # API routes
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   └── services/          # Business logic
│   └── tests/                 # Pytest tests
├── frontend/                   # React frontend
│   └── src/
│       ├── pages/             # Page components
│       ├── stores/            # Zustand state
│       └── services/          # API clients
└── airflow/                    # Airflow configuration
    └── dags/generated/        # Auto-generated DAGs
```

### Core Modules

1. **Authentication**: JWT-based auth with access/refresh tokens
2. **Data Sources**: Multi-database connector (MySQL, PostgreSQL, Oracle, Hive)
3. **SQL Workbench**: Monaco editor with execution, history, AI assist
4. **File Manager**: Upload/download Excel/CSV, import to database
5. **Scheduler**: Airflow DAG generation and deployment
6. **AI Assistant**: Text-to-SQL, SQL optimization, DAG generation
7. **Lineage**: SQL parsing for table dependencies

### API Endpoints

| Module | Endpoint | Description |
|--------|----------|-------------|
| Auth | `POST /api/v1/auth/login` | User login |
| Auth | `POST /api/v1/auth/register` | User registration |
| Users | `GET /api/v1/users/me` | Current user info |
| DataSources | `GET/POST /api/v1/datasources` | CRUD datasources |
| DataSources | `POST /api/v1/datasources/test` | Test connection |
| Queries | `POST /api/v1/queries/execute` | Execute SQL |
| Files | `POST /api/v1/files/upload` | Upload file |
| Schedules | `POST /api/v1/schedules` | Create schedule |
| AI | `POST /api/v1/ai/text-to-sql` | Natural language to SQL |
| Lineage | `POST /api/v1/lineage/parse` | Parse SQL lineage |

## Code Conventions

- Backend uses async/await with SQLAlchemy 2.0
- API responses use Pydantic models for validation
- Frontend state managed with Zustand
- All sensitive data (passwords) encrypted before storage
- SQL queries logged to history table
