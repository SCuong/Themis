function text(language, english, vietnamese) {
  return language === 'en' ? english : vietnamese;
}

export function appendPersonaEditor(container, header, preview, role, store, runCommand) {
  const template = store.roleTemplatesById[role.templateId];
  if (template?.type !== 'custom' || role.createdBy?.startsWith('orchestration-')) {
    container.append(header, preview);
    return;
  }
  const language = store.settings.language;
  const form = document.createElement('form');
  form.className = 'member-persona-editor';
  const label = document.createElement('label');
  label.htmlFor = 'member-persona-input';
  label.textContent = text(language, 'Persona', 'Persona');
  const input = document.createElement('textarea');
  input.id = label.htmlFor;
  input.value = template.systemPrompt;
  input.rows = 10;
  const hint = document.createElement('p');
  hint.className = 'tiny';
  hint.textContent = text(language,
    'Saved to the people library and applied to all chats using this person. Previous messages stay as they are.',
    'Lưu vào thư viện và áp dụng cho mọi cuộc trò chuyện dùng nhân vật này. Các tin nhắn trước đó được giữ nguyên.');
  const error = document.createElement('p');
  error.className = 'persona-save-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-primary';
  save.textContent = text(language, 'Save persona', 'Lưu persona');
  form.append(label, input, hint, error, save);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    save.textContent = text(language, 'Saving…', 'Đang lưu…');
    error.hidden = true;
    try {
      await runCommand('ROLE_TEMPLATE_UPDATE', {
        templateId: template.id,
        patch: { ...template, systemPrompt: input.value.trim() },
      });
      container.closest('.modal-backdrop')?.remove();
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      error.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = text(language, 'Save persona', 'Lưu persona');
    }
  });
  container.append(header, form);
}

export function appendStageConnections(container, stage, stages, edges, update, language, getBranch) {
  if (stages.length < 2) return;
  const tr = (en, vi) => text(language, en, vi);
  const group = document.createElement('fieldset');
  group.className = 'field stage-connections';
  const heading = document.createElement('legend');
  heading.textContent = tr('Connections', 'Liên kết');
  const target = document.createElement('select');
  target.id = 'stage-connection-target';
  const label = document.createElement('label');
  label.htmlFor = target.id;
  label.textContent = tr('Next node', 'Nút tiếp theo');
  const branch = document.createElement('select');
  branch.setAttribute('aria-label', tr('Review outcome', 'Kết quả đánh giá'));
  branch.append(new Option(tr('Pass', 'Đạt'), 'pass'), new Option(tr('Fail', 'Không đạt'), 'fail'));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.textContent = tr('Connect', 'Kết nối');
  const list = document.createElement('ul');
  list.className = 'stage-connection-list';
  const refresh = next => {
    edges = next;
    const outgoing = edges.filter(edge => edge.sourceStageId === stage.id);
    target.replaceChildren(new Option(tr('Choose a node', 'Chọn nút'), ''));
    for (const candidate of stages) {
      if (candidate.id !== stage.id && !outgoing.some(edge => edge.targetStageId === candidate.id)) {
        target.add(new Option(candidate.name, candidate.id));
      }
    }
    add.disabled = true;
    list.replaceChildren();
    for (const edge of outgoing) {
      const name = stages.find(item => item.id === edge.targetStageId)?.name;
      if (!name) continue;
      const row = document.createElement('li');
      const outcome = getBranch(edge);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger';
      remove.textContent = tr('Remove', 'Xóa');
      remove.setAttribute('aria-label', tr(`Remove connection to ${name}`, `Xóa liên kết đến ${name}`));
      remove.addEventListener('click', () => commit(edges.filter(item => item !== edge)));
      row.append(outcome ? `${name} · ${outcome === 'fail' ? tr('Fail', 'Không đạt') : tr('Pass', 'Đạt')}` : name, remove);
      list.append(row);
    }
  };
  const commit = next => {
    update(next);
    refresh(next);
    target.focus();
  };
  target.addEventListener('change', () => { add.disabled = !target.value; });
  add.addEventListener('click', () => {
    if (!target.value) return;
    commit([...edges, {
      sourceStageId: stage.id, targetStageId: target.value,
      sourcePort: stage.kind === 'review' ? branch.value : 'out', targetPort: 'in',
    }]);
  });
  group.append(heading, list, label, target);
  if (stage.kind === 'review') group.append(branch);
  group.append(add);
  container.append(group);
  refresh(edges);
}

