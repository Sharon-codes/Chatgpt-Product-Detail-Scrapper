#!/bin/bash

# Script to update Chrome extension for production deployment
# Usage: ./update-extension-for-production.sh YOUR_APPRUNNER_URL

if [ $# -eq 0 ]; then
    echo "Usage: $0 <APPRUNNER_URL>"
    echo "Example: $0 https://chatgpt-product-scraper.us-east-1.apprunner.amazonaws.com"
    exit 1
fi

APPRUNNER_URL=$1
SERVICE_NAME=$(echo $APPRUNNER_URL | sed 's|https://||' | sed 's|\..*||')
REGION=$(echo $APPRUNNER_URL | grep -o 'us-east-1\|us-west-2\|eu-west-1\|ap-southeast-1' || echo "us-east-1")

echo "🔄 Updating Chrome extension for production deployment"
echo "App Runner URL: $APPRUNNER_URL"
echo "Service Name: $SERVICE_NAME"
echo "Region: $REGION"

# Create production manifest
cat > chatgpt_product_extension/manifest.production.json << EOF
{
    "manifest_version": 3,
    "name": "ChatGPT Product Extractor",
    "version": "1.1",
    "permissions": ["storage", "activeTab", "scripting"],
    "background": {
      "service_worker": "background.js"
    },
    "content_scripts": [
      {
        "matches": [
          "https://chat.openai.com/*",
          "https://chatgpt.com/*",
          "$APPRUNNER_URL/*"
        ],
        "js": ["content.js"]
      }
    ],
    "web_accessible_resources": [
      {
        "resources": ["injected.js"],
        "matches": [
          "https://chat.openai.com/*",
          "https://chatgpt.com/*",
          "$APPRUNNER_URL/*"
        ]
      }
    ],
    "host_permissions": [
      "$APPRUNNER_URL/*"
    ]
}
EOF

echo "✅ Created production manifest: chatgpt_product_extension/manifest.production.json"

# Create production background.js
cat > chatgpt_product_extension/background.production.js << EOF
// Production version of background.js
const API_BASE_URL = '$APPRUNNER_URL';

// ... existing background.js code should be copied here ...
// Make sure to replace any localhost:8000 references with API_BASE_URL
EOF

echo "✅ Created production background.js: chatgpt_product_extension/background.production.js"

# Create production content.js
cat > chatgpt_product_extension/content.production.js << EOF
// Production version of content.js
const API_BASE_URL = '$APPRUNNER_URL';

// ... existing content.js code should be copied here ...
// Make sure to replace any localhost:8000 references with API_BASE_URL
EOF

echo "✅ Created production content.js: chatgpt_product_extension/content.production.js"

# Create production injected.js
cat > chatgpt_product_extension/injected.production.js << EOF
// Production version of injected.js
const API_BASE_URL = '$APPRUNNER_URL';

// ... existing injected.js code should be copied here ...
// Make sure to replace any localhost:8000 references with API_BASE_URL
EOF

echo "✅ Created production injected.js: chatgpt_product_extension/injected.production.js"

echo ""
echo "🎯 Next steps:"
echo "1. Copy your existing extension code to the .production.js files"
echo "2. Replace all localhost:8000 references with API_BASE_URL"
echo "3. Test the production extension locally"
echo "4. Package and distribute to your team"
echo ""
echo "📦 To package the extension:"
echo "cd chatgpt_product_extension"
echo "zip -r ../chatgpt-product-scraper-production.zip ."
echo ""
echo "🔧 To install in Chrome:"
echo "1. Go to chrome://extensions/"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked' and select the chatgpt_product_extension folder"
echo "4. Or load the .zip file directly"
