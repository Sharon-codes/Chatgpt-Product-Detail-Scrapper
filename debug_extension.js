// Debug script to check extension status
console.log("=== EXTENSION DEBUG SCRIPT LOADED ===");

// Check if we're in a Chrome extension context
console.log("Window location:", window.location.href);
console.log("Chrome object available:", typeof chrome !== 'undefined');
console.log("Chrome runtime available:", typeof chrome !== 'undefined' && chrome.runtime ? 'Yes' : 'No');

if (typeof chrome !== 'undefined' && chrome.runtime) {
    console.log("Extension ID:", chrome.runtime.id);
    console.log("Extension URL:", chrome.runtime.getURL(''));
    
    // Test if we can send messages
    try {
        chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
            } else {
                console.log("Ping response:", response);
            }
        });
    } catch (error) {
        console.error("Error sending ping:", error);
    }
} else {
    console.error("Chrome runtime not available - extension may not be loaded");
}

// Check for content script injection
console.log("Content script loaded at:", new Date().toISOString());
console.log("Document ready state:", document.readyState);
