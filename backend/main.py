import os
import asyncio
import json
from typing import Optional, Any, Dict, List
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import asyncpg
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from datetime import datetime
import re

# Import configuration
from config import (
    ENVIRONMENT, DATABASE_URL, ALLOWED_ORIGINS, 
    DB_SCHEMA, DB_TABLE, FULL_TABLE_NAME,
    get_database_info, is_production
)

load_dotenv()

app = FastAPI(title="ChatGPT Product Ingest API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

db_pool: Optional[asyncpg.pool.Pool] = None

class IngestPayload(BaseModel):
    source: str = "chatgpt-extension"
    conversation_id: Optional[str] = None
    product_object: Optional[Dict[str, Any]] = None
    raw_chatgpt_text: Optional[str] = ""
    merchant_default: Optional[str] = None
    price_text: Optional[str] = None
    price_numeric: Optional[float] = None
    delivery_by: Optional[str] = None
    free_delivery: Optional[bool] = None
    min_spend_for_free_delivery: Optional[float] = None
    geotags: Optional[Dict[str,Any]] = None
    heuristics: Optional[Dict[str,Any]] = None
    avg_rating: Optional[float] = None
    num_ratings: Optional[int] = None

class EventLogPayload(BaseModel):
    source: str = "chatgpt-extension"
    conversation_id: Optional[str] = None
    product_hint: Optional[str] = None
    clicked_at: Optional[str] = None  # ISO string
    events: List[Dict[str, Any]]

async def wait_for_db(uri: str, retries: int = 12, delay: float = 2.0):
    """Wait for Aurora PostgreSQL to be ready and return a pool with proper SSL."""
    last_exc = None
    
    # Parse the original URI and add SSL requirements for Aurora if not present
    if "sslmode=" not in uri:
        separator = "&" if "?" in uri else "?"
        uri = f"{uri}{separator}sslmode=require"
    
    for attempt in range(retries):
        try:
            pool = await asyncpg.create_pool(
                uri, 
                min_size=2, 
                max_size=15,  # Increased for Aurora
                command_timeout=60,  # 1 minute
                server_settings={
                    'application_name': 'chatgpt_product_scraper_aurora',
                    'statement_timeout': '120000',  # 2 minutes
                    'idle_in_transaction_session_timeout': '300000'  # 5 minutes
                }
            )
            
            # Test the connection
            async with pool.acquire() as conn:
                await conn.execute("SELECT 1")
            
            print(f"✅ Aurora connection established successfully on attempt {attempt + 1}")
            return pool
            
        except Exception as e:
            last_exc = e
            print(f"Database connection attempt {attempt + 1}/{retries} failed: {e}")
            if attempt < retries - 1:
                await asyncio.sleep(delay)
    
    print(f"❌ Failed to connect to Aurora after {retries} attempts")
    raise last_exc

@app.on_event("startup")
async def startup():
    global db_pool
    db_pool = await wait_for_db(DATABASE_URL)
    # Create table if missing
    sql_path = os.path.join(os.path.dirname(__file__), "db_init.sql")
    with open(sql_path, "r") as fh:
        sql = fh.read()
    async with db_pool.acquire() as conn:
        await conn.execute(sql)
    # Ensure event_logs directory exists under static
    event_dir = os.path.join(os.path.dirname(__file__), "static", "event_logs")
    os.makedirs(event_dir, exist_ok=True)

@app.on_event("shutdown")
async def shutdown():
    global db_pool
    if db_pool:
        await db_pool.close()

# -------------------------
# API ROUTES under /api
# -------------------------

@app.post("/api/ingest")
async def ingest(payload: IngestPayload):
    global db_pool
    if db_pool is None:
        raise HTTPException(503, "DB not ready")
    product_object = payload.product_object or {}
    raw_text = payload.raw_chatgpt_text or ""
    extras = {"heuristics": payload.heuristics or {}, "captured_schema_version": 1}

    product_id = None
    title = None
    if isinstance(product_object, dict):
        product_id = product_object.get("id") or product_object.get("product_id")
        title = product_object.get("title") or product_object.get("product_name")

    # Dynamic table reference based on environment
    query = f"""
    INSERT INTO {FULL_TABLE_NAME}
    (source, conversation_id, product_id, title, merchant_default, price_text, price_numeric, delivery_by, free_delivery, min_spend_for_free_delivery, avg_rating, num_ratings, geotags, product_object, raw_chatgpt_text, extras)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING id
    """
    
    # Convert JSONB fields to JSON strings
    geotags_json = json.dumps(payload.geotags) if payload.geotags else None
    product_object_json = json.dumps(product_object) if product_object else "{}"
    extras_json = json.dumps(extras) if extras else "{}"
    
    values = [
        payload.source,
        payload.conversation_id,
        product_id,
        title,
        payload.merchant_default,
        payload.price_text,
        payload.price_numeric,
        payload.delivery_by,
        payload.free_delivery,
        payload.min_spend_for_free_delivery,
        payload.avg_rating,
        payload.num_ratings,
        geotags_json,
        product_object_json,
        raw_text,
        extras_json
    ]

    async with db_pool.acquire() as conn:
        try:
            row = await conn.fetchrow(query, *values)
            return {"ok": True, "inserted_id": row["id"]}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/event-log")
async def save_event_log(payload: EventLogPayload):
    # sanitize filename
    ts = payload.clicked_at or datetime.utcnow().isoformat()
    safe_ts = re.sub(r"[^0-9T:_-]", "", ts).replace(":", "-")
    hint = (payload.product_hint or "product").strip().lower()[:60]
    hint = re.sub(r"[^a-z0-9_-]+", "-", hint) or "product"
    conv = (payload.conversation_id or "noid").strip()
    conv_safe = re.sub(r"[^a-zA-Z0-9_-]", "", conv) or "noid"

    event_dir = os.path.join(os.path.dirname(__file__), "static", "event_logs")
    os.makedirs(event_dir, exist_ok=True)
    fname = f"{safe_ts}__{conv_safe}__{hint}.json"
    fpath = os.path.join(event_dir, fname)

    data = {
        "source": payload.source,
        "conversation_id": payload.conversation_id,
        "product_hint": payload.product_hint,
        "clicked_at": ts,
        "events": payload.events,
    }
    try:
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(500, f"Failed to write event log: {e}")

    # Return public URL under static
    url_path = f"/event_logs/{fname}"
    return {"ok": True, "file": url_path, "filename": fname}

@app.get("/api/event-log/list")
async def list_event_logs():
    event_dir = os.path.join(os.path.dirname(__file__), "static", "event_logs")
    os.makedirs(event_dir, exist_ok=True)
    files = []
    try:
        for name in sorted(os.listdir(event_dir), reverse=True):
            if not name.endswith('.json'): continue
            full = os.path.join(event_dir, name)
            size = os.path.getsize(full)
            files.append({"name": name, "url": f"/event_logs/{name}", "size": size})
    except FileNotFoundError:
        pass
    return {"ok": True, "files": files}

@app.get("/health")
async def health_check():
    """Health check endpoint for App Runner"""
    try:
        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.execute("SELECT 1")
            return {
                "status": "healthy", 
                "database": "connected", 
                **get_database_info()
            }
        return {"status": "unhealthy", "database": "disconnected", "environment": ENVIRONMENT}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e), "environment": ENVIRONMENT}

