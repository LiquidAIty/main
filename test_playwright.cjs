
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log("Navigating to URL...");
    await page.goto("http://localhost:5173/agentbuilder?projectId=20ac92da-01fd-4cf6-97cc-0672421e751a", { waitUntil: "networkidle" });
    
    console.log("Waiting for app to load...");
    await page.waitForTimeout(5000);
    
    console.log("Typing TEST and submitting via JS...");
    await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        let target = inputs.find(i => i.placeholder && i.placeholder.includes("Type a message"));
        if (!target && inputs.length > 0) target = inputs[inputs.length - 1]; // fallback
        if (target) {
            target.value = "TEST";
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        } else {
            console.error("Could not find input field!");
        }
    });

    console.log("Waiting for responses...");
    await page.waitForTimeout(10000); // wait 10s for the run to complete
    
    const texts = await page.evaluate(() => document.body.innerText);
    console.log("PAGE TEXT EXTRACT:\n", texts);

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
  }
})();

