import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should load dashboard page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Dashboard');
  });

  test('should navigate to Prompts page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/prompts"]');
    await expect(page).toHaveURL('/prompts');
    await expect(page.locator('h1')).toHaveText('Prompt Queue');
  });

  test('should navigate to Run page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/run"]');
    await expect(page).toHaveURL('/run');
    await expect(page.locator('h1')).toHaveText('Run Queue');
  });

  test('should navigate to History page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/history"]');
    await expect(page).toHaveURL('/history');
    await expect(page.locator('h1')).toHaveText('Execution History');
  });

  test('should navigate to Settings page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/settings"]');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  test('should show mlaude branding in sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=mlaude').first()).toBeVisible();
  });

  test('should highlight active nav item', async ({ page }) => {
    await page.goto('/prompts');
    const promptLink = page.locator('a[href="/prompts"]');
    await expect(promptLink).toHaveClass(/bg-gray-800/);
  });
});
