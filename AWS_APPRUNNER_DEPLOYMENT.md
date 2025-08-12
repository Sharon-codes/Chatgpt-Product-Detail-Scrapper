# AWS App Runner Deployment Guide for ChatGPT Product Scraper

## Overview
This guide will help you deploy your ChatGPT Product Scraper to AWS App Runner, which provides a fully managed service for running containerized applications.

## Prerequisites

### 1. AWS CLI Setup
```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure AWS CLI
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and preferred region
```

### 2. Required AWS Permissions
Ensure your AWS user/role has the following permissions:
- `AppRunnerFullAccess`
- `RDSFullAccess` (to read existing Aurora cluster)
- `SecretsManagerFullAccess`
- `EC2FullAccess` (for VPC configuration)

### 3. GitHub Repository
Push your code to a GitHub repository that App Runner can access.

### 4. Existing Aurora PostgreSQL Cluster
You already have an Aurora PostgreSQL cluster running with:
- **Cluster**: `siftly-geo-us-west-1` in `us-west-1` region
- **Endpoint**: `siftly-geo-us-west-1.global-gefsmpd1glge.global.rds.amazonaws.com`
- **Database**: `postgres`
- **Username**: `postgres`
- **Access**: Private VPC (requires security group configuration for App Runner)

## Step-by-Step Deployment

### Step 1: Prepare Your Code

1. **Update backend/main.py** (already done)
   - Added health check endpoints
   - Configured production CORS
   - Added environment variable handling

2. **Ensure requirements.txt is in the backend folder**
   - FastAPI, uvicorn, asyncpg, python-dotenv, pydantic

### Step 2: Configure Aurora Connection

1. **Update the deployment script** with your Aurora details:
```bash
# Edit deploy-apprunner.sh and update the password:
EXISTING_DB_PASSWORD="your-actual-password-here"
```

2. **Verify Aurora connectivity** from App Runner:
   - Your Aurora cluster is in `us-west-1` region
   - App Runner will be deployed in the same region for optimal connectivity
   - Ensure your Aurora security group allows connections from App Runner
   - App Runner runs in AWS-managed VPC, so you may need to:
     - Add App Runner's IP ranges to your Aurora security group, or
     - Use VPC peering for private communication

### Step 3: Create Secrets in AWS Secrets Manager

```bash
# Get your account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-west-1"  # Aurora is in us-west-1

# Use your existing Aurora endpoint
AURORA_ENDPOINT="siftly-geo-us-west-1.global-gefsmpd1glge.global.rds.amazonaws.com"

# Create database URL secret
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@$AURORA_ENDPOINT:5432/postgres"
aws secretsmanager create-secret \
    --name "chatgpt-scraper/database-url" \
    --description "Database connection string for ChatGPT Scraper" \
    --secret-string "$DATABASE_URL" \
    --region $REGION

# Create secret key
SECRET_KEY=$(openssl rand -base64 32)
aws secretsmanager create-secret \
    --name "chatgpt-scraper/secret-key" \
    --description "Secret key for ChatGPT Scraper" \
    --secret-string "$SECRET_KEY" \
    --region $REGION
```

### Step 4: Create App Runner Service

#### Option A: Using AWS Console (Recommended for first deployment)

1. Go to AWS App Runner console in `us-west-1` region
2. Click "Create service"
3. Choose "Source code repository"
4. Connect your GitHub repository
5. Configure the service:

**Build configuration:**
- Runtime: Python 3
- Build command: `pip install -r backend/requirements.txt`
- Start command: `cd backend && uvicorn main:app --host 0.0.0.0 --port 8000`
- Port: 8000

**Service configuration:**
- Service name: `chatgpt-product-scraper`
- CPU: 1 vCPU
- Memory: 2 GB

**Environment variables:**
- `ENVIRONMENT`: `production`
- `ALLOWED_ORIGINS`: `https://chat.openai.com,https://chatgpt.com`

**Secrets:**
- `DATABASE_URL`: `arn:aws:secretsmanager:us-west-1:ACCOUNT:secret:chatgpt-scraper/database-url`
- `SECRET_KEY`: `arn:aws:secretsmanager:us-west-1:ACCOUNT:secret:chatgpt-scraper/secret-key`

#### Option B: Using the Automated Script

```bash
# Make the script executable
chmod +x deploy-apprunner.sh

# Edit the script to add your Aurora password, then run:
./deploy-apprunner.sh
```

#### Option C: Using AWS CLI

```bash
# Create service in us-west-1 region
aws apprunner create-service \
    --service-name chatgpt-product-scraper \
    --region us-west-1 \
    --source-configuration '{
        "CodeRepository": {
            "CodeConfiguration": {
                "ConfigurationSource": "API",
                "ConfigurationValues": {
                    "Runtime": "PYTHON_3",
                    "BuildCommand": "pip install -r backend/requirements.txt",
                    "StartCommand": "cd backend && uvicorn main:app --host 0.0.0.0 --port 8000",
                    "Port": "8000"
                }
            },
            "RepositoryUrl": "YOUR_GITHUB_REPO_URL",
            "SourceCodeVersion": {
                "Type": "BRANCH",
                "Value": "main"
            }
        }
    }' \
    --instance-configuration '{
        "Cpu": "1024",
        "Memory": "2048"
    }'
```

### Step 5: Update Extension for Production