function manageDialogs(shell) {
  const stack = [];
  let trigger;
  const closeSelector = '.modal-close';
  const dialogSelector = '.modal-backdrop';
  const available = el => el?.isConnected && !el.closest('[inert], [hidden]') && el.checkVisibility({ visibilityProperty: true });

  document.addEventListener('click', event => {
    trigger = event.target.closest('button, [role="button"]');
  }, true);

  const observer = new MutationObserver(() => {
    const before = stack.at(-1);
    for (let i = stack.length - 1; i >= 0; i--) {
      const { backdrop } = stack[i];
      if (backdrop.isConnected && !backdrop.hidden) continue;
      backdrop.inert = false;
      backdrop.style.removeProperty('z-index');
      stack.splice(i, 1);
    }
    for (const backdrop of document.querySelectorAll(dialogSelector)) {
      if (backdrop.hidden || stack.some(entry => entry.backdrop === backdrop)) continue;
      const dialog = backdrop.querySelector('[role="dialog"]');
      if (!dialog) continue;
      dialog.tabIndex = -1;
      stack.push({ backdrop, dialog, trigger: trigger || document.activeElement });
    }
    const top = stack.at(-1);
    shell.inert = Boolean(top);
    for (const surface of document.querySelectorAll('#notes-panel, #window-launcher')) surface.inert = Boolean(top);
    stack.forEach(({ backdrop }, index) => {
      backdrop.style.zIndex = String(50 + index);
      backdrop.inert = backdrop !== top.backdrop;
    });
    if (top === before) return;
    const target = before && !stack.includes(before) ? before.trigger : null;
    const replacement = target?.dataset.rolePromptDetail
      ? document.querySelector(`[data-role-prompt-detail="${CSS.escape(target.dataset.rolePromptDetail)}"]`)
      : null;
    if (available(target)) target.focus({ preventScroll: true });
    else if (available(replacement)) replacement.focus({ preventScroll: true });
    else if (top && !top.dialog.contains(document.activeElement)) top.dialog.focus({ preventScroll: true });
    else if (!top && target?.closest('#role-panel')) document.getElementById('toggle-people-drawer').focus();
  });
  observer.observe(document.body, { childList: true });
  for (const backdrop of document.querySelectorAll(dialogSelector)) {
    observer.observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });
  }
  document.addEventListener('keydown', event => {
    const top = stack.at(-1);
    if (!top) return;
    if (event.key === 'Escape') {
      const close = top.dialog.querySelector(closeSelector);
      if (!close) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.click();
    } else if (event.key === 'Tab') {
      const controls = [...top.dialog.querySelectorAll('button, input, select, textarea, a[href], [contenteditable], [tabindex]')]
        .filter(el => el.tabIndex >= 0 && !el.disabled && available(el));
      const first = controls[0];
      const last = controls.at(-1);
      const current = document.activeElement;
      if (current === (event.shiftKey ? first : last) || current === top.dialog || !top.dialog.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  }, true);
}

function manageTabs() {
  for (const group of document.querySelectorAll('[role="tablist"]')) {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    if (!tabs.length) continue;
    const sync = () => {
      for (const tab of tabs) {
        const selected = tab.classList.contains('active');
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected) document.getElementById(tab.getAttribute('aria-controls'))?.setAttribute('aria-labelledby', tab.id);
      }
    };
    const observer = new MutationObserver(sync);
    for (const tab of tabs) observer.observe(tab, { attributes: true, attributeFilter: ['class'] });
    sync();
    group.addEventListener('keydown', event => {
      const enabled = tabs.filter(tab => !tab.disabled);
      const index = enabled.indexOf(event.target);
      if (index < 0) return;
      const next = {
        ArrowLeft: enabled[(index + enabled.length - 1) % enabled.length],
        ArrowRight: enabled[(index + 1) % enabled.length],
        Home: enabled[0],
        End: enabled.at(-1),
      }[event.key];
      if (!next) return;
      event.preventDefault();
      next.click();
      next.focus();
    });
  }
}

