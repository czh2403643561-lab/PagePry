// This collector runs only for ZIP export; it is never sent to MiMo.
function collectExportStructure() {
  const maxNodes = 5000, maxParents = 600, maxGroups = 8, maxItems = 6;
  const text = (v, n = 180) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  const safeUrl = value => {
    try {
      const u = new URL(value, location.href);
      if (!["http:", "https:"].includes(u.protocol)) return null;
      u.username = ""; u.password = ""; u.search = ""; u.hash = "";
      return u.href;
    } catch { return null; }
  };
  const visible = el => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  };
  const locate = el => {
    if (!el) return null;
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 30; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id && !node.id.includes("?")) part += "#" + CSS.escape(node.id);
      else {
        const classes = [...node.classList].filter(c => !c.includes("?")).slice(0, 2);
        if (classes.length) part += "." + classes.map(c => CSS.escape(c)).join(".");
        let index = 1;
        for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          if (sibling.tagName === node.tagName) index++;
        }
        part += ":nth-of-type(" + index + ")";
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1 && matches[0] === el) return { selector, valid: true, match_count: 1, matches_target: true, unique: true };
      } catch {}
    }
    const selector = parts.join(" > ");
    try {
      const matches = document.querySelectorAll(selector);
      return { selector, valid: true, match_count: matches.length, matches_target: [...matches].includes(el), unique: matches.length === 1 && matches[0] === el };
    } catch { return { selector, valid: false, match_count: 0, matches_target: false, unique: false }; }
  };
  const field = el => el ? { raw_text: text(el.innerText || el.textContent), location: locate(el) } : null;
  const fieldNodes = (root, selector) => {
    const result = [];
    if (root.matches(selector)) result.push(root);
    result.push(...Array.from(root.querySelectorAll(selector)).slice(0, 40));
    return result.filter(visible);
  };
  const currency = /(?:[¥￥$£€]\s*\d|\b(?:USD|CNY|RMB|GBP|EUR)\s*\d)/i;
  const getItem = root => {
    const links = fieldNodes(root, "a[href]").filter(el => safeUrl(el.getAttribute("href")));
    const images = fieldNodes(root, "img").filter(el => safeUrl(el.currentSrc || el.getAttribute("src")));
    const priceNodes = fieldNodes(root, "[class*='price' i], [data-price], [itemprop='price'], span, strong, b");
    const price = priceNodes.filter(el => {
      const value = text(el.innerText || el.textContent, 150);
      return value.length <= 100 && currency.test(value);
    }).sort((a, b) => text(a.innerText || a.textContent).length - text(b.innerText || b.textContent).length)[0];
    const titles = fieldNodes(root, "h1,h2,h3,h4,[class*='title' i],[class*='name' i],[itemprop='name']");
    const title = titles.find(el => { const t = text(el.innerText || el.textContent); return t.length >= 3 && !currency.test(t); })
      || links.find(el => { const t = text(el.innerText || el.textContent); return t.length >= 3 && t.length <= 120 && !currency.test(t); });
    // Do not treat an unrelated seller/navigation link as the item's link.
    const link = title ? links.find(el => el === title || el.contains(title)) : null;
    const image = images[0];
    return {
      location: locate(root),
      title: field(title),
      price: field(price),
      link: link ? { raw_text: text(link.innerText || link.textContent), url: safeUrl(link.getAttribute("href")), location: locate(link) } : null,
      image: image ? { alt: text(image.alt), url: safeUrl(image.currentSrc || image.getAttribute("src")), location: locate(image) } : null
    };
  };
  const main = document.querySelector("#dp") || document.querySelector("#search") ||
    document.querySelector("[role='main']") || document.querySelector("main") || document.body;
  const rawText = String(main?.innerText || main?.textContent || document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const groups = [], walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
  let scanned = 0, parents = 0, node = walker.currentNode;
  while (node && scanned < maxNodes && parents < maxParents && groups.length < maxGroups) {
    scanned++;
    if (node.children.length >= 2 && visible(node)) {
      parents++;
      const bySignature = new Map();
      for (const child of Array.from(node.children).slice(0, 100)) {
        if (!visible(child)) continue;
        const classes = [...child.classList].slice(0, 2).sort().join(" ");
        const signature = child.tagName + "|" + classes;
        if (!bySignature.has(signature)) bySignature.set(signature, []);
        bySignature.get(signature).push(child);
      }
      for (const children of bySignature.values()) {
        if (children.length < 2 || groups.length >= maxGroups) continue;
        const items = children.slice(0, maxItems).map(getItem);
        if (items.filter(item => item.title && (item.price || (item.image && item.link))).length < Math.max(2, Math.ceil(items.length * 0.6))) continue;
        groups.push({ label: "候选重复结构", parent: locate(node), total_matching_siblings_in_scan: children.length, items });
      }
    }
    node = walker.nextNode();
  }
  return { visible_text_total_length: rawText.length, visible_text_truncated: rawText.length > 9000,
    repeated_candidates: groups, scan_limits: { max_nodes: maxNodes, max_parents: maxParents, max_groups: maxGroups, max_items_per_group: maxItems, max_children_per_parent: 100 },
    scan_stopped_at_limit: Boolean(node && (scanned >= maxNodes || parents >= maxParents || groups.length >= maxGroups)) };
}
