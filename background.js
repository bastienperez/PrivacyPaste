const API_TIMEOUT_MS = 10000;
const MAX_RETRIES = 1;

const DEFAULTS = {
  analyzerUrl: "http://localhost:5002",
  anonymizerUrl: "http://localhost:5001",
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "anonymize") {
    handleAnonymize(message.text).then(sendResponse);
    return true;
  }

  if (message.action === "testConnection") {
    handleTestConnection(message.analyzerUrl, message.anonymizerUrl).then(sendResponse);
    return true;
  }
});

async function getSettings() {
  return chrome.storage.sync.get({ enabled: true, ...DEFAULTS });
}

async function handleAnonymize(text) {
  const settings = await getSettings();
  if (!settings.analyzerUrl || !settings.anonymizerUrl) {
    return { error: "Presidio API URLs not configured. Open the extension popup to set them." };
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callPresidio(settings.analyzerUrl, settings.anonymizerUrl, text);
      return { anonymizedText: result };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  return { error: `Anonymization failed: ${lastError.message}` };
}

async function callPresidio(analyzerBaseUrl, anonymizerBaseUrl, text) {
  const analyzerUrl = analyzerBaseUrl.replace(/\/+$/, "");
  const anonymizerUrl = anonymizerBaseUrl.replace(/\/+$/, "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    // Step 1: Analyze
    const analyzeRes = await fetch(`${analyzerUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: "en" }),
      signal: controller.signal,
    });

    if (!analyzeRes.ok) {
      const body = await analyzeRes.text().catch(() => "");
      throw new Error(`Analyzer returned ${analyzeRes.status}: ${body}`);
    }

    const analyzerResults = await analyzeRes.json();
    console.log("[PrivacyPaste] Analyzer results:", JSON.stringify(analyzerResults));

    // If no entities found, return original text
    if (!Array.isArray(analyzerResults) || analyzerResults.length === 0) {
      console.log("[PrivacyPaste] No entities found, returning original text");
      return text;
    }

    // Step 2: Anonymize
    const anonymizeBody = {
      text,
      analyzer_results: analyzerResults,
    };
    console.log("[PrivacyPaste] Anonymize request:", JSON.stringify(anonymizeBody));

    const anonymizeRes = await fetch(`${anonymizerUrl}/anonymize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(anonymizeBody),
      signal: controller.signal,
    });

    if (!anonymizeRes.ok) {
      const body = await anonymizeRes.text().catch(() => "");
      throw new Error(`Anonymizer returned ${anonymizeRes.status}: ${body}`);
    }

    const anonymizeData = await anonymizeRes.json();
    console.log("[PrivacyPaste] Anonymize response:", JSON.stringify(anonymizeData));
    return anonymizeData.text;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out after 10 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleTestConnection(analyzerUrl, anonymizerUrl) {
  if (!analyzerUrl || !anonymizerUrl) {
    return { success: false, error: "Both URLs are required" };
  }

  const analyzer = analyzerUrl.replace(/\/+$/, "");
  const anonymizer = anonymizerUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    // Test analyzer health
    const healthRes = await fetch(`${analyzer}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    if (!healthRes.ok) {
      throw new Error(`Analyzer health check failed (status ${healthRes.status})`);
    }

    // Test analyzer with sample data
    const analyzeRes = await fetch(`${analyzer}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "My name is John Smith and my email is john@example.com",
        language: "en",
      }),
      signal: controller.signal,
    });

    if (!analyzeRes.ok) {
      throw new Error(`Analyzer returned status ${analyzeRes.status}`);
    }

    const analyzerResults = await analyzeRes.json();
    if (!Array.isArray(analyzerResults)) {
      throw new Error("Unexpected analyzer response format");
    }

    // Test anonymizer with the analyzer results
    const anonymizeRes = await fetch(`${anonymizer}/anonymize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "My name is John Smith and my email is john@example.com",
        analyzer_results: analyzerResults,
      }),
      signal: controller.signal,
    });

    if (!anonymizeRes.ok) {
      throw new Error(`Anonymizer returned status ${anonymizeRes.status}`);
    }

    const anonymizeData = await anonymizeRes.json();

    return {
      success: true,
      message: `Both services OK. Found ${analyzerResults.length} entities. Anonymized: "${anonymizeData.text}"`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.name === "AbortError" ? "Connection timed out" : err.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
