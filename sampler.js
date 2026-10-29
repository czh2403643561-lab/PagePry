// Sampling functions adapted from references/crawlhub/analyzer.js (CrawlHub).
(() => {
if (window.__pagePrySampler) {
  window.__pagePrySampler.show();
  return;
}
function startElementSampling() {
  if (window.__crawlHubSamplingState === "sampling") {
    return { started: true, already_running: true };
  }
  if (window.__crawlHubSamplingState === "paused") {
    return resumeElementSampling();
  }
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = true;
  window.__crawlHubSamplingState = "sampling";
  window.__crawlHubSelectedElements = [];

  const compactText = (value, length = 240) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const selectorFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      else if (current.classList.length) part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  const xpathFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }
    return `/${parts.join("/")}`;
  };
  const summarize = (element) => ({
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    class: compactText(element.className, 160),
    selector: selectorFor(element),
    text: compactText(element.innerText || element.textContent || "")
  });
  const parentStructure = (element) => {
    const result = [];
    let current = element.parentElement;
    while (current && result.length < 5) {
      result.push(summarize(current));
      current = current.parentElement;
    }
    return result;
  };
  const nearbySiblings = (element) => {
    const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
    const index = siblings.indexOf(element);
    return {
      position: index >= 0 ? index + 1 : null,
      total: siblings.length,
      previous: siblings.slice(Math.max(0, index - 3), index).map(summarize),
      next: siblings.slice(index + 1, index + 4).map(summarize)
    };
  };
  const guessFieldTypes = (element) => {
    const tag = element.tagName.toLowerCase();
    const text = compactText(element.innerText || element.textContent || "", 500);
    const tokens = `${tag} ${element.id || ""} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("alt") || ""} ${text}`.toLowerCase();
    const types = [];
    if (tag === "img" || /image|img|photo|picture|图片|照片/.test(tokens)) types.push("image");
    if (/product|item|商品|名称|name|title|标题/.test(tokens)) types.push("product_name");
    if (/price|cost|金额|价格|售价|货币|\$|€|£|¥/.test(tokens)) types.push("price");
    if (/count|quantity|number|total|gmv|sales|click|view|score|rating|数量|销量|点击|浏览|评分|指标/.test(tokens) || /^[-+]?\d[\d,.% ]*$/.test(text)) types.push("numeric_metric");
    if (/percent|percentage|rate|比例|百分比|%/.test(tokens)) types.push("percentage");
    if (tag === "a" || element.hasAttribute("href")) types.push("link");
    if (!types.length && text) types.push("text");
    return types;
  };
  const describe = (element) => ({
    tag: element.tagName.toLowerCase(),
    class: compactText(element.className, 240),
    id: element.id || null,
    selector: selectorFor(element),
    xpath: xpathFor(element),
    text: compactText(element.innerText || element.textContent || "", 500),
    possible_field_types: guessFieldTypes(element),
    parent_structure: parentStructure(element),
    nearby_siblings: nearbySiblings(element),
    attributes: Array.from(element.attributes)
      .filter((attribute) => !["value", "src", "href", "style"].includes(attribute.name))
      .slice(0, 30)
      .map((attribute) => ({ name: attribute.name, value: compactText(attribute.value, 240) })),
    selected_at: new Date().toISOString()
  });

  const notice = document.createElement("div");
  notice.textContent = "PagePry：采样中，点击多个页面元素；可暂停后滚动页面";
  Object.assign(notice.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 12px",
    borderRadius: "6px",
    color: "#fff",
    background: "#315efb",
    font: "12px sans-serif",
    pointerEvents: "none",
    boxShadow: "0 2px 10px rgba(0,0,0,.25)"
  });
  document.documentElement.appendChild(notice);
  const highlight = document.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed",
    zIndex: "2147483646",
    pointerEvents: "none",
    border: "2px solid #315efb",
    background: "rgba(49,94,251,.12)",
    display: "none"
  });
  document.documentElement.appendChild(highlight);

  const isPanelTarget = (event) => {
    const panelHost = window.__crawlHubPanelHost;
    return panelHost && typeof event.composedPath === "function" && event.composedPath().includes(panelHost);
  };
  const onMove = (event) => {
    if (isPanelTarget(event)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    Object.assign(highlight.style, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };
  const onClick = (event) => {
    if (isPanelTarget(event) || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    const item = describe(event.target);
    if (!window.__crawlHubSelectedElements.some((selected) => selected.xpath === item.xpath)) {
      window.__crawlHubSelectedElements.push(item);
      if (window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
      notice.textContent = `PagePry：已选择 ${window.__crawlHubSelectedElements.length} 个元素，继续点击或完成采样`;
    }
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelElementSampling();
  };
  const attach = () => {
    window.__crawlHubSamplingActive = true;
    window.__crawlHubSamplingState = "sampling";
    notice.style.display = "block";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  };
  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    notice.remove();
    highlight.remove();
    window.__crawlHubSamplingActive = false;
    window.__crawlHubSamplingState = "idle";
    delete window.__crawlHubSamplingCleanup;
    delete window.__crawlHubSamplingPause;
    delete window.__crawlHubSamplingResume;
  };
  const pause = () => {
    if (window.__crawlHubSamplingState !== "sampling") return { paused: false };
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    highlight.style.display = "none";
    notice.style.display = "none";
    window.__crawlHubSamplingActive = false;
    window.__crawlHubSamplingState = "paused";
    return { paused: true, selected_count: window.__crawlHubSelectedElements.length };
  };
  const resume = () => {
    if (window.__crawlHubSamplingState !== "paused") return { resumed: false };
    attach();
    return { resumed: true, selected_count: window.__crawlHubSelectedElements.length };
  };

  window.__crawlHubSamplingCleanup = cleanup;
  window.__crawlHubSamplingPause = pause;
  window.__crawlHubSamplingResume = resume;
  attach();
  return { started: true };
}

function pauseElementSampling() {
  const result = window.__crawlHubSamplingPause?.() || { paused: false };
  if (result.paused && window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
  return result;
}

function resumeElementSampling() {
  const result = window.__crawlHubSamplingResume?.() || { resumed: false };
  if (result.resumed && window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
  return result;
}

function cancelElementSampling() {
  const selectedCount = Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements.length : 0;
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = false;
  window.__crawlHubSamplingState = "idle";
  window.__crawlHubSelectedElements = [];
  if (window.__crawlHubSamplingChanged) window.__crawlHubSamplingChanged();
  return { cancelled: true, selected_count: selectedCount };
}

function stopElementSampling() {
  if (window.__crawlHubSamplingCleanup) window.__crawlHubSamplingCleanup();
  window.__crawlHubSamplingActive = false;
  window.__crawlHubSamplingState = "idle";
  return { stopped: true, selected_count: Array.isArray(window.__crawlHubSelectedElements) ? window.__crawlHubSelectedElements.length : 0 };
}


const host = document.createElement("div");
host.style.cssText = "position:fixed;right:16px;top:16px;z-index:2147483647";
const shadow = host.attachShadow({mode:"closed"});
shadow.innerHTML = '<style>section{width:240px;padding:12px;background:white;color:#182230;font:13px/1.5 sans-serif;border:1px solid #ccc;border-radius:8px;box-shadow:0 3px 12px #0004}button{padding:5px 8px;margin:3px;cursor:pointer}</style><section><strong>PagePry 元素采样</strong><p id="status"></p><div><button id="start">开始采样</button><button id="pause">暂停</button><button id="resume">继续</button><button id="finish">完成</button><button id="cancel">取消</button><button id="hide">收起</button></div><small>悬停高亮，点击选取；暂停后可滚动。刷新页面会清空采样。</small></section>';
document.documentElement.append(host);
window.__crawlHubPanelHost = host;
window.__crawlHubSelectedElements = [];
function render() {
 const state = window.__crawlHubSamplingState || "idle";
 const count = window.__crawlHubSelectedElements.length;
 shadow.querySelector("#status").textContent = (state === "sampling" ? "采样中" : state === "paused" ? "已暂停" : "待机") + " · 已选 " + count + " 项";
 shadow.querySelector("#start").hidden = state !== "idle";
 shadow.querySelector("#pause").hidden = state !== "sampling";
 shadow.querySelector("#resume").hidden = state !== "paused";
 shadow.querySelector("#finish").hidden = state === "idle";
 shadow.querySelector("#cancel").hidden = state === "idle";
}
window.__crawlHubSamplingChanged = render;
shadow.querySelector("#start").onclick = () => { startElementSampling(); render(); };
shadow.querySelector("#pause").onclick = () => { pauseElementSampling(); render(); };
shadow.querySelector("#resume").onclick = () => { resumeElementSampling(); render(); };
shadow.querySelector("#finish").onclick = () => { stopElementSampling(); render(); };
shadow.querySelector("#cancel").onclick = () => { cancelElementSampling(); render(); };
shadow.querySelector("#hide").onclick = () => { if (window.__crawlHubSamplingActive) pauseElementSampling(); host.hidden = true; };
window.__pagePrySampler = {
 show() { host.hidden = false; render(); },
 snapshot() { return { items: window.__crawlHubSelectedElements || [], state: window.__crawlHubSamplingState || "idle" }; },
 stop() { stopElementSampling(); host.hidden = true; render(); }
};
render();
})();
