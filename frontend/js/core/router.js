// Hash-роутер: #/путь?параметры. Страница — объект { title, render(root, ctx) → cleanup? }.

const routes = new Map();
let host = null;
let cleanup = null;
let onChange = () => {};
let fallback = '/';

export function defineRoutes(map, { notFound = '/' } = {}) {
  for (const [path, page] of Object.entries(map)) routes.set(path, page);
  fallback = notFound;
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export const navigate = (to) => {
  if (location.hash === `#${to}`) render();
  else location.hash = `#${to}`;
};

export function currentPath() {
  return parseHash().path;
}

function render() {
  const { path, query } = parseHash();
  const page = routes.get(path) || routes.get(fallback);
  try { cleanup?.(); } catch (err) { console.error(err); }
  cleanup = null;

  const view = document.createElement('div');
  view.className = `page page-${page.name || 'view'}`;
  host.replaceChildren(view);
  document.title = `${page.title} · Печать героя`;
  window.scrollTo({ top: 0 });

  onChange(path);
  cleanup = page.render(view, { path, query }) || null;
}

export function startRouter(el, { onRoute } = {}) {
  host = el;
  if (onRoute) onChange = onRoute;
  window.addEventListener('hashchange', render);
  render();
}

/** Перерисовать текущую страницу (например, после смены темы или входа). */
export const rerender = () => render();
