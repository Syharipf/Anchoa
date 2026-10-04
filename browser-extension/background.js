// Background script for Anchoa Browser Extension (Chrome MV3 / Firefox WebExtension).
const HOST_NAME = "io.github.syharipf.anchoa.downloads";

function generateRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "req-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
}

function isPublicHttp(url) {
  if (!url || typeof url !== "string") return false;
  const lower = url.trim().toLowerCase();
  return (lower.startsWith("http://") || lower.startsWith("https://")) &&
    !lower.startsWith("blob:") &&
    !lower.startsWith("data:");
}

function handoffDownload(url, filename, referrer, browserDownloadId) {
  if (!isPublicHttp(url)) {
    return;
  }

  const requestId = generateRequestId();
  const preparePayload = {
    version: 1,
    action: "prepare",
    requestId,
    url,
    filename: filename || undefined,
    referrer: isPublicHttp(referrer) ? referrer : undefined
  };

  chrome.runtime.sendNativeMessage(HOST_NAME, preparePayload, (response) => {
    if (chrome.runtime.lastError || !response || !response.accepted) {
      // Host unreachable or rejected: leave browser download active
      return;
    }

    // Step 2: Cancel browser download now that Anchoa holds durable pending record
    if (browserDownloadId != null) {
      chrome.downloads.cancel(browserDownloadId, () => {
        if (chrome.runtime.lastError) {
          // Cancellation failed: roll back pending handoff in Anchoa
          chrome.runtime.sendNativeMessage(HOST_NAME, {
            version: 1,
            action: "cancel",
            requestId
          });
          return;
        }
        // Step 3: Commit with retry and browser recovery fallback
        commitWithRecovery(requestId, url, filename);
      });
    } else {
      commitWithRecovery(requestId, url, filename);
    }
  });
}

function safeBasename(filename) {
  if (!filename || typeof filename !== "string") return undefined;
  const parts = filename.split(/[/\\]/);
  const base = parts[parts.length - 1].trim();
  return base || undefined;
}

function recoverDownloadInBrowser(url, filename) {
  const base = safeBasename(filename);
  const options = { url };
  if (base) {
    options.filename = base;
  }
  chrome.downloads.download(options, () => {
    if (chrome.runtime.lastError) {
      // Fallback: retry bare url without filename
      chrome.downloads.download({ url });
    }
  });
}

function commitWithRecovery(requestId, url, filename, maxRetries = 3) {
  let attempt = 0;
  function tryCommit() {
    attempt++;
    chrome.runtime.sendNativeMessage(
      HOST_NAME,
      { version: 1, action: "commit", requestId },
      (res) => {
        if (!chrome.runtime.lastError && res && res.accepted) {
          return;
        }
        if (attempt < maxRetries) {
          setTimeout(tryCommit, attempt * 1000);
        } else {
          // Recovery: restart in browser safely
          recoverDownloadInBrowser(url, filename);
        }
      }
    );
  }
  tryCommit();
}

// Context Menu setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "anchoa-download-link",
    title: "Unduh dengan Anchoa",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "anchoa-download-link" && info.linkUrl) {
    handoffDownload(info.linkUrl, null, tab && tab.url);
  }
});

// Download Interception (Opt-in only, default OFF, constrained to allowedOrigins)
chrome.downloads.onCreated.addListener((downloadItem) => {
  chrome.storage.local.get({ interceptDownloads: false, allowedOrigins: [] }, (data) => {
    if (!data.interceptDownloads) {
      return;
    }
    const origins = Array.isArray(data.allowedOrigins) ? data.allowedOrigins : [];
    if (origins.length === 0) {
      return;
    }
    // Only intercept direct public GET HTTP(S) downloads
    if (!isPublicHttp(downloadItem.url)) {
      return;
    }
    // If download was initiated by extension itself, skip
    if (downloadItem.byExtensionId) {
      return;
    }
    try {
      const itemOrigin = new URL(downloadItem.url).origin.toLowerCase();
      const isAllowed = origins.some((o) => {
        try {
          return new URL(o).origin.toLowerCase() === itemOrigin;
        } catch {
          return o.toLowerCase() === itemOrigin;
        }
      });
      if (!isAllowed) {
        return;
      }
    } catch {
      return;
    }
    handoffDownload(
      downloadItem.url,
      downloadItem.filename,
      downloadItem.referrer,
      downloadItem.id
    );
  });
});
