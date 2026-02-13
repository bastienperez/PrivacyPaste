(function () {
  "use strict";

  const PREFIX = "privacypaste";
  const MAX_TEXT_LENGTH = 10000;
  let currentAbortController = null;
  let blockNextBeforeInput = false;

  // Block the beforeinput event that React apps use for actual text insertion
  document.addEventListener(
    "beforeinput",
    (e) => {
      if (blockNextBeforeInput && e.inputType === "insertFromPaste") {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  document.addEventListener(
    "paste",
    (e) => {
      // If extension context is dead, let the native paste through
      if (!chrome.runtime?.id) return;

      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;

      // Block synchronously BEFORE any async work
      e.preventDefault();
      e.stopImmediatePropagation();
      blockNextBeforeInput = true;

      // Clear the flag after the current event cycle
      setTimeout(() => {
        blockNextBeforeInput = false;
      }, 0);

      const target = findActiveInput();
      if (!target) return;

      // Now do the async work
      handlePaste(target, text);
    },
    true
  );

  async function handlePaste(target, text) {
    let settings;
    try {
      settings = await chrome.storage.sync.get({
        enabled: true,
        analyzerUrl: "http://localhost:5002",
        anonymizerUrl: "http://localhost:5001",
      });
    } catch {
      // Extension context invalidated (reloaded) — insert original text
      insertText(target, text);
      return;
    }

    if (!settings.enabled || !settings.analyzerUrl || !settings.anonymizerUrl) {
      insertText(target, text);
      return;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      showNotification(
        `Text is very long (${text.length} chars). Anonymization may be slow.`,
        "warning"
      );
    }

    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const overlay = showOverlay(target);

    try {
      const response = await chrome.runtime.sendMessage({
        action: "anonymize",
        text,
      });

      if (signal.aborted) return;

      if (response.error) {
        removeOverlay(overlay);
        showNotification(response.error, "error", () => {
          insertText(target, text);
        });
        return;
      }

      removeOverlay(overlay);
      insertText(target, response.anonymizedText);
    } catch (err) {
      if (signal.aborted) return;
      removeOverlay(overlay);
      // Context invalidated — just insert original text silently
      if (err.message?.includes("Extension context invalidated")) {
        insertText(target, text);
        return;
      }
      showNotification(
        "Failed to communicate with extension. " + err.message,
        "error",
        () => {
          insertText(target, text);
        }
      );
    } finally {
      if (currentAbortController?.signal === signal) {
        currentAbortController = null;
      }
    }
  }

  function findActiveInput() {
    const el = document.activeElement;
    if (!el) return null;

    if (
      el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && el.type === "text") ||
      el.isContentEditable
    ) {
      return el;
    }

    const editable =
      el.querySelector('[contenteditable="true"]') ||
      el.querySelector("textarea");
    if (editable) {
      editable.focus();
      return editable;
    }

    return el.closest('[contenteditable="true"]') || null;
  }

  function insertText(element, text) {
    element.focus();

    if (element.isContentEditable) {
      const success = document.execCommand("insertText", false, text);
      if (!success) {
        const sel = window.getSelection();
        if (sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
        }
      }
    } else {
      const success = document.execCommand("insertText", false, text);
      if (!success) {
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? element.value.length;
        element.value =
          element.value.slice(0, start) + text + element.value.slice(end);
        element.selectionStart = element.selectionEnd = start + text.length;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  function showOverlay(target) {
    const rect = target.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = `${PREFIX}-overlay`;
    overlay.innerHTML = `
      <div class="${PREFIX}-spinner"></div>
      <span class="${PREFIX}-overlay-text">Anonymizing...</span>
    `;
    overlay.style.top = rect.top + window.scrollY + "px";
    overlay.style.left = rect.left + window.scrollX + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlay(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function showNotification(message, type, onSkip) {
    const existing = document.querySelector(`.${PREFIX}-notification`);
    if (existing) existing.remove();

    const notification = document.createElement("div");
    notification.className = `${PREFIX}-notification ${PREFIX}-notification--${type}`;

    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;
    notification.appendChild(messageSpan);

    const actions = document.createElement("div");
    actions.className = `${PREFIX}-notification-actions`;

    if (onSkip) {
      const skipBtn = document.createElement("button");
      skipBtn.textContent = "Paste original";
      skipBtn.className = `${PREFIX}-notification-btn`;
      skipBtn.addEventListener("click", () => {
        notification.remove();
        onSkip();
      });
      actions.appendChild(skipBtn);
    }

    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "Dismiss";
    dismissBtn.className = `${PREFIX}-notification-btn`;
    dismissBtn.addEventListener("click", () => notification.remove());
    actions.appendChild(dismissBtn);

    notification.appendChild(actions);
    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) notification.remove();
    }, 10000);
  }
})();
