const STORAGE_KEY = "mimoApiKey";
const API_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const MODEL = "mimo-v2.6-flash";

const analyzeButton = document.querySelector("#analyze-current");
const settingsButton = document.querySelector("#open-settings");
const statusElement = document.querySelector("#popup-status");
const outputSection = document.querySelector("#analysis-output");
const outputContent = document.querySelector("#analysis-content");

function setStatus(message, state = "info") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

function collectPageEvidence() {
  const maxPageText = 9000;
  const compact = (value, maxLength = 240) => String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const main = document.querySelector("#dp")
    || document.querySelector("#search")
    || document.querySelector("[role='main']")
    || document.querySelector("main")
    || document.body;
  const visibleHeadings = Array.from(main.querySelectorAll("h1, h2, h3"))
    .filter(isVisible)
    .slice(0, 30)
    .map((element) => ({ level: element.tagName.toLowerCase(), text: compact(element.innerText || element.textContent, 180) }))
    .filter((item) => item.text);
  const tables = Array.from(main.querySelectorAll("table"))
    .filter(isVisible)
    .slice(0, 8)
    .map((table) => Array.from(table.querySelectorAll("tr"))
      .slice(0, 6)
      .map((row) => Array.from(row.querySelectorAll("th, td"))
        .slice(0, 8)
        .map((cell) => compact(cell.innerText || cell.textContent, 160))
        .filter(Boolean))
      .filter((row) => row.length))
    .filter((rows) => rows.length);
  const rawUrl = new URL(location.href);
  rawUrl.search = "";
  rawUrl.hash = "";
  const pageText = compact(main.innerText || main.textContent || document.body?.innerText, maxPageText);
  return {
    title: compact(document.title, 240),
    url: rawUrl.href,
    description: compact(document.querySelector('meta[name="description"]')?.content, 400),
    headings: visibleHeadings,
    tables,
    visible_text: pageText
  };
}

function explainHttpError(status) {
  const details = {
    400: "请求格式或模型参数不正确。",
    401: "API Key 无效、缺失，或密钥类型与接口不匹配。",
    402: "账户余额不足。",
    403: "访问被拒绝，可能受地区限制或密钥风控影响。",
    404: "接口或模型未找到。",
    421: "请求被内容审核拦截。",
    429: "请求超限或额度不足。",
    500: "MiMo 服务内部异常。",
    503: "MiMo 服务繁忙。"
  };
  return "分析请求失败（HTTP " + status + "）：" + (details[status] || "接口返回错误，请稍后重试。");
}

async function analyzeCurrentPage() {
  analyzeButton.disabled = true;
  outputSection.hidden = true;
  outputContent.textContent = "";
  setStatus("正在读取当前页面…");

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab?.id) {
      setStatus("没有找到当前页面。", "error");
      return;
    }

    const keyResult = await chrome.storage.local.get(STORAGE_KEY);
    const apiKey = typeof keyResult[STORAGE_KEY] === "string" ? keyResult[STORAGE_KEY].trim() : "";
    if (!apiKey) {
      setStatus("尚未保存 API Key；请先打开 API 设置。", "error");
      return;
    }

    let evidence;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectPageEvidence
      });
      evidence = results?.[0]?.result;
    } catch {
      setStatus("无法读取当前页面。请切换到公开网页后重试。", "error");
      return;
    }

    if (!evidence?.visible_text) {
      setStatus("当前页面没有可读取的可见文字。", "error");
      return;
    }

    setStatus("正在向 MiMo 发送限长页面证据…");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "你是网页信息采集助手。只根据用户提供的页面证据回答，不猜测未显示的信息。请用中文简洁输出：页面类型；核心信息；最多 8 项可采集字段及其页面原文值；页面未显示或无法确认的关键信息。"
          },
          {
            role: "user",
            content: "请整理下面的公开网页证据：\n" + JSON.stringify(evidence)
          }
        ],
        max_completion_tokens: 768,
        stream: false,
        thinking: { type: "disabled" }
      })
    });

    if (!response.ok) {
      setStatus(explainHttpError(response.status), "error");
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      setStatus("MiMo 已响应，但返回内容无法识别。", "error");
      return;
    }

    const content = data?.choices?.[0]?.message?.content;
    const resultText = typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part) => part?.text || "").join("\n").trim()
        : "";
    if (!resultText) {
      setStatus("MiMo 已响应，但没有返回可显示的分析结果。", "error");
      return;
    }

    outputContent.textContent = resultText;
    outputSection.hidden = false;
    setStatus("分析完成。结果仅依据本次读取到的页面证据。", "success");
  } catch {
    setStatus("分析失败。请检查网络、扩展权限或 MiMo 服务状态。", "error");
  } finally {
    analyzeButton.disabled = false;
  }
}

analyzeButton.addEventListener("click", analyzeCurrentPage);
settingsButton.addEventListener("click", async () => {
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch {
    setStatus("设置页暂时无法打开，请从扩展详情页进入设置。", "error");
  }
});
