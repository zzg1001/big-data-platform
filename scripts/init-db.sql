-- Initialize databases for the Big Data Platform

-- Create airflow database
CREATE DATABASE airflow;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE airflow TO admin;
