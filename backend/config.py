"""
Configuration file for ChatGPT Product Scraper
Handles environment-based database and application settings
"""

import os
from typing import Dict, Any
from dotenv import load_dotenv

# Ensure .env is loaded before reading environment variables
load_dotenv()

# Load environment variables
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
DEBUG = ENVIRONMENT == "development"

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/chatgpt_products")

# Schema configuration based on environment
if ENVIRONMENT == "production":
    DB_SCHEMA = "internal"
    DB_TABLE = "products"
    DB_CONFIG = {
        "schema": DB_SCHEMA,
        "table": DB_TABLE,
        "full_name": f"{DB_SCHEMA}.{DB_TABLE}",
        "description": "Production database using internal schema"
    }
else:
    DB_SCHEMA = "public"
    DB_TABLE = "chatgpt_products"
    DB_CONFIG = {
        "schema": DB_SCHEMA,
        "table": DB_TABLE,
        "full_name": f"{DB_SCHEMA}.{DB_TABLE}",
        "description": "Development database using public schema"
    }

# Export full table name for convenience
FULL_TABLE_NAME = DB_CONFIG["full_name"]

# CORS Configuration
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://chat.openai.com,https://chatgpt.com").split(",")

# Security Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")

# Server Configuration
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Logging Configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO" if ENVIRONMENT == "production" else "DEBUG")

def get_database_info() -> Dict[str, Any]:
    """Get current database configuration information"""
    return {
        "environment": ENVIRONMENT,
        "database_schema": DB_SCHEMA,
        "database_table": DB_TABLE,
        "full_table_name": DB_CONFIG["full_name"],
        "database_url": DATABASE_URL.replace(DATABASE_URL.split("@")[0].split(":")[-1], "***") if "@" in DATABASE_URL else "***",
        "description": DB_CONFIG["description"]
    }

def is_production() -> bool:
    """Check if running in production environment"""
    return ENVIRONMENT == "production"

def is_development() -> bool:
    """Check if running in development environment"""
    return ENVIRONMENT == "development"

# Print configuration on startup
if __name__ == "__main__":
    print(f"🔧 Configuration loaded for {ENVIRONMENT} environment")
    print(f"📊 Database: {DB_CONFIG['full_name']}")
    print(f"🌐 CORS Origins: {', '.join(ALLOWED_ORIGINS)}")
    print(f"🔒 Secret Key: {'***' if is_production() else SECRET_KEY}")
else:
    # Print configuration when module is imported
    print(f"🚀 {ENVIRONMENT.upper()} mode: Using {DB_CONFIG['full_name']}")
