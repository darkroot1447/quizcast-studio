export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/admin'))
      window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error ?? 'İşlem tamamlanamadı.');
  }
  return data as T;
}

export async function readJson(file: File) {
  if (file.size > 1024 * 1024) throw new Error('Dosya 1 MB’tan küçük olmalı.');
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error('Dosya geçerli JSON içermiyor.');
  }
}