1. **Update manifest.json** with your App Runner URL:
```json
{
    "host_permissions": [
        "https://YOUR_SERVICE_NAME.us-west-1.apprunner.amazonaws.com/*"
    ],
    "content_scripts": [
        {
            "matches": [
                "https://chat.openai.com/*",
                "https://chatgpt.com/*",
                "https://YOUR_SERVICE_NAME.us-west-1.apprunner.amazonaws.com/*"
            ]
        }
    ]
}
```

2. **Update background.js** to use the production URL:
```javascript
const API_BASE_URL = 'https://YOUR_SERVICE_NAME.us-west-1.apprunner.amazonaws.com';
```

3. **Use the automated script:**
```bash
./update-extension-for-production.sh https://YOUR_SERVICE_NAME.us-west-1.apprunner.amazonaws.com
```

### Step 6: Test Deployment

1. **Check service status:**
```bash
aws apprunner describe-service \
    --service-name chatgpt-product-scraper \
    --region us-west-1
```

2. **Test health endpoint:**
```bash
curl https://YOUR_SERVICE_NAME.us-west-1.apprunner.amazonaws.com/health
```

3. **Test API endpoints:**
```bash
# Test ingest endpoint
curl -X POST https://YOUR_SERVICE_NAME.us-west-1.apprunner.amazonaws.com/api/ingest \
    -H "Content-Type: application/json" \
    -d '{"source": "test", "raw_chatgpt_text": "Test product"}'
```

## Post-Deployment Setup

### 1. Set up Monitoring
- Enable CloudWatch metrics for App Runner
- Set up alarms for errors and high latency
- Monitor Aurora performance metrics

### 2. Set up Logging
- App Runner automatically sends logs to CloudWatch
- Set up log retention policies
- Create log-based metrics and alarms

### 3. Security Considerations
- Ensure Aurora security groups allow App Runner connections
- Configure security groups to restrict access
- Use IAM roles instead of access keys where possible
- Enable VPC flow logs

### 4. Backup Strategy
- Your Aurora cluster should have automated backups enabled
- Set up cross-region backup replication if needed
- Test restore procedures regularly

## Troubleshooting

### Common Issues

1. **Build failures:**
   - Check requirements.txt syntax
   - Ensure all dependencies are available
   - Verify Python version compatibility

2. **Database connection issues:**
   - Verify security group allows App Runner to connect to Aurora
   - Check database credentials in Secrets Manager
   - Ensure Aurora cluster is running and accessible
   - Check if Aurora is in a private subnet that App Runner can't reach

3. **CORS issues:**
   - Verify ALLOWED_ORIGINS includes your domain
   - Check browser console for CORS errors

4. **Extension not working:**
   - Verify manifest.json has correct permissions
   - Check if extension is loaded in Chrome
   - Test API endpoints directly

### Aurora Connectivity Issues

If App Runner can't connect to your Aurora cluster:

1. **Check security groups:**
```bash
# Get your Aurora cluster security groups
aws rds describe-db-clusters \
    --db-cluster-identifier siftly-geo-us-west-1 \
    --region us-west-1 \
    --query 'DBClusters[0].VpcSecurityGroups[0].VpcSecurityGroupId' \
    --output text

# Check security group rules
aws ec2 describe-security-groups --group-ids sg-xxxxxxxxx --region us-west-1
```

2. **Add App Runner IP ranges** to your Aurora security group:
   - App Runner uses AWS-managed IP ranges
   - You may need to add these to your Aurora security group
   - Or use VPC peering for private communication

3. **Verify subnet configuration:**
   - Ensure Aurora is in a subnet that App Runner can reach
   - Check route tables and network ACLs

4. **Regional considerations:**
   - Aurora is in `us-west-1`
   - App Runner will be deployed in `us-west-1` for optimal connectivity
   - Ensure your AWS CLI is configured for the correct region

### Useful Commands

```bash
# View App Runner logs
aws apprunner describe-service --service-name chatgpt-product-scraper --region us-west-1

# Check Aurora cluster status
aws rds describe-db-clusters --db-cluster-identifier siftly-geo-us-west-1 --region us-west-1

# List secrets
aws secretsmanager list-secrets --region us-west-1

# Get service URL
aws apprunner describe-service \
    --service-name chatgpt-product-scraper \
    --region us-west-1 \
    --query 'Service.ServiceUrl' \
    --output text

# Test Aurora connectivity (from a machine that can reach it)
psql -h siftly-geo-us-west-1.global-gefsmpd1glge.global.rds.amazonaws.com -U postgres -d postgres -c "SELECT version();"
```

## Cost Optimization

- Use existing Aurora cluster (no additional database costs)
- Scale down App Runner instances during low usage
- Monitor CloudWatch metrics for resource utilization
- Use reserved instances for predictable workloads

## Next Steps

1. Set up CI/CD pipeline for automatic deployments
2. Implement blue-green deployments
3. Add custom domain with Route 53
4. Set up SSL certificates with ACM
5. Implement API rate limiting
6. Add authentication/authorization if needed

## Support

For AWS App Runner issues:
- Check AWS App Runner documentation
- Review CloudWatch logs and metrics
- Contact AWS Support if needed

For application-specific issues:
- Check application logs in CloudWatch
- Verify environment variables and secrets
- Test locally with the same configuration

For Aurora connectivity issues:
- Check security group configurations
- Verify network routing
- Consider using VPC peering for private communication
- Ensure both services are in the same region (us-west-1)
