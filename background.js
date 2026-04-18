chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (details.url.includes("https://us-central1-neetcode-dd170.cloudfunctions.net/executeCodeFunction")) {
        if (details.requestBody && details.requestBody.raw) {
            const requestBody = details.requestBody;
            const buffer = requestBody.raw[0].bytes;
            // rest of the logic
            const uint8Array = new Uint8Array(buffer);
            const decoder = new TextDecoder('utf-8');
            const decodedString = decoder.decode(uint8Array);
            const data = JSON.parse(decodedString);
            const title = data.data.problemId;
            const code = data.data.rawCode;

            if (details.tabId >= 0) {
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
            }
        }
    }
},
    { urls: ["https://us-central1-neetcode-dd170.cloudfunctions.net/*"] },
    ["requestBody"]
);

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: "MANUAL_TRIGGER" });
});
