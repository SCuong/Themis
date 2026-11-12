// Composer file attachments: pick, paste or drop files, show them as preview tiles, open them in a side viewer.
// team.js reads globalThis.themisComposerFiles; background.js forwards the files to each member's AI page.
// Files are also kept in IndexedDB so a sent message can still preview its files after a reload.

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Base64 makes a message ~4/3 of this; Chrome caps one extension message at 64 MiB.
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;

const isEnglish = () => document.documentElement.lang === "en";
const t = (en, vi) => (isEnglish() ? en : vi);

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|log|html?|css|s?js|mjs|cjs|jsx|tsx?|py|java|kt|c|h|cc|cpp|hpp|cs|go|rs|rb|php|swift|sql|sh|ps1|bat|vue|svelte)$/i;

export function fileKind({ name = "", type = "" }) {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  // Before the text check: the DOCX MIME type contains "xml" (openxmlformats).
  if (/wordprocessingml\.document$/.test(type) || /\.docx$/i.test(name)) return "docx";
  if (type.startsWith("text/") || /json|xml|javascript|yaml/.test(type) || TEXT_FILE.test(name)) return "text";
  return "file";
}

// Returns the files that fit the limits plus one message per rejected file.
export function checkLimits(current, incoming) {
  const accepted = [];
  const errors = [];
  let total = current.reduce((sum, file) => sum + file.size, 0);
  for (const file of incoming) {
    if (current.length + accepted.length >= MAX_FILES) {
      errors.push(t(`Up to ${MAX_FILES} files per message.`, `Tối đa ${MAX_FILES} tệp mỗi tin nhắn.`));
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(t(`${file.name} is larger than ${formatSize(MAX_FILE_BYTES)}.`, `${file.name} lớn hơn ${formatSize(MAX_FILE_BYTES)}.`));
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      errors.push(t(`Total attachments cannot exceed ${formatSize(MAX_TOTAL_BYTES)}.`, `Tổng dung lượng tệp không vượt quá ${formatSize(MAX_TOTAL_BYTES)}.`));
      continue;
    }
    total += file.size;
    accepted.push(file);
  }
  return { accepted, errors };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Cannot read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// background.js (otDeleteComposerFiles) removes a chat's files from this store when the chat is deleted.
const fileStore = (() => {
  let opening;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("themis.composerFiles", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = (mode, action) =>
    open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const request = action(db.transaction("files", mode).objectStore("files"));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
    );
  return {
    put: (record) => run("readwrite", (store) => store.put(record)),
    get: (id) => run("readonly", (store) => store.get(id)),
    delete: (id) => run("readwrite", (store) => store.delete(id)),
  };
})();

// The extension CSP (connect-src) blocks fetch() of blob: URLs, so the viewer reads each file from its Blob instead.
const blobsByUrl = new Map();
function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  blobsByUrl.set(url, blob);
  return url;
}
const storedUrls = new Map();
function storedUrl(id) {
  if (!storedUrls.has(id)) {
    storedUrls.set(id, fileStore.get(id).then((record) => (record?.blob ? objectUrl(record.blob) : undefined)).catch(() => undefined));
  }
  return storedUrls.get(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// file: { name, type, size, url? }. Images and videos fill the tile; other files show an icon and their name.
function tile(file, { onOpen, onRemove } = {}) {
  const kind = fileKind(file);
  const visual = file.url && (kind === "image" || kind === "video");
  const item = el("li", `file-tile${visual ? " is-visual" : ""}`);
  item.dataset.kind = kind;
  const open = el("button", "file-tile-open");
  open.type = "button";
  open.title = `${file.name} · ${formatSize(file.size)}`;
  open.setAttribute("aria-label", t(`Open ${file.name}`, `Mở ${file.name}`));
  const preview = el("span", "file-tile-preview");
  if (visual && kind === "image") {
    const img = el("img");
    img.src = file.url;
    img.alt = "";
    preview.append(img);
  } else if (visual) {
    const video = el("video");
    video.src = file.url;
    video.muted = true;
    video.preload = "metadata";
    video.setAttribute("aria-hidden", "true");
    preview.append(video, el("span", "file-tile-play"));
  } else {
    preview.append(el("span", "file-tile-icon"));
  }
  open.append(preview);
  if (!visual) {
    const label = el("span", "file-tile-name");
    label.append(el("span", "file-tile-type"), el("span", "file-tile-label", file.name));
    open.append(label);
  }
  open.addEventListener("click", () => onOpen?.(file, open));
  item.append(open);
  if (onRemove) {
    const remove = el("button", "file-tile-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", t(`Remove ${file.name}`, `Bỏ ${file.name}`));
    remove.addEventListener("click", onRemove);
    item.append(remove);
  }
  return item;
}

function createViewer() {
  const panel = el("aside", "file-viewer");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "file-viewer-title");
  panel.hidden = true;
  const header = el("header", "file-viewer-header");
  const heading = el("div", "file-viewer-heading");
  const title = el("h2", "file-viewer-title");
  title.id = "file-viewer-title";
  const meta = el("p", "file-viewer-meta");
  heading.append(title, meta);
  const download = el("a", "file-viewer-action file-viewer-download");
  const close = el("button", "file-viewer-action file-viewer-close");
  close.type = "button";
  header.append(heading, download, close);
  const body = el("div", "file-viewer-body");
  panel.append(header, body);
  document.body.append(panel);

  let returnFocus;
  // On wide windows the viewer pushes the chat left and folds the sidebar, through the app's own collapse button.
  const wide = matchMedia("(min-width: 961px)");
  let foldedSidebar = false;
  const sidebarCollapsed = () => document.querySelector(".app-shell")?.classList.contains("sidebar-collapsed");
  function hide() {
    if (panel.hidden) return;
    panel.hidden = true;
    body.replaceChildren();
    document.documentElement.classList.remove("file-viewer-open");
    if (foldedSidebar && sidebarCollapsed()) document.getElementById("collapse-sidebar")?.click();
    foldedSidebar = false;
    returnFocus?.focus();
  }
  close.addEventListener("click", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) hide();
  });

  async function show(file, opener) {
    returnFocus = opener;
    const kind = fileKind(file);
    title.textContent = file.name;
    const extension = /.([a-z0-9]{1,8})$/i.exec(file.name)?.[1].toUpperCase();
    meta.textContent = [formatSize(file.size), extension ?? file.type].filter(Boolean).join(" · ");
    close.setAttribute("aria-label", t("Close file viewer", "Đóng trình xem tệp"));
    download.setAttribute("aria-label", t(`Download ${file.name}`, `Tải xuống ${file.name}`));
    download.title = download.getAttribute("aria-label");
    download.hidden = !file.url;
    if (file.url) {
      download.href = file.url;
      download.download = file.name;
    }
    const content = await viewerContent(file, kind);
    body.dataset.kind = content.classList.contains("file-viewer-markdown") ? "markdown" : kind;
    body.replaceChildren(content);
    if (panel.hidden && wide.matches) {
      document.documentElement.classList.add("file-viewer-open");
      if (!sidebarCollapsed()) {
        document.getElementById("collapse-sidebar")?.click();
        foldedSidebar = true;
      }
    }
    panel.hidden = false;
    close.focus();
  }
  return { show, hide };
}

