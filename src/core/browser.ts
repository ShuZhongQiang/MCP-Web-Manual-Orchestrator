import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BROWSER_HEADLESS, VIEWPORT } from "../config.js";

class BrowserManager {
  private browser?: Browser;
  private readonly contexts = new Map<string, { context: BrowserContext; page: Page }>();

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: BROWSER_HEADLESS });
    }
    return this.browser;
  }

  async getPage(runId: string): Promise<Page> {
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

  async closeContext(runId: string): Promise<void> {
    const session = this.contexts.get(runId);
    if (session) {
      await session.page.close();
      await session.context.close();
      this.contexts.delete(runId);
    }
  }

  async closeAll(): Promise<void> {
    for (const session of this.contexts.values()) {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
    }
    this.contexts.clear();
    
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }
}

export const browserManager = new BrowserManager();
