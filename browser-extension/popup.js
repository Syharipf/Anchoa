const HOST_NAME = "io.github.syharipf.anchoa.downloads";

const hostBadge = document.getElementById("hostBadge");
const hostText = document.getElementById("hostText");
const interceptToggle = document.getElementById("interceptToggle");
const originsInput = document.getElementById("originsInput");

// Check toggle state and allowedOrigins
chrome.storage.local.get({ interceptDownloads: false, allowedOrigins: [] }, (data) => {
  interceptToggle.checked = Boolean(data.interceptDownloads);
  originsInput.value = (data.allowedOrigins || []).join("\n");
});

interceptToggle.addEventListener("change", () => {
  chrome.storage.local.set({ interceptDownloads: interceptToggle.checked });
});

originsInput.addEventListener("change", () => {
  const list = originsInput.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  chrome.storage.local.set({ allowedOrigins: list });
});
// Ping host
try {
  chrome.runtime.sendNativeMessage(
    HOST_NAME,
    { version: 1, action: "ping", requestId: "ping-" + Date.now() },
    (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.accepted) {
        hostBadge.classList.remove("connected");
        hostText.textContent = "Tidak terhubung";
      } else {
        hostBadge.classList.add("connected");
        hostText.textContent = "Terhubung";
      }
    }
  );
} catch (e) {
  hostBadge.classList.remove("connected");
  hostText.textContent = "Tidak terhubung";
}
