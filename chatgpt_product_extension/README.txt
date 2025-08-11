ChatGPT Product Extractor Extension (Queued)

1. Make sure your FastAPI backend is running at http://localhost:8000
   (or change INGEST_URL in background.js)

2. In Chrome:
   - Go to chrome://extensions
   - Enable Developer Mode (top right)
   - Click "Load unpacked"
   - Select this folder (chatgpt_product_extension)

3. Use ChatGPT with a prompt that generates a product carousel.
   The extension will capture it and POST to the backend /ingest.

4. View results:
   - Frontend UI: http://localhost:8000/
   - API JSON: http://localhost:8000/products
