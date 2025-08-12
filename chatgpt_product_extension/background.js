// background.js — service worker queue + retry for backend ingest

console.log("Service worker active");

const INGEST_URL = "http://localhost:8000/api/ingest";
EVENT_LOG_URL = "http://localhost:8000/api/event-log"

const QUEUE_KEY = 'ingest_queue';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// Fallback in-memory queue if storage is unavailable (e.g., "No SW")
let memoryQueue = [];

function storageAvailable() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

// Keep SW alive periodically
try {
  if (chrome.alarms) {
    chrome.alarms.create('keepalive', { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((a) => {
      if (a && a.name === 'keepalive') {
        console.log('keepalive');
      }
    });
  }
} catch (_) {}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);
  
  if (message.type === 'QUEUE_INGEST') {
    console.log("Queueing ingest payload:", message.payload);
    queueIngest(message.payload);
    sendResponse && sendResponse({ status: 'queued' });
  } else if (message.type === 'PING') {
    console.log("Ping received from:", sender.tab?.url);
    sendResponse && sendResponse({ status: 'pong', timestamp: Date.now() });
  } else if (message.type === 'SAVE_EVENT_LOG') {
    saveEventLog(message.payload).then((ok) => {
      sendResponse && sendResponse({ ok });
    });
    return true; // keep message channel open for async response
  }
});

async function saveEventLog(payload) {
  try {
    const res = await fetch(EVENT_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn('Event log save failed', res.status, await res.text());
      return false;
    }
    console.log('Event log saved');
    return true;
    } catch (e) {
    console.error('Event log error', e);
    return false;
  }
}

function payloadHash(p){
  try { return btoa(unescape(encodeURIComponent((p.conversation_id||'')+'|'+(p.raw_chatgpt_text||'').trim()))).slice(0,120); } catch(_) { return String(Date.now()); }
}

async function queueIngest(payload) {
  try {
    const queue = await getQueue();
    const ph = payloadHash(payload);
    const exists = queue.some(q => q.hash === ph);
    if (exists) {
      console.log('Duplicate payload suppressed (hash match)');
      return;
    }
    queue.push({ payload, retries: 0, timestamp: Date.now(), hash: ph });
    await saveQueue(queue);
    console.log("Payload queued, queue length:", queue.length);
    processQueue();
  } catch (error) {
    console.error("Error queueing payload:", error);
  }
}

async function getQueue() {
  try {
    if (!storageAvailable()) {
      console.warn('Storage not available, using in-memory queue');
      return memoryQueue;
    }
    const result = await chrome.storage.local.get(QUEUE_KEY);
    return result[QUEUE_KEY] || [];
  } catch (error) {
    console.error("Error getting queue:", error);
    return memoryQueue;
  }
}

async function saveQueue(queue) {
  try {
    if (!storageAvailable()) {
      memoryQueue = queue;
      return;
    }
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  } catch (error) {
    console.error("Error saving queue:", error);
    memoryQueue = queue;
  }
}

async function processQueue() {
  const queue = await getQueue();
  if (queue.length === 0) return;

  console.log("Processing queue, items:", queue.length);
  
  for (const item of [...queue]) {
    if (item.retries >= MAX_RETRIES) {
      console.log("Max retries reached for item:", item);
      continue;
    }

    try {
      console.log("Attempting to send payload to backend:", item.payload);
      console.log("Sending to URL:", INGEST_URL);
      
      const response = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload)
      });

      console.log("Backend response status:", response.status);
      
      if (response.ok) {
        const responseText = await response.text();
        console.log("Payload sent successfully, response:", responseText);
        const newQueue = (await getQueue()).filter(q => q !== item);
        await saveQueue(newQueue);
      } else {
        const errorText = await response.text();
        console.log("Backend error, will retry:", response.status, response.statusText, errorText);
        item.retries++;
        await saveQueue(queue);
      }
    } catch (error) {
      console.error("Error sending payload:", error);
      item.retries++;
      await saveQueue(queue);
    }
  }

  // Schedule next processing
  setTimeout(processQueue, RETRY_DELAY);
}

// Initialize persistent queue key if storage is available
(async () => {
  try {
    if (storageAvailable()) {
      const res = await chrome.storage.local.get(QUEUE_KEY);
      if (!res[QUEUE_KEY]) await chrome.storage.local.set({ [QUEUE_KEY]: [] });
    }
  } catch (_) {}
  processQueue();
  setInterval(processQueue, 10000); // Process every 10 seconds
})();