// Same rule as the send parser: "@label" for a label of this chat (longest first), ended by text end, space or punctuation.
export function mentionSegments(value, labels = []) {
  const sorted = [...new Set(labels)].filter(Boolean).sort((a, b) => b.length - a.length);
  const segments = [];
  let plain = '';
  for (let index = 0; index < value.length;) {
    const label = value[index] === '@' && sorted.find(name => value.startsWith(`@${name}`, index) &&
      (index + name.length + 1 === value.length || /\s|[,.!?;:]/.test(value[index + name.length + 1])));
    if (!label) { plain += value[index++]; continue; }
    if (plain) segments.push({ text: plain, mention: false });
    plain = '';
    segments.push({ text: `@${label}`, mention: true });
    index += label.length + 1;
  }
  if (plain) segments.push({ text: plain, mention: false });
  return segments;
}

// One tooltip for icon-only controls (narrow, with an accessible name): after a short hover, or at once on keyboard focus.
function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'ui-tooltip';
  tip.setAttribute('aria-hidden', 'true'); // the control's aria-label already names it
  document.body.append(tip);
  let timer, pending, shown;
  const control = node => node?.closest?.('button, [role="button"]');
  // Some icon buttons are named by text shrunk to font-size 0 (e.g. Restore session), or by a label that CSS clips
  // to 1px when the toolbar goes icon-only in a narrow window (Orchestration, Members, Notes).
  const clipped = el => [...el.children].find(child => child.textContent.trim() && child.getBoundingClientRect().width <= 1)?.textContent.trim() || '';
  const label = el => el.getAttribute('aria-label') || el.getAttribute('title') || el.dataset.tooltip ||
    (getComputedStyle(el).fontSize === '0px' ? el.textContent.trim() : clipped(el));
  // A clipped label counts whatever the width: Members keeps its count badge beside the icon.
  const iconOnly = el => el && !el.disabled && (el.getBoundingClientRect().width <= 56 || clipped(el)) && label(el);
  const hide = () => { clearTimeout(timer); pending = shown = undefined; tip.classList.remove('visible'); };
  const show = el => {
    // The browser's own title tooltip would show a second, slower copy.
    if (el.hasAttribute('title')) { el.dataset.tooltip = el.title; el.removeAttribute('title'); }
    tip.textContent = label(el);
    const box = el.getBoundingClientRect(), size = tip.getBoundingClientRect();
    if (el.closest('.sidebar-collapsed .sidebar')) {
      // In the vertical rail, below would cover the next icon: open to the right.
      tip.style.top = `${box.top + box.height / 2 - size.height / 2}px`;
      tip.style.left = `${box.right + 8}px`;
    } else {
      const below = box.bottom + 6 + size.height <= innerHeight;
      tip.style.top = `${below ? box.bottom + 6 : box.top - 6 - size.height}px`;
      tip.style.left = `${Math.min(Math.max(4, box.left + box.width / 2 - size.width / 2), innerWidth - size.width - 4)}px`;
    }
    tip.classList.add('visible');
    shown = el;
  };
  document.addEventListener('pointerover', event => {
    const el = control(event.target);
    if (el && (el === pending || el === shown)) return;
    hide();
    if (!iconOnly(el)) return;
    if (el.hasAttribute('title')) { el.dataset.tooltip = el.title; el.removeAttribute('title'); }
    pending = el;
    timer = setTimeout(() => show(el), 400);
  });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) hide(); });
  document.addEventListener('focusin', event => { const el = control(event.target); hide(); if (iconOnly(el) && el.matches(':focus-visible')) show(el); });
  for (const type of ['focusout', 'pointerdown', 'scroll']) document.addEventListener(type, hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}

