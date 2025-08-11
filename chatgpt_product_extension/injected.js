// injected.js — runs in the page context to intercept ChatGPT network calls
(function() {
  try {
    console.log("=== INJECTED SCRIPT START ===", location.href);

    const originalFetch = window.fetch.bind(window);
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    function sendToContent(payload) {
      window.postMessage({ type: 'QUEUE_INGEST', payload }, '*');
    }

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
        if (parent[p] === undefined) parent[p] = /^\d+$/.test(parts[i+1]) ? [] : {};
        parent = parent[p];
        if (parent === undefined) return;
      }
      const final = parts[parts.length - 1];
      if (op === 'add' || op === 'replace') parent[final] = value;
      else if (op === 'append') {
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

    function extractHeuristics(text) {
      const urls = Array.from(text.matchAll(/https?:\/\/[^\s)]+/g)).map(m => m[0]);
      const priceMatch = text.match(/(?:₹|INR|Rs\.?|USD|\$)\s?\d{1,3}(?:[\d,]*)(?:[.,]\d{2})?/i);
      const ratingMatch = text.match(/([0-5](?:\.\d)?)\s*(?:out of|\/|of)\s*5|([0-5](?:\.\d)?)(?=\s*stars)/i);
      const reviewsMatch = text.match(/(\d[\d,]*)\s*(?:reviews|ratings)/i);
      const freeDeliveryMatch = text.match(/free\s+delivery|Spend\s*[₹$]?([\d,]+)\s*for\s*free\s*delivery/i);
      let merchant = null;
      if (/amazon/i.test(text)) merchant = 'Amazon';
      else if (/flipkart/i.test(text)) merchant = 'Flipkart';
      else if (/myntra/i.test(text)) merchant = 'Myntra';
      else if (/best\s*buy/i.test(text)) merchant = 'Best Buy';
      else if (/walmart/i.test(text)) merchant = 'Walmart';

      const priceText = priceMatch ? priceMatch[0] : null;
      const priceNumeric = priceText ? parseFloat(priceText.replace(/[^\d.]/g, '')) : null;
      const minSpendMatch = text.match(/Spend\s*[₹$]?([\d,]+)\s*for\s*free\s*delivery/i);

      return {
        urls,
        price_text: priceText,
        price_numeric: priceNumeric || null,
        avg_rating: ratingMatch ? parseFloat((ratingMatch[1] || ratingMatch[2])) : null,
        num_ratings: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g,''),10) : null,
        free_delivery: !!freeDeliveryMatch,
        min_spend_for_free_delivery: minSpendMatch ? parseInt(minSpendMatch[1].replace(/,/g,''),10) : null,
        merchant_default: merchant
      };
    }

    // =================== DEBOUNCED CONVERSATION AGGREGATOR ===================
    let aggregateTimer = null;
    const MIN_SEND_INTERVAL_MS = 2500; // throttle
    const lastSentByConversation = new Map(); // convId -> { hash, at }

    function getConversationIdFromUrl() {
      const m = location.pathname.match(/\/(c|conversation)\/([a-zA-Z0-9-]+)/);
      return m ? m[2] : null;
    }

    function normalizeText(s) {
      return (s || '')
        .replace(/[\u2605\u2729\u2730\u2736\u2737]/g, '*')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isNoiseLine(line) {
      const l = line.trim();
      if (!l) return true;
      const noisePatterns = [
        /^(Get\s*Plus|Introducing\s+GPT|ChatGPT\s+now\s+has|Temporary\s+Chat)/i,
        /(ChatGPT can make mistakes|Cookie Preferences)/i,
        /(window\.__oai|__SSR_|requestAnimationFrame)/i,
        /^Share$/i,
        /^You said:/i,
        /^Searching the web$/i,
      ];
      return noisePatterns.some(rx => rx.test(l));
    }

    function dedupeAndClean(text) {
      const lines = text.split(/\r?\n/);
      const out = [];
      const seen = new Set();
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (isNoiseLine(line)) continue;
        if (line.length < 2 && !/[₹$\d]/.test(line)) continue;
        const key = line.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
      }
      return out.join('\n');
    }

    function collectAssistantTexts() {
      const texts = [];
      const assistantNodes = document.querySelectorAll('[data-message-author-role="assistant"]');
      assistantNodes.forEach(node => {
        const content = node.querySelector('.markdown, .prose, [data-message-content="true"], article, div');
        const raw = (content ? content.innerText : node.innerText) || '';
        const cleaned = dedupeAndClean(raw);
        if (cleaned && cleaned.length > 20) texts.push(cleaned);
      });
      return texts;
    }

    function collectConversationText() {
      const parts = collectAssistantTexts();
      return parts.join('\n\n');
    }

    function djb2Hash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) + str.charCodeAt(i);
        h = h & 0xffffffff;
      }
      return h >>> 0;
    }

    function scheduleAggregate() {
      if (aggregateTimer) clearTimeout(aggregateTimer);
      aggregateTimer = setTimeout(runAggregate, 900);
    }

    function runAggregate() {
      try {
        const conversationId = getConversationIdFromUrl() || 'no-id';
        const fullTextRaw = collectConversationText();
        const fullText = normalizeText(fullTextRaw);
        if (!fullText || fullText.length < 40) return;

        const now = Date.now();
        const last = lastSentByConversation.get(conversationId);
        const hash = djb2Hash(fullText + '|' + conversationId);
        if (last && last.hash === hash && now - last.at < 60000) {
          return; // identical within 60s window
        }
        if (last && now - last.at < MIN_SEND_INTERVAL_MS) {
          return; // throttled
        }

        const assistantParts = collectAssistantTexts();
        const lastAssistant = assistantParts.length ? assistantParts[assistantParts.length - 1] : null;
        const heur = extractHeuristics(normalizeText(lastAssistant || fullText));

        const payload = {
          source: 'chatgpt-extension-conversation-aggregate',
          conversation_id: conversationId,
          raw_chatgpt_text: fullText,
          heuristics: {
            urls: heur.urls,
            price_text: heur.price_text,
            avg_rating: heur.avg_rating,
            num_ratings: heur.num_ratings,
            free_delivery: heur.free_delivery,
            min_spend_for_free_delivery: heur.min_spend_for_free_delivery
          },
          merchant_default: heur.merchant_default || null,
          price_text: heur.price_text || null,
          price_numeric: heur.price_numeric || null,
          free_delivery: heur.free_delivery
        };
        console.log('[Injected] Aggregate sending payload, chars:', fullText.length);
        sendToContent(payload);

        lastSentByConversation.set(conversationId, { hash, at: now });
      } catch (e) {}
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          scheduleAggregate();
          break;
        }
      }
    });

    // ====== Carousel click capture + scoped SSE recording ======
    let captureActive = false;
    let captureExpiresAt = 0;
    let captureHint = null;
    let captureConv = null;
    let selectedPatchObjects = [];
    let entityModeUntil = 0;
    const CAPTURE_MS = 30000; // extended window after click

    function postEventLogViaBridge(payload){
      try {
        window.postMessage({ type: 'SAVE_EVENT_LOG', payload }, '*');
      } catch(_){}
    }

    function startSseCapture(productHint, conversationId){
      captureActive = true;
      captureExpiresAt = Date.now() + CAPTURE_MS;
      captureHint = productHint;
      captureConv = conversationId;
      selectedPatchObjects = [];
      entityModeUntil = 0;
      setTimeout(() => { flushSseCapture(); }, CAPTURE_MS + 300);
    }

    function flushSseCapture(){
      if (!captureActive) return;
      captureActive = false;
      // Save exactly the patch objects user wants (array of {o:'patch', v:[...]})
      const events = selectedPatchObjects;
      postEventLogViaBridge({
        source: 'chatgpt-extension',
        conversation_id: captureConv,
        product_hint: captureHint,
        clicked_at: new Date().toISOString(),
        events
      });
      selectedPatchObjects = [];
      entityModeUntil = 0;
    }

    function startCarouselCapture(){
      window.addEventListener('click', (e) => {
        try {
          const el = e.target instanceof HTMLElement ? e.target.closest('a, button, [role="button"], [data-testid], [data-carousel-item]') : null;
          if (!el) return;
          const text = (el.innerText || '').trim();
          const productHint = text.split('\n').slice(0,3).join(' ').slice(0,200);
          const isCarousel = /carousel|Explore|cards|slider|horizontal/i.test(el.outerHTML) || el.hasAttribute('data-carousel-item');
          if (!isCarousel && productHint.length < 5) return;
          const conversationId = (location.pathname.match(/\/(c|conversation)\/([a-zA-Z0-9-]+)/) || [])[2] || null;
          startSseCapture(productHint, conversationId);
        } catch(_){}
      }, true);

      console.log('=== CAROUSEL CLICK CAPTURE ACTIVE ===');
    }

    // Scoped fetch wrapper for product_info SSE only
    window.fetch = async (...args) => {
      const url = args[0];
      const resp = await originalFetch(...args);
      try {
        if (captureActive && typeof url === 'string' && /\/backend-api\/(?:lat|search)\/product_info/.test(url)) {
          const cloned = resp.clone();
          if (cloned.body && cloned.body.getReader) {
            const reader = cloned.body.getReader();
            const decoder = new TextDecoder();
            let acc = '';
            (async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (!captureActive || Date.now() > captureExpiresAt) break;
                  acc += decoder.decode(value, { stream: true });
                  const chunks = acc.split('\n\n');
                  acc = chunks.pop();
                  for (const c of chunks) {
                    const line = c.split('\n').find(l => l.startsWith('data:'));
                    if (!line) continue;
                    const dataStr = line.substring(5).trim();
                    if (!dataStr || dataStr === '[DONE]') continue;
                    try {
                      const parsed = JSON.parse(dataStr);
                      const patches = Array.isArray(parsed.v) ? parsed.v : [];
                      const hasEntity = patches.some(p => p && p.p === '/type' && p.o === 'replace' && p.v === 'product_entity');
                      if (hasEntity) {
                        entityModeUntil = Date.now() + 8000;
                      }
                      if (hasEntity || Date.now() < entityModeUntil) {
                        const filtered = patches.filter(p => {
                          if (!p) return false;
                          const isType = p.p === '/type' && p.o === 'replace' && p.v === 'product_entity';
                          const isAppendRoot = (p.p === '' || p.p === '/') && p.o === 'append';
                          const isDataRemove = p.p === '/data' && p.o === 'remove';
                          return isType || isAppendRoot || isDataRemove;
                        });
                        if (filtered.length) {
                          selectedPatchObjects.push({ o: 'patch', v: filtered });
                        }
                      }
                    } catch(_) {}
                  }
                }
              } catch(_) {}
              finally { flushSseCapture(); }
            })();
          }
        }
      } catch(_) {}
      return resp;
    };

    function startDomObserver() {
      const root = document.body || document.documentElement;
      if (!root) return;
      observer.observe(root, { childList: true, subtree: true });
      scheduleAggregate();
      startCarouselCapture();
      console.log('=== INJECTED DOM OBSERVER ACTIVE ===');
    }

    // Do not monkey-patch XHR to avoid affecting site
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      return originalXHROpen.call(this, method, url, ...args);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      return originalXHRSend.call(this, ...args);
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', startDomObserver);
      
    } else {
      startDomObserver();
    }

    console.log("=== INJECTED SCRIPT READY ===");
  } catch (e) {
    console.error("Injected script error", e);
  }
})();
