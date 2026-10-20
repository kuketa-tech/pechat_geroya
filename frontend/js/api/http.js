// REST-клиент к бэкенду (FastAPI, backend/). Тот же интерфейс, что у mock.js, поэтому
// api/index.js переключается одной строкой. Сессия живёт в httpOnly-cookie, так что
// userId в аргументах сервером не используется — он сам знает, кто пришёл.

export class ApiError extends Error {
  constructor(message, { field = null, status = 0, offline = false } = {}) {
    super(message);
    this.field = field;
    this.status = status;
    this.offline = offline;
  }
}

// Часовой пояс нужен серверу, чтобы «сегодня», серия дней и задания совпадали с вашими сутками
const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
})();

async function request(method, path, body) {
  const headers = { Accept: 'application/json', 'X-TZ-Offset': String(new Date().getTimezoneOffset()) };
  if (TIMEZONE) headers['X-Timezone'] = TIMEZONE;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.', { offline: true });
  }

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.ok && isJson) return data;
  if (!isJson) throw new ApiError('Сервер API недоступен', { status: res.status, offline: true });
  const err = data?.error || {};
  throw new ApiError(err.message || `Ошибка сервера (${res.status})`, { field: err.field, status: res.status });
}

const qs = (params) => new URLSearchParams(params).toString();

export const httpBackend = {
  me: () => request('GET', '/me'),
  register: ({ name, email, password }) => request('POST', '/auth/register', { name, email, password }),
  login: ({ email, password }) => request('POST', '/auth/login', { email, password }),
  loginSocial: (provider) => request('POST', '/auth/social', { provider }),
  logout: () => request('POST', '/auth/logout'),
  getProgress: () => request('GET', '/progress'),
  saveSession: (_userId, session) => request('POST', '/sessions', session),
  updateProfile: (_userId, patch) => request('PATCH', '/profile', patch),
  resetProgress: () => request('POST', '/progress/reset'),
  seedDemo: () => request('POST', '/progress/demo'),
  leaderboard: ({ metric, period }) => request('GET', `/leaderboard?${qs({ metric, period })}`),
  insights: () => request('GET', '/ml/insights'),
};