export function initializeTeamUI() {
  installTooltips();
  const shell = document.querySelector('.app-shell');
  const toggle = document.getElementById('toggle-chat-sidebar');
  const backdrop = document.getElementById('chat-sidebar-backdrop');
  const sidebar = document.querySelector('.sidebar');
  const media = matchMedia('(max-width: 960px)');
  if (!shell || !toggle || !backdrop || !sidebar) return;
  shell.append(backdrop);
  const workspace = shell.querySelector('.workspace');
  const navChats = document.getElementById('open-chats');
  const closeChats = document.getElementById('close-chat-sidebar');
  const quickCreate = document.getElementById('quick-create-chat');
  const input = document.getElementById('message-input');
  const settings = document.getElementById('settings-menu');
  const settingsButton = document.getElementById('settings-button');
  const drawer = document.querySelector('.role-panel');
  const drawerButton = document.getElementById('toggle-people-drawer');
  const closeDrawer = document.getElementById('close-people-drawer');
  let sidebarTrigger;
  // Wide windows can fold the sidebar to an icon rail; narrow ones always use the drawer.
  const collapse = document.getElementById('collapse-sidebar');
  const collapseKey = 'themis.sidebarCollapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(collapseKey) === '1'; } catch {}
  const applyCollapsed = () => {
    const language = document.documentElement.lang;
    shell.classList.toggle('sidebar-collapsed', collapsed);
    collapse?.setAttribute('aria-expanded', String(!collapsed));
    collapse?.setAttribute('aria-label', collapsed ? text(language, 'Expand sidebar', 'Mở rộng thanh bên') : text(language, 'Collapse sidebar', 'Thu gọn thanh bên'));
  };
  const setCollapsed = next => {
    collapsed = next;
    try { localStorage.setItem(collapseKey, next ? '1' : '0'); } catch {}
    applyCollapsed();
  };
  collapse?.addEventListener('click', () => setCollapsed(!collapsed));
  // New chat opens its form inside the list, so it needs the full sidebar.
  quickCreate?.addEventListener('click', () => { if (collapsed && !media.matches) setCollapsed(false); }, true);
  const updateLabels = () => {
    const language = document.documentElement.lang;
    const label = (id, english, vietnamese) => {
      const element = document.getElementById(id);
      if (element) element.setAttribute('aria-label', text(language, english, vietnamese));
    };
    label('toggle-chat-sidebar', 'Chats', 'Trò chuyện');
    label('close-chat-sidebar', 'Close chats', 'Đóng danh sách trò chuyện');
    label('chat-sidebar-backdrop', 'Close chats', 'Đóng danh sách trò chuyện');
    label('message-input', 'Message', 'Tin nhắn');
    label('send-message', 'Send message', 'Gửi tin nhắn');
    label('close-people-drawer', 'Close members', 'Đóng danh sách thành viên');
    label('people-library-search', 'Search people', 'Tìm nhân vật');
    label('add-person-search', 'Search people', 'Tìm nhân vật');
    for (const [id, en, vi] of [
      ['open-chats', 'Chats', 'Chat'], ['open-all-notes', 'Notes', 'Ghi chú'],
      ['open-people-library', 'People', 'Nhân vật'], ['open-external-models', 'Models', 'Mô hình'],
      ['settings-button', 'Settings', 'Cài đặt'], ['quick-create-chat', 'New chat', 'Tạo chat'],
    ]) {
      const button = document.getElementById(id);
      const caption = button?.querySelector('.rail-label');
      if (caption) caption.textContent = text(language, en, vi);
      label(id, en, vi);
    }
    document.getElementById('chat-list-label').textContent = text(language, 'Chats', 'Trò chuyện');
    applyCollapsed();
    document.getElementById('settings-title').textContent = text(language, 'Settings', 'Cài đặt');
    document.getElementById('theme-label').textContent = text(language, 'Appearance', 'Giao diện');
    document.getElementById('window-controls-label').textContent = text(language, 'Window', 'Cửa sổ');
    document.getElementById('workflow-people-title').textContent = text(language, 'Teammates', 'Thành viên');
    document.getElementById('workflow-people-help').textContent = text(language, 'Select or drag to add a node.', 'Chọn hoặc kéo để thêm nút.');
  };
  new MutationObserver(updateLabels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  updateLabels();
  // team.js fills the @ list and the send hint after its page-wide translation pass, so they stayed English.
  const mentionPanel = document.getElementById('mention-panel');
  const targetPreview = document.getElementById('target-preview');
  if (mentionPanel && targetPreview) import('./localization.js').then(({ localizeUI }) => {
    const localizeLive = () => {
      const language = document.documentElement.lang;
      if (language !== 'vi') return;
      const walker = document.createTreeWalker(mentionPanel, NodeFilter.SHOW_TEXT);
      // Only the fixed "everyone" row: teammate names are user data and must not be translated.
      for (let node; (node = walker.nextNode());) if (node.data === 'Everyone' || node.data === 'All people') node.data = localizeUI(node.data, language);
      const hint = targetPreview.childElementCount ? null : localizeUI(targetPreview.textContent, language);
      if (hint && hint !== targetPreview.textContent) targetPreview.textContent = hint;
    };
    new MutationObserver(localizeLive).observe(mentionPanel, { childList: true, subtree: true });
    new MutationObserver(localizeLive).observe(targetPreview, { childList: true, characterData: true, subtree: true });
    localizeLive();
  }).catch(() => {});
  const setOpen = (open, restore = false) => {
    const visible = Boolean(open && media.matches);
    shell.classList.toggle('chat-sidebar-open', visible);
    toggle.setAttribute('aria-expanded', String(visible));
    if (media.matches) navChats?.setAttribute('aria-expanded', String(visible));
    else navChats?.removeAttribute('aria-expanded');
    backdrop.hidden = !visible;
    sidebar.inert = media.matches && !visible;
    workspace.inert = visible;
    if (visible) (sidebar.querySelector('.chat-item.active .chat-name') || quickCreate)?.focus({ preventScroll: true });
    else if (restore) (sidebarTrigger || toggle).focus({ preventScroll: true });
  };
  const toggleSidebar = event => {
    if (!media.matches) {
      if (collapsed) setCollapsed(false);
      (sidebar.querySelector('.chat-item.active .chat-name') || quickCreate)?.focus();
      return;
    }
    if (shell.classList.contains('chat-sidebar-open')) setOpen(false, true);
    else { sidebarTrigger = event.currentTarget; setOpen(true); }
  };
  toggle.addEventListener('click', toggleSidebar);
  navChats?.addEventListener('click', toggleSidebar);
  backdrop.addEventListener('click', () => setOpen(false, true));
  closeChats?.addEventListener('click', () => setOpen(false, true));
  media.addEventListener('change', () => setOpen(false));
  document.addEventListener('keydown', event => {
    // Escape closes the top layer only: a dialog or the settings menu opened from the drawer goes first.
    if (event.key !== 'Escape' || !shell.classList.contains('chat-sidebar-open') || sidebar.querySelector('.chat-action-menu') ||
        !sidebar.contains(event.target) || (settings && !settings.hidden)) return;
    const cancel = document.getElementById('cancel-create-chat');
    if (cancel?.checkVisibility()) {
      cancel.click();
      quickCreate?.focus({ preventScroll: true });
    } else setOpen(false, true);
  }, true);
  document.getElementById('chat-list')?.addEventListener('click', event => {
    if (shell.classList.contains('chat-sidebar-open') && event.target.closest('.chat-item') &&
        !event.target.closest('.chat-menu-btn, .chat-action-menu')) setOpen(false, true);
  }, true);
  setOpen(false);

  const mirror = document.getElementById('message-input-mirror');
  if (input && mirror) {
    const labels = () => { try { return JSON.parse(input.dataset.mentionLabels || '[]'); } catch { return []; } };
    const paint = () => {
      mirror.replaceChildren(...mentionSegments(input.value, labels()).map(({ text: part, mention: isMention }) => {
        if (!isMention) return part;
        const span = document.createElement('span');
        span.className = 'message-input-mention';
        span.textContent = part;
        return span;
      }), '\n');
      mirror.scrollTop = input.scrollTop;
    };
    const sync = () => {
      const style = getComputedStyle(input);
      for (const key of ['font', 'lineHeight', 'letterSpacing', 'padding', 'borderWidth', 'textIndent', 'tabSize']) mirror.style[key] = style[key];
      mirror.style.borderStyle = 'solid';
      mirror.style.borderColor = 'transparent';
    };
    // team.js assigns input.value directly (insert mention, clear after send) without an input event.
    const value = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(input, 'value', { configurable: true, get() { return value.get.call(this); }, set(next) { value.set.call(this, next); paint(); } });
    for (const type of ['input', 'scroll', 'select']) input.addEventListener(type, paint);
    // team.js publishes this chat's mention labels; members joining or leaving recolour the draft.
    new MutationObserver(paint).observe(input, { attributes: true, attributeFilter: ['data-mention-labels'] });
    new ResizeObserver(() => { sync(); paint(); }).observe(input);
    sync();
    paint();
    mirror.parentElement.classList.add('has-mirror');
  }


  // team.js writes the header buttons as plain text; this splits "Members 3" into a label and a count badge.
  const headerButtons = ['toggle-people-drawer', 'toggle-notes-panel'].map(id => document.getElementById(id)).filter(Boolean);
  if (headerButtons.length) {
    const decorate = () => {
      for (const button of headerButtons) {
        if (button.querySelector('.header-label')) continue;
        const [, name, count] = button.textContent.trim().match(/^(.*?)\s*(\d+)?$/);
        const label = document.createElement('span');
        label.className = 'header-label';
        label.textContent = name;
        const badge = document.createElement('span');
        badge.className = 'header-count';
        badge.textContent = count ?? '';
        button.replaceChildren(label, ...(count ? [badge] : []));
      }
    };
    for (const element of headerButtons) new MutationObserver(decorate).observe(element, { childList: true, characterData: true, subtree: true });
    decorate();
  }

  if (drawer) {
    const updateDrawer = () => {
      drawer.inert = !drawer.classList.contains('open');
      if (!drawer.inert && document.activeElement === drawerButton) closeDrawer?.focus({ preventScroll: true });
    };
    new MutationObserver(updateDrawer).observe(drawer, { attributes: true, attributeFilter: ['class'] });
    updateDrawer();
    closeDrawer?.addEventListener('click', () => drawerButton?.focus({ preventScroll: true }));
    drawer.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeDrawer?.click();
      }
    });
  }
  if (settings && settingsButton) {
    new MutationObserver(() => {
      if (!settings.hidden) settings.querySelector('.theme-option[aria-pressed="true"]')?.focus({ preventScroll: true });
    }).observe(settings, { attributes: true, attributeFilter: ['hidden'] });
    settings.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        settingsButton.click();
        settingsButton.focus({ preventScroll: true });
      }
    });
  }
  manageDialogs(shell);
  manageTabs();
}
