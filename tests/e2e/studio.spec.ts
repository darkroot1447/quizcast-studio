import { test, expect, type Page } from '@playwright/test';
import { defaultSettings, type AdminData } from '../../shared/schema.js';

const password = 'Synthetic-browser-test-password-123';
const origin = 'http://127.0.0.1:4319';
async function getState(page: Page): Promise<AdminData> {
  return (await page.request.get('/api/admin/state')).json();
}
async function command(page: Page, action: string) {
  return page.request.post(`/api/admin/game/${action}`, { headers: { Origin: origin } });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const boot = await (await page.request.get('/api/bootstrap')).json();
  await page.getByLabel('Yönetici şifresi', { exact: true }).fill(password);
  if (boot.setupRequired) await page.getByLabel('Şifreyi tekrar yaz').fill(password);
  await page
    .getByRole('button', { name: boot.setupRequired ? 'Stüdyoyu oluştur' : 'Stüdyoya gir', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Kontrol sende. Sahne hazır.' })).toBeVisible();
  await command(page, 'stop');
  await page.request.put('/api/admin/settings', { headers: { Origin: origin }, data: defaultSettings });
  await page.reload();
});

test('operator can run, answer, pause, reveal, export and archive a quiz with an anonymous OBS screen', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.request.put('/api/admin/settings', {
    headers: { Origin: origin },
    data: { ...defaultSettings, questionSeconds: 60, autoAdvance: false },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Yarışmayı başlat', exact: true }).click();
  await expect(page.locator('.game-question')).toBeVisible();
  const state = await getState(page);
  const q = state.questions.find((q) => q.id === state.snapshot.question?.id)!;
  const correctIndex = state.snapshot.question!.options.indexOf(q.options[q.answer]);
  await page.getByLabel('İzleyici adı').fill('Tarayıcı yarışmacısı');
  await page.getByLabel('Cevap', { exact: true }).selectOption('ABCD'[correctIndex]);
  await page.getByRole('button', { name: 'Cevap gönder', exact: true }).click();
  await expect(page.getByText('Test cevabı alındı.', { exact: true })).toBeVisible();
  expect((await getState(page)).snapshot.leaderboard[0].score).toBe(0);
  const obsContext = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
  const obs = await obsContext.newPage();
  try {
    await obs.goto(`${origin}/overlay?token=${state.overlayToken}`);
    await expect(obs.locator('.game-question')).toHaveText(q.text);
    await expect(obs.locator('.game-option.correct')).toHaveCount(0);
    await page.getByRole('button', { name: 'Duraklat', exact: true }).click();
    await expect(obs.getByText('Yarışma duraklatıldı', { exact: true })).toBeVisible();
    const time = await obs.locator('.game-countdown b').textContent();
    await page.waitForTimeout(1100);
    expect(await obs.locator('.game-countdown b').textContent()).toBe(time);
    await page.getByRole('button', { name: 'Devam et', exact: true }).click();
    await page.getByRole('button', { name: 'Cevabı açıkla', exact: true }).click();
    await expect(obs.locator('.game-option.correct')).toContainText(q.options[q.answer]);
    expect((await getState(page)).snapshot.leaderboard[0].score).toBeGreaterThanOrEqual(100);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
    await obs.screenshot({ path: testInfo.outputPath('obs-1080x1920.png'), fullPage: true });
    const dimensions = await obs.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
    }));
    expect(dimensions.width).toBe(1080);
    expect(dimensions.height).toBeLessThanOrEqual(1920);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'CSV indir' }).click();
    expect((await downloadPromise).suggestedFilename()).toBe('quizcast-siralama.csv');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Yarışmayı bitir', exact: true }).click();
    await expect(page.getByText('Yarışma tamamlandı', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Yayın geçmişi' }).click();
    await page.locator('.history-item summary').first().click();
    await expect(page.locator('.history-item').first()).toContainText('Tarayıcı yarışmacısı');
    expect(errors).toEqual([]);
  } finally {
    await obsContext.close();
  }
});

test('question create, edit, search and delete flow works from the panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Soru kütüphanesi' }).click();
  await page.getByRole('button', { name: 'Soru ekle', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Soru', { exact: true }).fill('Tarayıcı test sorusu: 5 artı 5 kaç eder?');
  for (const [i, choice] of ['10', '11', '12', '13'].entries())
    await dialog.getByLabel(`${'ABCD'[i]} şıkkı`, { exact: true }).fill(choice);
  await dialog.getByLabel('Cevap açıklaması').fill('5 ile 5 toplandığında 10 elde edilir.');
  await dialog.getByRole('button', { name: 'Soruyu kaydet' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('Sorularda ara').fill('Tarayıcı test sorusu');
  await expect(page.locator('.question-row')).toHaveCount(1);
  await page.getByRole('button', { name: /^Soruyu düzenle:/ }).click();
  await dialog
    .getByLabel('Soru', { exact: true })
    .fill('Tarayıcı test sorusu düzenlendi: 5 artı 5 kaç eder?');
  await dialog.getByRole('button', { name: 'Soruyu kaydet' }).click();
  await expect(page.locator('.question-row h2')).toContainText('düzenlendi');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Soruyu sil:/ }).click();
  await expect(page.getByText('Bu aramada soru bulunamadı.')).toBeVisible();
  expect((await getState(page)).questions.length).toBe(100);
});

test('settings persist and a timed one-question match advances automatically', async ({ page }) => {
  await page.getByRole('button', { name: 'Yarışma ayarları' }).click();
  await page.getByLabel('Yarışma adı', { exact: true }).fill('Tarayıcı Test Arenası');
  await page.getByLabel('Soru süresi (sn)', { exact: true }).fill('5');
  await page.getByLabel('Cevap ekranı (sn)', { exact: true }).fill('3');
  await page.getByLabel('Yarışmadaki soru sayısı').fill('1');
  await page.getByRole('button', { name: 'Ayarları kaydet' }).click();
  await expect(page.getByText('Yarışma ayarları kaydedildi.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Yarışma ayarları' }).click();
  await expect(page.getByLabel('Yarışma adı', { exact: true })).toHaveValue('Tarayıcı Test Arenası');
  await page.getByRole('button', { name: 'Yayın stüdyosu' }).click();
  await page.getByRole('button', { name: 'Yarışmayı başlat', exact: true }).click();
  await expect(page.getByText('Doğru cevap açıklanıyor', { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Yarışma tamamlandı', { exact: true })).toBeVisible({ timeout: 6000 });
});

test('small mobile, landscape and reduced-motion layouts remain usable', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const size of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(size);
    for (const name of ['Yayın stüdyosu', 'Soru kütüphanesi', 'Yarışma ayarları']) {
      await page.getByRole('button', { name }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow, `${name} at ${size.width}px should fit`).toBe(false);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Yayın stüdyosu' }).click();
  await page.screenshot({ path: testInfo.outputPath('studio-mobile.png'), fullPage: true });
});

test('licensing and provider setup do not pretend a real live connection is ready', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'TikTok LIVE', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lisans ve kurulum' }).click();
  await expect(page.getByText('EKLENMEDİ', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Kurulum kimliği', { exact: true })).not.toBeEmpty();
  await expect(page.getByText(/gerçek yayın testi/)).toBeVisible();
  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Tekrar hoş geldin.' })).toBeVisible();
  expect((await page.request.get('/api/admin/state')).status()).toBe(401);
});
