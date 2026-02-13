const enabledToggle = document.getElementById("enabled");
const analyzerUrlInput = document.getElementById("analyzerUrl");
const anonymizerUrlInput = document.getElementById("anonymizerUrl");
const testBtn = document.getElementById("testBtn");
const statusEl = document.getElementById("status");
const savedIndicator = document.getElementById("savedIndicator");

let saveTimeout;

const DEFAULTS = {
  enabled: true,
  analyzerUrl: "http://localhost:5002",
  anonymizerUrl: "http://localhost:5001",
};

chrome.storage.sync.get(DEFAULTS, (settings) => {
  enabledToggle.checked = settings.enabled;
  analyzerUrlInput.value = settings.analyzerUrl;
  anonymizerUrlInput.value = settings.anonymizerUrl;
});

enabledToggle.addEventListener("change", () => {
  save({ enabled: enabledToggle.checked });
});

analyzerUrlInput.addEventListener("input", () => {
  debouncedSave({ analyzerUrl: analyzerUrlInput.value.trim() });
});

anonymizerUrlInput.addEventListener("input", () => {
  debouncedSave({ anonymizerUrl: anonymizerUrlInput.value.trim() });
});

testBtn.addEventListener("click", async () => {
  const analyzerUrl = analyzerUrlInput.value.trim();
  const anonymizerUrl = anonymizerUrlInput.value.trim();

  if (!analyzerUrl || !anonymizerUrl) {
    showStatus("Please enter both URLs.", "error");
    return;
  }

  // Request host permissions for both origins
  for (const url of [analyzerUrl, anonymizerUrl]) {
    try {
      const origin = new URL(url).origin + "/*";
      const has = await chrome.permissions.contains({ origins: [origin] });
      if (!has) {
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) {
          showStatus(`Permission denied for ${url}`, "error");
          return;
        }
      }
    } catch {
      // let the fetch fail with a clear message
    }
  }

  testBtn.disabled = true;
  testBtn.textContent = "Testing...";
  statusEl.className = "status";

  const response = await chrome.runtime.sendMessage({
    action: "testConnection",
    analyzerUrl,
    anonymizerUrl,
  });

  testBtn.disabled = false;
  testBtn.textContent = "Test Connection";

  if (response.success) {
    showStatus(response.message, "success");
  } else {
    showStatus(`Connection failed: ${response.error}`, "error");
  }
});

function debouncedSave(data) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => save(data), 500);
}

function save(data) {
  chrome.storage.sync.set(data, () => {
    savedIndicator.classList.add("visible");
    setTimeout(() => savedIndicator.classList.remove("visible"), 1500);
  });
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status status--${type}`;
}