@app.get("/")
async def root():
    """Root endpoint for App Runner health checks"""
    return {
        "message": "ChatGPT Product Scraper API", 
        "status": "running", 
        **get_database_info()
    }

@app.get("/test")
async def test_page():
    """Test page for the Chrome extension"""
    html_content = """
<!DOCTYPE html>
<html>
<head>
    <title>Extension Test Page</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
        .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .info { background-color: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        button { padding: 10px 20px; font-size: 16px; margin: 10px; }
        #console { background: #f8f9fa; padding: 10px; border: 1px solid #dee2e6; border-radius: 5px; margin: 10px 0; font-family: monospace; }
    </style>
</head>
<body>
    <h1>ChatGPT Extension Test Page</h1>
    <p>This page tests if the Chrome extension is working properly.</p>
    
    <div id="status"></div>
    
    <button onclick="testExtension()">Test Extension Communication</button>
    <button onclick="simulateChatGPT()">Simulate ChatGPT Product Response</button>
    <button onclick="clearConsole()">Clear Console</button>
    
    <div id="console"></div>

    <script>
        function log(message, type = 'info') {
            const consoleDiv = document.getElementById('console');
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.innerHTML = `<span style="color: #666;">[${timestamp}]</span> ${message}`;
            consoleDiv.appendChild(logEntry);
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }

        function clearConsole() {
            document.getElementById('console').innerHTML = '';
        }

        function updateStatus(message, type = 'info') {
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
        }

        function testExtension() {
            log('Testing extension communication...');
            
            // Check if chrome.runtime is available
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                log('✓ Chrome runtime available', 'success');
                updateStatus('Chrome runtime is available', 'success');
                
                // Test sending a message
                const testPayload = {
                    source: 'test-extension',
                    raw_chatgpt_text: 'Test product: iPhone 15 Pro - ₹1,49,900 from Amazon India'
                };
                
                log(`Sending test payload: ${JSON.stringify(testPayload)}`);
                
                chrome.runtime.sendMessage({ 
                    type: 'QUEUE_INGEST', 
                    payload: testPayload
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        log(`✗ Error: ${chrome.runtime.lastError.message}`, 'error');
                        updateStatus(`Extension error: ${chrome.runtime.lastError.message}`, 'error');
                    } else {
                        log(`✓ Message sent successfully: ${JSON.stringify(response)}`, 'success');
                        updateStatus('Extension communication working!', 'success');
                    }
                });
            } else {
                log('✗ Chrome runtime not available', 'error');
                updateStatus('Chrome runtime not available - extension may not be loaded', 'error');
            }
        }

        function simulateChatGPT() {
            log('Simulating ChatGPT product response...');
            
            // Simulate a ChatGPT-like response with product information
            const simulatedResponse = `
                Here are some great deals I found for you:
                
                📱 iPhone 15 Pro
                💰 Price: ₹1,49,900
                🏪 Available on: Amazon India
                ⭐ Rating: 4.5/5 (2,450 reviews)
                🚚 Free delivery on orders above ₹499
                
                💻 MacBook Air M2
                💰 Price: ₹1,14,900
                🏪 Available on: Flipkart
                ⭐ Rating: 4.7/5 (1,890 reviews)
                🚚 Free delivery
                
                These are excellent deals with great customer ratings!
            `;
            
            log(`Simulated response: ${simulatedResponse}`);
            
            // Check if extension can capture this
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                const payload = {
                    source: 'chatgpt-extension-simulation',
                    raw_chatgpt_text: simulatedResponse,
                    heuristics: {
                        urls: [],
                        price_text: '₹1,49,900, ₹1,14,900',
                        avg_rating: 4.5,
                        num_ratings: 2450
                    }
                };
                
                log(`Sending simulated payload to extension...`);
                chrome.runtime.sendMessage({ 
                    type: 'QUEUE_INGEST', 
                    payload: payload
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        log(`✗ Error sending simulated data: ${chrome.runtime.lastError.message}`, 'error');
                    } else {
                        log(`✓ Simulated data sent successfully: ${JSON.stringify(response)}`, 'success');
                    }
                });
            } else {
                log('Cannot send simulated data - extension not available', 'error');
            }
        }

        // Auto-test on page load
        window.addEventListener('load', () => {
            log('Page loaded, checking extension status...');
            setTimeout(testExtension, 1000);
        });
    </script>
</body>
</html>
    """
    return HTMLResponse(content=html_content)

# -------------------------
# STATIC FRONTEND
# -------------------------

# Mount static frontend at root AFTER ALL API routes are defined
app.mount("/", StaticFiles(directory="static", html=True), name="static")
