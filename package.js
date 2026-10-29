const SINGLEFILE_ID = "mpiodijhokgodhhofbcjdecpffjipkle";
const sampleButton = document.querySelector("#start-sampling");
const packageButton = document.querySelector("#export-package");

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("no tab");
  return tab;
}

sampleButton.addEventListener("click", async () => {
  sampleButton.disabled = true;
  try {
    const tab = await currentTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["sampler.js"] });
    window.close();
  } catch {
    setStatus("无法在此页面启动采样，请切换到普通网页。", "error");
    sampleButton.disabled = false;
  }
});

function redact(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>\\)\]]+/gi, match => {
      try { const u = new URL(match); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; }
      catch { return "[网址已移除]"; }
    })
    .replace(/\b(sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._~+\/=-]{12,})\b/gi, "[已移除凭据]")
    .replace(/\b(cookie|authorization|(?:access|refresh|auth|session)[_-]?token|token|api[_-]?key|password|secret)\b["']?\s*[:=]\s*["']?[^\s"'&,;<>]+/gi, "$1=[已移除]")
    .replace(/\?[^\s"'<>#]*/g, "");
}

function cleanData(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(cleanData);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /cookie|token|password|secret|authorization|api.?key/i.test(key) ? "[已移除]" : cleanData(item)
    ]));
  }
  return value;
}

function cleanSnapshot(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, noscript, form, input, textarea, select, button, iframe, object, embed, template, meta").forEach(el => el.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (/^(on|data-|nonce|integrity|srcdoc)/i.test(attr.name)) el.removeAttribute(attr.name);
      else el.setAttribute(attr.name, redact(attr.value));
    }
  }
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach(node => node.remove());
  return "<!doctype html>\n" + redact(doc.documentElement.outerHTML);
}

async function capture(tabId) {
  const result = await Promise.race([
    chrome.runtime.sendMessage(SINGLEFILE_ID, { method: "capture-page", tabId, config: { removeFrames: true, blockScripts: true } }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 60000))
  ]);
  if (typeof result?.content !== "string" || !result.content) throw new Error("empty");
  return cleanSnapshot(result.content);
}

packageButton.addEventListener("click", async () => {
  packageButton.disabled = true;
  sampleButton.disabled = true;
  setStatus("正在采集页面资料，请保持弹窗打开…");
  try {
    const tab = await currentTab();
    const generated = new Date().toISOString();
    let evidence = null;
    let samples = [];
    let snapshot = null;
    const status = { analysis: "失败：无法读取页面", sampling: "未采样", snapshot: "失败：SingleFile 不可用或未授权" };
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageEvidence });
      if (!results[0]?.result) throw new Error("empty");
      evidence = cleanData(results[0].result);
      status.analysis = "成功";
    } catch {}
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sampler = window.__pagePrySampler;
          if (!sampler) return {items: [], state: "idle"};
          const result = sampler.snapshot();
          sampler.stop();
          return result;
        }
      });
      const rawSamples = results[0]?.result?.items || [];
      samples = cleanData(rawSamples.map(sample => ({
        ...sample,
        attributes: (sample.attributes || []).filter(attr => /^(role|aria-label|alt|title)$/i.test(attr.name))
      })));
      status.sampling = samples.length ? "成功：" + samples.length + " 项" : "未采样";
    } catch { status.sampling = "失败：无法读取采样"; }
    setStatus("正在生成 SingleFile 快照，请保持弹窗打开…");
    try {
      snapshot = await capture(tab.id);
      status.snapshot = "成功";
    } catch {}
    const data = { generated_at: generated, page_url: evidence?.url || null, status, evidence, samples };
    const report = "# 页面分析报告\n\n采集时间：" + generated + "\n页面：" + (data.page_url || "不可用") +
      "\n\n## 采集状态\n\n- 结构化分析：" + status.analysis + "\n- 手动采样：" + status.sampling +
      "\n- HTML 快照：" + status.snapshot + "\n\n## 页面资料\n\n" +
      (evidence ? "标题：" + evidence.title + "\n\n描述：" + evidence.description + "\n\n标题层级：\n" +
        evidence.headings.map(x => "- " + x.level + " " + x.text).join("\n") +
        "\n\n可见文字：\n\n" + evidence.visible_text : "页面内容不可用。") +
      "\n\n## 手动采样\n\n" + (samples.length ? samples.map((x,i) => (i+1) + ". " + x.tag + " " + x.selector + " — " + x.text).join("\n") : status.sampling);
    const index = "# PagePry 资料索引\n\n采集时间：" + generated + "\n页面：" + (data.page_url || "不可用") +
      "\n\n- report.md：分析报告和采样摘要\n- data/page.json：结构化页面数据及采集状态\n- data/samples.json：手动采样详情\n- snapshot/page.html：SingleFile 页面快照（仅成功时生成）\n\n## 状态\n\n- 结构分析：" + status.analysis +
      "\n- 采样：" + status.sampling + "\n- 快照：" + status.snapshot +
      "\n\n## 限制\n\n只采集当前已加载页面，文字和表格有数量限制；快照移除了脚本、表单、框架及部分属性。已尝试移除常见凭据和网址参数，但无法识别所有页面敏感内容，分享前请检查。\n";
    const zip = new JSZip();
    zip.file("README.md", index);
    zip.file("report.md", report);
    zip.file("data/page.json", JSON.stringify(data, null, 2));
    zip.file("data/samples.json", JSON.stringify(samples, null, 2));
    if (snapshot) zip.file("snapshot/page.html", snapshot);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pagepry-" + generated.replace(/[:.]/g, "-") + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus("ZIP 已生成。结构：" + status.analysis + "；采样：" + status.sampling + "；快照：" + status.snapshot, status.analysis === "成功" && snapshot ? "success" : "error");
  } catch {
    setStatus("导出失败，请检查当前页面和浏览器下载设置。", "error");
  } finally {
    packageButton.disabled = false;
    sampleButton.disabled = false;
  }
});
