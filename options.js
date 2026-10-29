const STORAGE_KEY = "mimoApiKey";
const API_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const MODEL = "mimo-v2.6-flash";
const REQUEST_TIMEOUT_MS = 20000;

const apiKeyInput = document.querySelector("#api-key");
const toggleKeyButton = document.querySelector("#toggle-key");
const testButton = document.querySelector("#test-connection");
const saveButton = document.querySelector("#save-key");
const testStatus = document.querySelector("#test-status");
const saveStatus = document.querySelector("#save-status");

let savedKey = "";
let lastTest = null;
let activeTestKey = null;

function setStatus(element, message, state = "info") {
  element.textContent = message;
  element.dataset.state = state;
}

function currentKey() {
  return apiKeyInput.value.trim();
}

function renderSaveStatus() {
  const value = currentKey();
  if (value !== savedKey) {
    setStatus(saveStatus, value ? "有未保存的更改。" : "当前输入为空；请输入密钥后保存。", "info");
  } else if (savedKey) {
    setStatus(saveStatus, "当前输入与本机已保存配置一致。保存本身不代表连接成功。", "info");
  } else {
    setStatus(saveStatus, "本机尚无已保存的 API Key。", "info");
  }
}

function renderTestStatus() {
  const value = currentKey();
  if (activeTestKey !== null) {
    const changed = value !== activeTestKey;
    setStatus(
      testStatus,
      changed
        ? "测试请求仍在运行，使用的是测试开始时的密钥；当前输入尚未验证。"
        : "正在向 MiMo API 发送最小测试请求…"
    );
    return;
  }
  if (lastTest && lastTest.key === value && value) {
    setStatus(testStatus, lastTest.message, lastTest.state);
    return;
  }
  setStatus(testStatus, value ? "当前密钥尚未验证。" : "尚未进行连接测试。", "info");
}

function httpErrorMessage(status) {
  const messages = {
    400: "请求格式错误，请检查模型或请求参数。",
    401: "认证失败：密钥无效、缺失，或密钥类型与当前接口不匹配。",
    402: "账户余额不足，请检查 MiMo 账户余额。",
    403: "访问被拒绝，可能受地区限制或密钥风控影响。",
    404: "接口或模型未找到，请检查模型配置。",
    421: "请求被内容审核拦截。",
    429: "请求超限或额度耗尽，请检查账户额度后再试。",
    500: "MiMo 服务内部异常，请稍后重试。",
    503: "MiMo 服务繁忙，请稍后重试。"
  };
  return "连接未成功（HTTP " + status + "）：" + (messages[status] || "接口返回错误，请稍后重试。");
}

async function testConnection() {
  const key = currentKey();
  if (!key) {
    setStatus(testStatus, "请先输入 API Key。", "error");
    apiKeyInput.focus();
    return;
  }

  activeTestKey = key;
  lastTest = null;
  testButton.disabled = true;
  renderTestStatus();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": key
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "请只回答 OK。" }],
        max_completion_tokens: 16,
        stream: false,
        thinking: { type: "disabled" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      lastTest = { key: key, state: "error", message: httpErrorMessage(response.status) };
      return;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      lastTest = { key: key, state: "error", message: "接口已响应，但返回内容无法识别。" };
      return;
    }

    if (!result || !result.choices || !result.choices[0] || !result.choices[0].message) {
      lastTest = { key: key, state: "error", message: "接口已响应，但没有返回有效的模型结果。" };
      return;
    }
    lastTest = { key: key, state: "success", message: "连接成功：MiMo-V2.6-Flash 已返回响应。" };
  } catch {
    lastTest = {
      key: key,
      state: "error",
      message: controller.signal.aborted
        ? "连接超时（20 秒）。请检查网络或稍后重试。"
        : "连接失败。请检查网络、扩展接口权限或 MiMo 服务状态。"
    };
  } finally {
    window.clearTimeout(timeoutId);
    activeTestKey = null;
    testButton.disabled = false;
    renderTestStatus();
  }
}

async function saveConfiguration() {
  const key = currentKey();
  if (!key) {
    setStatus(saveStatus, "请先输入 API Key；空值不会覆盖已保存配置。", "error");
    apiKeyInput.focus();
    return;
  }

  saveButton.disabled = true;
  setStatus(saveStatus, "正在保存到本机扩展存储…");
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: key });
    savedKey = key;
    setStatus(
      saveStatus,
      currentKey() === key
        ? "已保存到本机扩展存储。保存操作没有测试连接。"
        : "保存完成：保存的是操作时的密钥，当前输入仍有未保存更改。",
      currentKey() === key ? "success" : "info"
    );
  } catch {
    setStatus(saveStatus, "保存失败：浏览器扩展本地存储不可用，请重试。", "error");
  } finally {
    saveButton.disabled = false;
  }
}

toggleKeyButton.addEventListener("click", () => {
  const shouldShow = apiKeyInput.type === "password";
  apiKeyInput.type = shouldShow ? "text" : "password";
  toggleKeyButton.textContent = shouldShow ? "隐藏" : "显示";
  toggleKeyButton.setAttribute("aria-pressed", String(shouldShow));
  toggleKeyButton.setAttribute("aria-label", shouldShow ? "隐藏 API Key" : "显示 API Key");
});

apiKeyInput.addEventListener("input", () => {
  renderSaveStatus();
  renderTestStatus();
});

testButton.addEventListener("click", testConnection);
saveButton.addEventListener("click", saveConfiguration);

async function loadConfiguration() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    savedKey = typeof result[STORAGE_KEY] === "string" ? result[STORAGE_KEY] : "";
    apiKeyInput.value = savedKey;
    renderSaveStatus();
    renderTestStatus();
  } catch {
    setStatus(saveStatus, "无法读取本机配置；当前输入仍可单独测试或保存。", "error");
    setStatus(testStatus, "尚未进行连接测试。", "info");
  } finally {
    testButton.disabled = false;
    saveButton.disabled = false;
  }
}

void loadConfiguration();
