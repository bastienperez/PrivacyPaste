const inputText = document.getElementById("inputText");
const outputText = document.getElementById("outputText");
const anonymizeBtn = document.getElementById("anonymizeBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");

anonymizeBtn.addEventListener("click", async () => {
  const text = inputText.value.trim();
  if (!text) {
    showStatus("Please enter some text to anonymize.", "error");
    return;
  }

  anonymizeBtn.disabled = true;
  anonymizeBtn.innerHTML = '<span class="spinner"></span>Anonymizing…';
  statusEl.className = "status";
  outputText.value = "";
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: "anonymize",
      text,
    });

    if (response.anonymizedText) {
      outputText.value = response.anonymizedText;
      copyBtn.disabled = false;
      showStatus("Text anonymized successfully.", "success");
    } else {
      showStatus(`Anonymization failed: ${response.error || "Unknown error"}`, "error");
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    anonymizeBtn.disabled = false;
    anonymizeBtn.textContent = "Anonymize";
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputText.value);
    const original = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = original;
    }, 1500);
  } catch (err) {
    showStatus(`Failed to copy: ${err.message}`, "error");
  }
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status status--${type}`;
}
