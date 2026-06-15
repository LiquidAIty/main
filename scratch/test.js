import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to frontend...");
  await page.goto('http://localhost:5176');
  
  // Wait for the app to load
  await page.waitForTimeout(2000);

  // We might need to click on a project or go directly to the builder
  // Let's try going to /projects or /builder
  const content = await page.content();
  if (content.includes('ADMIN')) {
    console.log("Found ADMIN project, clicking it...");
    await page.getByText('ADMIN').first().click();
    await page.waitForTimeout(2000);
  }

  // Find the AgentBuilder link or button
  const builderLink = page.getByText(/Agent Builder/i).first();
  if (await builderLink.isVisible()) {
    console.log("Clicking Agent Builder...");
    await builderLink.click();
    await page.waitForTimeout(2000);
  } else {
    // try to go to /agentbuilder if not visible
    console.log("Agent builder link not found, trying /builder...");
    await page.goto('http://localhost:5176/builder');
    await page.waitForTimeout(2000);
  }

  // Find the chat input
  console.log("Finding chat input...");
  const chatInput = page.getByRole('textbox').first();
  if (await chatInput.isVisible()) {
    console.log("Sending chat message...");
    await chatInput.fill('can you do a quick audit of code');
    await chatInput.press('Enter');
    
    // Wait for the plan and run to complete
    console.log("Waiting for AgentBuilder execution to complete (up to 45s)...");
    await page.waitForTimeout(45000);

    // Extract the page text to verify
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("--- PAGE TEXT ---");
    console.log(bodyText);
    console.log("-----------------");
  } else {
    console.log("Could not find chat input box.");
    console.log(await page.content());
  }

  await browser.close();
})();
