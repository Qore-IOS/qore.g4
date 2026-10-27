import {test,expect} from '@playwright/test';
test('workspace opens directly without a login form',async({page})=>{
 await page.goto('/login');await expect(page).toHaveURL(/\/dashboard/);
 await expect(page.locator('input[type=password]')).toHaveCount(0);
 await expect(page.getByRole('button').first()).toBeVisible({timeout:60000});
});
