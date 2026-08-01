'use strict';

const ICONS = {
  smile: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10.2" r="1.15" fill="currentColor"/><circle cx="15" cy="10.2" r="1.15" fill="currentColor"/><path d="M8.7 13.6c.9 1.25 2.1 1.9 3.3 1.9s2.4-.65 3.3-1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  cat: '<circle cx="12" cy="13.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.6 9.6 7.2 5.8l3.4 2.3M15.4 9.6l1.4-3.8-3.4 2.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.6" cy="13.6" r=".9" fill="currentColor"/><circle cx="14.4" cy="13.6" r=".9" fill="currentColor"/><path d="M11 15.6h2M11 15.6l-.7 2M13 15.6l.7 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  robot: '<rect x="5.5" y="8.5" width="13" height="9.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="9.4" y="12" width="2" height="2.6" rx="1" fill="currentColor"/><rect x="12.6" y="12" width="2" height="2.6" rx="1" fill="currentColor"/><path d="M12 8.5V5.5M9.8 5.5h4.4M12 17.8c-.6-.5-1.6-.5-2.2 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  star: '<path d="M12 3.5l2.4 5.4 5.9.6-4.5 3.9 1.3 5.8L12 16.2l-5.1 3 1.3-5.8L3.7 9.5l5.9-.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  heart: '<path d="M12 20s-7-4.3-7-9.4C5 7.9 7 6 9.2 6c1.3 0 2.3.6 2.8 1.5C12.5 6.6 13.5 6 14.8 6 17 6 19 7.9 19 10.6c0 5.1-7 9.4-7 9.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  rocket: '<path d="M12 14.5c3.5-3 5-6 5-9.5-3.5 0-6.5 1.5-9.5 5l1.5 4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10.8 12.8 8 16.5M14 14l3.7 2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="11" r="1.1" fill="currentColor"/>',
  crown: '<path d="M4 17h16M5.5 16.5 4 7.8l4.6 3 3.4-5.4 3.4 5.4 4.6-3-1.5 8.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 4.5v2.4M12 17.1v2.4M4.5 12h2.4M17.1 12h2.4M6.7 6.7l1.7 1.7M15.6 15.6l1.7 1.7M17.3 6.7l-1.7 1.7M8.4 15.6l-1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  music: '<path d="M9 17.5V6.2l8-1.6v11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.8" cy="17.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="14.8" cy="15.6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/>',
};

const ICON_KEYS = Object.keys(ICONS);

function avatarColorClass(nickname) {
  let h = 0;
  const n = nickname || '?';
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return 'c' + Math.abs(h) % 10;
}

function avatarSvgNode(key) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = ICONS[key] || '';
  return svg;
}

function renderAvatar(container, u, extraClass) {
  container.innerHTML = '';
  container.className = 'avatar' + (extraClass ? ' ' + extraClass : '') + ' ' + avatarColorClass((u && (u.nick || u.nickname)) || '?');
  const nick = (u && (u.nick || u.nickname)) || '?';
  const icon = u && (u.avatar || u.icon);
  if (icon && ICONS[icon]) {
    container.appendChild(avatarSvgNode(icon));
  } else {
    const span = document.createElement('span');
    span.textContent = nick.charAt(0).toUpperCase();
    container.appendChild(span);
  }
}

function buildIconGrid(container, onPick, initial) {
  container.innerHTML = '';
  let chosenIcon = initial && ICONS[initial] ? initial : null;
  ICON_KEYS.forEach((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-opt';
    btn.appendChild(avatarSvgNode(key));
    if (key === chosenIcon) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      chosenIcon = chosenIcon === key ? null : key;
      container.querySelectorAll('.icon-opt').forEach((b) => b.classList.remove('selected'));
      if (chosenIcon) btn.classList.add('selected');
      onPick && onPick(chosenIcon);
    });
    container.appendChild(btn);
  });
  return () => chosenIcon;
}