async function viewerContent(file, kind) {
  if (!file.url) return el("p", "file-viewer-empty", t("This file is no longer stored on this device.", "Tệp này không còn được lưu trên máy này."));
  if (kind === "image") {
    const img = el("img");
    img.src = file.url;
    img.alt = file.name;
    return img;
  }
  if (kind === "video" || kind === "audio") {
    const media = el(kind);
    media.src = file.url;
    media.controls = true;
    return media;
  }
  if (kind === "pdf") {
    const frame = el("iframe");
    frame.src = file.url;
    frame.title = file.name;
    return frame;
  }
  if (kind === "text") {
    const blob = blobsByUrl.get(file.url);
    const text = await blob.slice(0, MAX_TEXT_PREVIEW_BYTES).text();
    const MarkdownIt = globalThis.ThemisMarkdownIt;
    if (MarkdownIt && /\.(md|markdown)$/i.test(file.name)) {
      // html: false keeps any HTML in the file as text, so a shared document cannot inject markup.
      const doc = el("article", "markdown-body file-viewer-markdown");
      doc.innerHTML = new MarkdownIt({ html: false, linkify: true }).render(text);
      for (const link of doc.querySelectorAll("a[href]")) Object.assign(link, { target: "_blank", rel: "noreferrer" });
      return doc;
    }
    return el("pre", "file-viewer-text", blob.size > MAX_TEXT_PREVIEW_BYTES ? `${text}\n…` : text);
  }
  if (kind === "docx") {
    try {
      const mammoth = await loadMammoth();
      const { value } = await mammoth.convertToHtml(
        { arrayBuffer: await blobsByUrl.get(file.url).arrayBuffer() },
        { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] },
      );
      const doc = el("article", "markdown-body file-viewer-markdown");
      doc.innerHTML = value;
      // Keep only web and mail links from the document; anything else (javascript:, file:) loses its href.
      for (const link of doc.querySelectorAll("a[href]")) {
        if (/^(https?:|mailto:|#)/i.test(link.getAttribute("href"))) Object.assign(link, { target: "_blank", rel: "noreferrer" });
        else link.removeAttribute("href");
      }
      return doc;
    } catch {
      return noPreview(t("This document could not be read. Download it to open.", "Không đọc được tài liệu này. Hãy tải xuống để mở."));
    }
  }
  return noPreview(t("No preview for this file type. Download it to open.", "Không xem trước được loại tệp này. Hãy tải xuống để mở."));
}

function noPreview(message) {
  const empty = el("div", "file-viewer-empty");
  empty.append(el("span", "file-tile-icon"), el("p", "", message));
  return empty;
}

// mammoth.js (BSD-2) converts .docx to clean HTML; it is ~640 KB, so it loads on the first DOCX opened.
let mammothLoading;
function loadMammoth() {
  return (mammothLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "vendor/mammoth-1.8.0.browser.min.js";
    script.onload = () => (globalThis.mammoth ? resolve(globalThis.mammoth) : reject(new Error("mammoth missing")));
    script.onerror = () => {
      mammothLoading = undefined;
      reject(new Error("Cannot load the DOCX reader"));
    };
    document.head.append(script);
  }));
}

