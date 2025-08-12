#!/bin/bash

# Script to switch between development and production environments
# This script helps manage environment-specific configurations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning "No .env file found. Creating one from development template..."
    cp backend/dev.env.example .env
    print_status "Created .env file from development template"
fi

# Function to show current environment
show_current_env() {
    if [ -f ".env" ]; then
        ENV=$(grep "^ENVIRONMENT=" .env | cut -d'=' -f2)
        DB_SCHEMA=$(grep "^DB_SCHEMA=" .env | cut -d'=' -f2)
        DB_TABLE=$(grep "^DB_TABLE=" .env | cut -d'=' -f2)
        
        echo ""
        print_info "Current Environment Configuration:"
        echo "  Environment: $ENV"
        echo "  Database Schema: $DB_SCHEMA"
        echo "  Database Table: $DB_TABLE"
        echo ""
    else
        print_error "No .env file found"
    fi
}

# Function to switch to development
switch_to_dev() {
    print_info "Switching to development environment..."
    
    # Backup current .env if it exists
    if [ -f ".env" ]; then
        cp .env .env.backup
        print_status "Backed up current .env to .env.backup"
    fi
    
    # Create development .env
    cp backend/dev.env.example .env
    
    # Update with actual development values
    sed -i.bak 's/user:password/your_dev_user:your_dev_password/g' .env
    sed -i.bak 's/chatgpt_products/your_dev_database/g' .env
    
    print_status "Switched to development environment"
    print_warning "Please update .env with your actual development database credentials"
    
    show_current_env
}

# Function to switch to production
switch_to_prod() {
    print_info "Switching to production environment..."
    
    # Backup current .env if it exists
    if [ -f ".env" ]; then
        cp .env .env.backup
        print_status "Backed up current .env to .env.backup"
    fi
    
    # Create production .env
    cp backend/prod.env.example .env
    
    print_status "Switched to production environment"
    print_warning "Please update .env with your actual production database credentials"
    
    show_current_env
}

# Function to restore backup
restore_backup() {
    if [ -f ".env.backup" ]; then
        print_info "Restoring from backup..."
        cp .env.backup .env
        print_status "Restored .env from backup"
        show_current_env
    else
        print_error "No backup file found"
    fi
}

# Function to show help
show_help() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  dev          Switch to development environment"
    echo "  prod         Switch to production environment"
    echo "  current      Show current environment configuration"
    echo "  restore      Restore .env from backup"
    echo "  help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 dev       # Switch to development"
    echo "  $0 prod      # Switch to production"
    echo "  $0 current   # Show current config"
}

# Main script logic
case "${1:-help}" in
    "dev")
        switch_to_dev
        ;;
    "prod")
        switch_to_prod
        ;;
    "current")
        show_current_env
        ;;
    "restore")
        restore_backup
        ;;
    "help"|*)
        show_help
        ;;
esac
