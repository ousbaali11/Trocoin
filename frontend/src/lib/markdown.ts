/**
 * Rendu Markdown minimal et sûr pour les pages du CMS et du centre d'aide
 * (titres ##, listes - et 1., gras **, italique _, paragraphes). Tout le HTML
 * source est échappé : aucun script ni balise ne peut être injecté depuis le
 * back-office.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, "$1<em>$2</em>");
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let listTag: "ul" | "ol" = "ul";
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<${listTag}>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</${listTag}>`);
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const level = Math.min(h[1].length + 1, 4);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    const oli = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (li || oli) {
      flushPara();
      const tag: "ul" | "ol" = li ? "ul" : "ol";
      if (list.length && tag !== listTag) flushList();
      listTag = tag;
      list.push((li ?? oli)![1]);
      continue;
    }
    if (line.trim() === "") {
      flushPara(); flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}
