const openSettingsButton = document.querySelector("#open-settings");
const popupStatus = document.querySelector("#popup-status");

openSettingsButton.addEventListener("click", async () => {
  openSettingsButton.disabled = true;
  popupStatus.textContent = "";
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch {
    popupStatus.textContent = "设置页暂时无法打开，请从扩展详情页进入设置。";
    openSettingsButton.disabled = false;
  }
});
