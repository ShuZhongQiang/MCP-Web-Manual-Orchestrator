import { chromium } from "playwright";
import { BROWSER_HEADLESS, VIEWPORT } from "../config.js";
class BrowserManager {
    browser;
    contexts = new Map();
    async getBrowser() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: BROWSER_HEADLESS });
        }
        return this.browser;
    }
    async getPage(runId) {
        const existing = this.contexts.get(runId);
        if (existing) {
            return existing.page;
        }
        const browser = await this.getBrowser();
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        this.contexts.set(runId, { context, page });
        return page;
    }
    async closeContext(runId) {
        const session = this.contexts.get(runId);
        if (session) {
            await session.page.close();
            await session.context.close();
            this.contexts.delete(runId);
        }
    }
    async closeAll() {
        for (const session of this.contexts.values()) {
            await session.page.close().catch(() => { });
            await session.context.close().catch(() => { });
        }
        this.contexts.clear();
        if (this.browser) {
            await this.browser.close();
            this.browser = undefined;
        }
    }
}
export const browserManager = new BrowserManager();
