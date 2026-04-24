import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

async function openWorldSurface(page: import('@playwright/test').Page) {
  await page.goto('/agentbuilder');
  await expect(page.getByTestId('rail-moon-orb-button')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rail-worldsignal-button')).toHaveCount(0);
  await page.getByTestId('rail-moon-orb-button').click();
  await expect(page.getByTestId('worldsignal-surface')).toBeVisible();
}

async function waitForBridgeOnline(request: import('@playwright/test').APIRequestContext) {
  const timeoutMs = 30_000;
  const start = Date.now();
  let lastBody: any = null;
  while (Date.now() - start < timeoutMs) {
    const healthRes = await request.get('http://127.0.0.1:4000/api/v2/worldsignal/health');
    if (healthRes.ok()) {
      lastBody = await healthRes.json().catch(() => null);
      if (lastBody?.status === 'ok' && lastBody?.reachable === true) {
        return lastBody;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error(`worldsignal bridge did not report online in time; last=${JSON.stringify(lastBody)}`);
}

test('World view renders visible globe with live bridge runtime', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const unexpectedPages: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err?.message || err));
  });
  page.context().on('page', (openedPage) => {
    if (openedPage !== page) unexpectedPages.push(openedPage.url());
  });

  const pageCountBeforeSidecar = page.context().pages().length;
  const healthBridge = await waitForBridgeOnline(request);
  expect(page.context().pages()).toHaveLength(pageCountBeforeSidecar);
  expect(unexpectedPages, `Unexpected pages opened during sidecar autostart: ${unexpectedPages.join(' | ')}`).toEqual([]);
  expect(healthBridge.enabled).toBe(true);
  expect(healthBridge.reachable).toBe(true);
  expect(healthBridge.status).toBe('ok');

  const dataBridgeResponse = await request.get('http://127.0.0.1:4000/api/v2/worldsignal/data');
  expect(dataBridgeResponse.ok()).toBe(true);
  const dataBridge = await dataBridgeResponse.json();
  expect(dataBridge.enabled).toBe(true);
  expect(dataBridge.reachable).toBe(true);
  expect(dataBridge.status).toBe('ok');
  const hasLiveDataPayload = Boolean(dataBridge?.data && typeof dataBridge.data === 'object');
  expect(hasLiveDataPayload).toBe(true);

  await openWorldSurface(page);

  await expect(page.getByTestId('rail-moon-orb-button')).toBeVisible();
  await expect(page.getByTestId('rail-worldsignal-button')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);

  const viewport = page.getByTestId('worldsignal-globe-viewport').first();
  await expect(viewport).toBeVisible();
  const regionTabs = page.getByTestId('worldsignal-region-tabs');
  await expect(regionTabs).toBeVisible();
  await expect(regionTabs).toHaveClass(/crx-glass-pill-group/);
  const scene = viewport.getByTestId('worldsignal-three-scene');

  const modeToggle = viewport.getByTestId('worldsignal-map-toggle');
  await expect(modeToggle).toBeVisible();
  await expect(modeToggle).toHaveClass(/crx-toggle/);
  await expect
    .poll(async () => scene.evaluate((el) => el.childNodes.length))
    .toBeGreaterThan(0);
  await expect(modeToggle).toHaveText(/FLAT MODE/i);

  const initialContext = await page.getByTestId('worldsignal-context-contract').innerText();
  const initialContextJson = JSON.parse(initialContext);
  expect(initialContextJson.rendererMode).toBe('globe');
  expect(initialContextJson.dataStatus).toBe('online');

  const canvas = scene.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const bounds = await canvas.boundingBox();
  const viewportBounds = await viewport.boundingBox();
  expect(bounds).not.toBeNull();
  expect(viewportBounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThan(0);
  expect(bounds!.height).toBeGreaterThan(0);
  expect(bounds!.width / viewportBounds!.width).toBeGreaterThan(0.7);
  expect(bounds!.height / viewportBounds!.height).toBeGreaterThan(0.7);
  await expect
    .poll(async () => {
      const pointCount = await scene.evaluate((el) =>
        Number((el as HTMLElement).dataset.worldsignalPointCount || '0'),
      );
      return pointCount;
    })
    .toBeGreaterThan(0);

  const controlsDock = viewport.getByTestId('worldsignal-map-controls');
  await expect(controlsDock).toBeVisible();
  await expect(controlsDock).toHaveClass(/crx-glass-control-stack/);
  const controlsSize = await controlsDock.boundingBox();
  expect(controlsSize).not.toBeNull();
  expect(controlsSize!.width).toBeLessThan(80);

  await viewport.getByTestId('worldsignal-control-fit').click();
  await viewport.getByTestId('worldsignal-control-zoom-in').click();
  await viewport.getByTestId('worldsignal-control-zoom-out').click();

  await modeToggle.click();
  await expect(modeToggle).toHaveText(/GLOBE MODE/i);

  const flatMap = viewport.getByTestId('worldsignal-flat-map');
  await expect
    .poll(async () => flatMap.evaluate((el) => getComputedStyle(el as SVGSVGElement).display))
    .toBe('block');
  await expect
    .poll(async () =>
      flatMap.evaluate((el) => {
        const r = (el as SVGSVGElement).getBoundingClientRect();
        return { width: r.width, height: r.height };
      }),
    )
    .toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  const flatBounds = await flatMap.evaluate((el) => {
    const r = (el as SVGSVGElement).getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect(flatBounds.width).toBeGreaterThan(0);
  expect(flatBounds.height).toBeGreaterThan(0);

  const flatLandOrMarkers = flatMap.locator('path.land, circle.marker-circle, path');
  await expect(flatLandOrMarkers.first()).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => flatMap.locator('path.land').count())
    .toBeGreaterThan(0);
  await expect
    .poll(async () => flatMap.locator('circle.marker-circle').count())
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'EUROPE' }).click();
  const layersButton = viewport.getByTestId('worldsignal-layers-control-button');
  const widgetsButton = viewport.getByTestId('worldsignal-widgets-control-button');
  await expect(layersButton).toHaveClass(/crx-compact-btn/);
  await expect(widgetsButton).toHaveClass(/crx-compact-btn/);
  await layersButton.click();
  await expect(viewport.getByTestId('worldsignal-layers-control-panel')).toBeVisible();
  await viewport.getByTestId('worldsignal-layer-toggle-worldNews').click();
  await widgetsButton.click();
  await expect(viewport.getByTestId('worldsignal-widgets-control-panel')).toBeVisible();
  await widgetsButton.click();
  const updatedContext = await page.getByTestId('worldsignal-context-contract').innerText();
  const updatedContextJson = JSON.parse(updatedContext);
  expect(updatedContextJson.selectedRegion).toBe('europe');
  expect(updatedContextJson.rendererMode).toBe('flat');
  expect(updatedContextJson.selectedLayers.includes('worldNews')).toBe(false);

  await modeToggle.click();
  await expect(modeToggle).toHaveText(/FLAT MODE/i);
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const returnContext = await page.getByTestId('worldsignal-context-contract').innerText();
  const returnContextJson = JSON.parse(returnContext);
  expect(returnContextJson.rendererMode).toBe('globe');

  await page.getByTestId('rail-burst-button').click();
  await expect(page.getByTestId('workspace-companion-region')).toBeVisible();
  await expect(page.getByTestId('companion-surface-knowledge')).toBeVisible();
  await page.getByRole('button', { name: 'CodeGraph' }).click();
  await expect(page.getByRole('button', { name: 'CodeGraph' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const optimizeDepErrors = consoleErrors.filter((entry) =>
    /Outdated Optimize Dep|@react-three\/fiber|@react-three\/drei|@react-three\/postprocessing/i.test(
      entry,
    ),
  );
  expect(optimizeDepErrors, `Optimize dep errors detected: ${optimizeDepErrors.join(' | ')}`).toEqual([]);
  const dynamicImportErrors = [
    ...consoleErrors.filter((entry) => /Failed to fetch dynamically imported module/i.test(entry)),
    ...pageErrors.filter((entry) => /Failed to fetch dynamically imported module/i.test(entry)),
  ];
  expect(dynamicImportErrors, `Dynamic import errors detected: ${dynamicImportErrors.join(' | ')}`).toEqual([]);
  expect(pageErrors, `Page errors detected: ${pageErrors.join(' | ')}`).toEqual([]);
});
