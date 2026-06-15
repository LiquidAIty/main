import { chromium } from '@playwright/test';
import { exec } from 'child_process';

const URL = 'http://localhost:5173/build'; // or /

(async () => {
  console.log('Starting backend servers...');
  // Start the dev server in the background
  const devServer = exec('npm run dev', { cwd: 'c:/Projects/main' });
  
  // Wait for it to be ready
  await new Promise(resolve => setTimeout(resolve, 15000));

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log(`Navigating to ${URL}...`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Attempt to interact with chat
    console.log('Waiting for chat input...');
    const chatInput = page.locator('textarea').first();
    await chatInput.fill('Run a test task to verify the new UX flow.');
    await page.keyboard.press('Enter');

    console.log('Chat submitted. Waiting for Run Task button...');
    // We expect the Magentic-One plan to generate a canvas node with 'Run Task'
    const runBtn = page.locator('button:has-text("Run Task")').first();
    await runBtn.waitFor({ state: 'visible', timeout: 30000 });
    
    console.log('Run Task button is visible. Clicking it...');
    await runBtn.click();
    
    console.log('Run Task clicked. Verifying execution starts...');
    // Wait for the "Dispatched Code Console" message
    const consoleMsg = page.locator('text=Dispatched Code Console').first();
    await consoleMsg.waitFor({ state: 'visible', timeout: 20000 });
    
    console.log('SUCCESS: Code Console dispatched.');
    
  } catch (error) {
    console.error('Test Failed:', error);
  } finally {
    await browser.close();
    devServer.kill();
    // Windows might need taskkill for child processes
    exec('taskkill /pid ' + devServer.pid + ' /t /f');
  }
})();
