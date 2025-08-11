// content.js — captures ChatGPT product_info SSE patches and sends payloads to background for queued ingestion.

console.log("=== CONTENT SCRIPT STARTING ===");
console.log("content.js loaded on", window.location.href);

try {
  (() => {
    console.log("=== IIFE STARTING ===");

    // Inject page-context script so we can intercept window.fetch/XMLHttpRequest in the page
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.type = 'text/javascript';
      script.onload = () => { script.remove(); };
      (document.head || document.documentElement).appendChild(script);
      console.log('Injected page script');
    } catch (e) {
      console.error('Failed to inject page script', e);
    }
    
    const originalFetch = window.fetch.bind(window);
    console.log("Original fetch captured:", typeof originalFetch);
  
    // Resilient forwarding of event logs to SW
    const RETRY_MS = 2000;
    let pendingEventLogs = [];
    let retryTimer = null;

    function scheduleRetry() {
      if (retryTimer) return;
      retryTimer = setInterval(tryFlushEventLogs, RETRY_MS);
    }

    function tryFlushEventLogs() {
      if (!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)) return;
      if (pendingEventLogs.length === 0) {
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        return;
      }
      const item = pendingEventLogs[0];
      try {
        chrome.runtime.sendMessage({ type: 'SAVE_EVENT_LOG', payload: item }, (resp) => {
          if (chrome.runtime.lastError) {
            // keep in queue; will retry
            return;
          }
          // success -> pop and continue
          pendingEventLogs.shift();
          if (pendingEventLogs.length === 0 && retryTimer) {
            clearInterval(retryTimer); retryTimer = null;
          }
        });
      } catch (e) {
        // keep item and retry later
      }
    }

    // Bridge: accept messages from the page (window) and forward to background
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'PING') {
        window.postMessage({ type: 'PONG', timestamp: Date.now() }, '*');
      } else if (data.type === 'QUEUE_INGEST') {
        try {
          sendToBg(data.payload || {});
          window.postMessage({ type: 'QUEUED', ok: true }, '*');
        } catch (e) {
          window.postMessage({ type: 'QUEUED', ok: false, error: String(e) }, '*');
        }
      } else if (data.type === 'SAVE_EVENT_LOG') {
        try {
          // queue and attempt immediate flush
          pendingEventLogs.push(data.payload);
          tryFlushEventLogs();
          scheduleRetry();
        } catch (e) {
          console.error('Event log forwarding error (queued):', e);
          scheduleRetry();
        }
      }
    });

    function applyJsonPatch(doc, patch) {
      if (!patch || typeof patch !== 'object') return;
      const path = patch.p || "";
      const op = patch.o;
      const value = patch.v;
  
      if (path === "" || path === "/") {
        if (op === 'append' && typeof value === 'object') {
          Object.assign(doc, value);
        }
        return;
      }
  
      const parts = path.split('/').slice(1);
      let parent = doc;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (parent[p] === undefined) {
          parent[p] = /^\d+$/.test(parts[i+1]) ? [] : {};
        }
        parent = parent[p];
        if (parent === undefined) return;
      }
      const final = parts[parts.length - 1];
  
      if (op === 'add' || op === 'replace') {
        parent[final] = value;
      } else if (op === 'append') {
        if (Array.isArray(parent[final])) parent[final].push(...(Array.isArray(value) ? value : [value]));
        else if (typeof parent[final] === 'string') parent[final] += value;
        else parent[final] = value;
      } else if (op === 'remove') {
        if (Array.isArray(parent)) {
          const idx = parseInt(final, 10);
          if (!isNaN(idx)) parent.splice(idx, 1);
        } else {
          delete parent[final];
        }
      } else if (op === 'truncate') {
        if (Array.isArray(parent[final]) && typeof value === 'number') parent[final].length = value;
      }
    }
  
    function fallbackParseResponseText(text) {
      const urls = Array.from(text.matchAll(/https?:\/\/[^\s)]+/g)).map(m => m[0]);
      const priceMatch = text.match(/₹\s?\d{1,3}(?:[.,]\d{2})?/g) || text.match(/\b\d{1,3}(?:[.,]\d{2})?\s?(INR|₹)\b/g);
      const ratingMatch = text.match(/([0-5](?:\.\d)?)\s*(?:out of|\/)\s*5|([0-5](?:\.\d)?)(?=\s*stars)/i);
      const reviewsMatch = text.match(/(\d[\d,]*)\s*(?:reviews|ratings)/i);
      const freeDeliveryMatch = text.match(/Spend\s*[₹]?([\d,]+)\s*for free delivery/i);
      return {
        urls,
        price_text: priceMatch ? priceMatch[0] : null,
        avg_rating: ratingMatch ? (ratingMatch[1] || ratingMatch[2]) : null,
        num_ratings: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g,''),10) : null,
        min_spend_for_free_delivery: freeDeliveryMatch ? parseInt(freeDeliveryMatch[1].replace(/,/g,''),10) : null
      };
    }
  
    function sendToBg(payload) {
      console.log("Sending to background:", payload);
      try {
        // Check if chrome.runtime is available
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'QUEUE_INGEST', payload }, (response) => {
            if (chrome.runtime.lastError) {
              console.error("Chrome runtime error:", chrome.runtime.lastError);
            } else {
              console.log("Message sent to background successfully:", response);
            }
          });
        } else {
          console.error("Chrome runtime not available");
        }
      } catch (error) {
        console.error("Error sending to background:", error);
      }
    }
  
    // Keep existing network logging in content world for auxiliary checks
    console.log("=== SETTING UP FETCH INTERCEPTOR ===");
    
    // Monitor XMLHttpRequest for older API calls (FIXED: removed duplicate override)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._url = url;
      return originalXHROpen.call(this, method, url, ...args);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
      return originalXHRSend.call(this, ...args);
    };
    
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      return response;
    };
    
    // Retry on tab focus
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tryFlushEventLogs();
    });

    console.log("=== CONTENT SCRIPT READY ===");
    
  })();
} catch (error) {
  console.error("=== CONTENT SCRIPT ERROR ===", error);
}
  