function init() {
  const input = document.getElementById("composer-file-input");
  const button = document.getElementById("attach-file");
  const list = document.getElementById("composer-files");
  const status = document.getElementById("composer-files-status");
  const files = [];
  if (!input || !button || !list || !status) return;
  const viewer = createViewer();

  function render() {
    list.replaceChildren(
      ...files.map((file, index) =>
        tile(file, {
          onOpen: viewer.show,
          onRemove() {
            const [removed] = files.splice(index, 1);
            fileStore.delete(removed.id).catch(() => {});
            URL.revokeObjectURL(removed.url);
            blobsByUrl.delete(removed.url);
            render();
            document.getElementById("message-input")?.focus();
          },
        }),
      ),
    );
    list.hidden = files.length === 0;
    button.classList.toggle("has-files", files.length > 0);
  }

  async function add(selected) {
    const { accepted, errors } = checkLimits(files, [...selected]);
    for (const file of accepted) {
      try {
        const id = `file-${Date.now().toString(36)}-${crypto.randomUUID()}`;
        files.push({ id, name: file.name, type: file.type, size: file.size, url: objectUrl(file), dataUrl: await readAsDataUrl(file) });
        await fileStore.put({ id, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() }).catch(() => {});
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    status.textContent = errors.join(" ");
    render();
  }

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    add(input.files ?? []).finally(() => {
      input.value = "";
    });
  });
  // Pasting files into the message box attaches them too.
  document.getElementById("message-input")?.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.files;
    if (!pasted?.length) return;
    event.preventDefault();
    add(pasted);
  });

  // Dropping files anywhere on the conversation attaches them. Elsewhere, block the browser from opening the file.
  const composer = document.getElementById("composer");
  const dropZone = composer?.closest("main") ?? composer;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  let dragDepth = 0;
  const setDragging = (on) => composer?.classList.toggle("is-file-drop", on);
  document.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dropZone?.contains(event.target) ? "copy" : "none";
  });
  document.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);
    if (dropZone?.contains(event.target)) add(event.dataTransfer.files);
  });
  dropZone?.addEventListener("dragenter", (event) => {
    if (hasFiles(event) && dragDepth++ === 0) setDragging(true);
  });
  dropZone?.addEventListener("dragleave", (event) => {
    if (hasFiles(event) && --dragDepth <= 0) {
      dragDepth = 0;
      setDragging(false);
    }
  });

  globalThis.themisComposerFiles = {
    list: () => files.map(({ id, name, type, size, dataUrl }) => ({ id, name, type, size, dataUrl })),
    // After a send the tiles leave the composer; the stored copies stay for the sent message.
    clear() {
      files.splice(0);
      status.textContent = "";
      render();
    },
    messageFiles(message) {
      if (!message.files?.length) return undefined;
      const group = el("ul", "message-files");
      group.setAttribute("aria-label", t("Attached files", "Tệp đính kèm"));
      for (const meta of message.files) {
        const placeholder = tile(meta, { onOpen: viewer.show });
        group.append(placeholder);
        if (meta.id) {
          storedUrl(meta.id).then((url) => {
            if (url) placeholder.replaceWith(tile({ ...meta, url }, { onOpen: viewer.show }));
          });
        }
      }
      return group;
    },
  };
}

if (typeof document !== "undefined") init();
