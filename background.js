// GLOBAL (top of background.js)
const pendingCodeByTab = {};

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.url.includes("executeCodeFunctionHttp")) {
            if (details.requestBody && details.requestBody.raw) {
                try {
                    const buffer = details.requestBody.raw[0].bytes;

                    // Decode request body
                    const uint8Array = new Uint8Array(buffer);
                    const decoder = new TextDecoder('utf-8');
                    const decodedString = decoder.decode(uint8Array);

                    const parsed = JSON.parse(decodedString);

                    // Updated structure (no more data.data)
                    const data = parsed.data || parsed;

                    const title = data.problemId;
                    const code = data.rawCode;

                    if (details.tabId >= 0) {
                        // Store safely per tab
                        pendingCodeByTab[details.tabId] = { title, code };                        
                    }
                } catch (err) {
                    console.log("Failed to parse request body:", err);
                }
            }
        }
    },
    {
        urls: ["https://neetcode.io/api/*"] // updated filter
    },
    ["requestBody"]
);

chrome.webRequest.onCompleted.addListener(
    (details) => {
        if (!details.url.includes("githubFunctionHttp")) return;

        const tabId = details.tabId;
        if (tabId < 0) return;

        try {
            const stored = pendingCodeByTab[tabId];
            if (!stored) return;

            const { title, code } = stored;

            chrome.tabs.sendMessage(details.tabId, {
                type: 'CODE_DATA',
                title: title,
                code: code
            }, () => {
                if (chrome.runtime.lastError) {
                    // Ignore this instead of treating as fatal
                    console.log("No receiver (safe to ignore):", chrome.runtime.lastError.message);
                }
            });

            // Cleanup to avoid stale data
            delete pendingCodeByTab[tabId];
        } catch (err) {
            console.log("Failed to send request:", err);
        }
    },
    { urls: ["https://neetcode.io/api/*"] }
);

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: "MANUAL_TRIGGER" });
});
