// Minimal DOM helpers so components can build trees without a framework.
// (Design doc allows plain CSS/DOM; we keep this tiny and dependency-free.)

// el("div", { class: "x", onClick: fn, dataset: { id } }, [children|strings])
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "value") node.value = v;
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Split an article body (which uses \n\n between paragraphs) into <p> nodes.
export function paragraphs(text) {
  return String(text || "")
    .split(/\n\n+/)
    .map((p) => el("p", {}, p.trim()));
}
