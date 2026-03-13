export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTooltipIcon(text, className = 'geo-tooltip-icon translation-tooltip-icon') {
  const safeText = escapeHtml(text);
  return `<span class="${className}" tabindex="0" role="img" aria-label="${safeText}" data-tooltip="${safeText}">?</span>`;
}

export function syncAriaTabButtons(buttons, getIsActive) {
  buttons.forEach((button) => {
    const isActive = Boolean(getIsActive(button));
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

export function syncActivePanels(panels, getIsActive, activeClass = 'active') {
  panels.forEach((panel) => {
    panel.classList.toggle(activeClass, Boolean(getIsActive(panel)));
  });
}

