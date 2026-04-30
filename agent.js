// agent.js - Main automation agent

const { chromium } = require('playwright');
const config = require('./config');
const fs = require('fs');
const path = require('path');

class WebAgent {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = {
      timestamp: new Date().toISOString(),
      success: false,
      data: {},
      errors: []
    };
  }

  // Initialize browser and page
  async initialize() {
    console.log('🚀 Starting web agent...');
    
    this.browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo
    });
    
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(config.browser.timeout);
    
    console.log('✅ Browser initialized');
  }

  // Navigate to target URL
  async navigate() {
    console.log(`🌐 Navigating to ${config.targetUrl}...`);
    await this.page.goto(config.targetUrl, { waitUntil: 'networkidle' });
    console.log('✅ Page loaded');
  }

  // Example: Login (if needed)
  async login() {
    if (!config.credentials.username || !config.credentials.password) {
      console.log('⏭️  No credentials configured, skipping login');
      return;
    }

    console.log('🔐 Attempting login...');
    
    try {
      // Customize these selectors for your specific site
      await this.page.fill('#username', config.credentials.username);
      await this.page.fill('#password', config.credentials.password);
      await this.page.click('#login-button');
      await this.page.waitForNavigation();
      
      console.log('✅ Login successful');
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      this.results.errors.push(`Login error: ${error.message}`);
    }
  }

  // Click buttons and navigate
  async performClicks() {
    console.log('🖱️  Performing click actions...');
    
    try {
      // Example: Click multiple elements in sequence
      // Customize based on your needs
      
      // await this.page.click(config.selectors.button1);
      // await this.page.waitForTimeout(1000);
      
      // await this.page.click(config.selectors.button2);
      // await this.page.waitForNavigation();
      
      console.log('✅ Click actions completed');
    } catch (error) {
      console.error('❌ Click action failed:', error.message);
      this.results.errors.push(`Click error: ${error.message}`);
    }
  }

  // Extract data from page
  async extractData() {
    console.log('📊 Extracting data...');
    
    try {
      // Get page title
      const title = await this.page.title();
      this.results.data.title = title;
      
      // Extract custom data based on config
      for (const [key, selector] of Object.entries(config.dataToExtract)) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            this.results.data[key] = await element.textContent();
          }
        } catch (err) {
          console.warn(`⚠️  Could not extract ${key}:`, err.message);
        }
      }
      
      // Example: Extract list of items
      // const items = await this.page.$$eval('.item-class', elements => 
      //   elements.map(el => ({
      //     text: el.textContent.trim(),
      //     link: el.href
      //   }))
      // );
      // this.results.data.items = items;
      
      console.log('✅ Data extracted:', Object.keys(this.results.data).length, 'fields');
    } catch (error) {
      console.error('❌ Data extraction failed:', error.message);
      this.results.errors.push(`Extraction error: ${error.message}`);
    }
  }

  // Fill and submit forms
  async fillForms() {
    console.log('📝 Filling forms...');
    
    try {
      // Example form filling
      // for (const [field, value] of Object.entries(config.formData)) {
      //   await this.page.fill(`#${field}`, value);
      // }
      
      // await this.page.click('#submit-button');
      // await this.page.waitForNavigation();
      
      console.log('✅ Forms submitted');
    } catch (error) {
      console.error('❌ Form submission failed:', error.message);
      this.results.errors.push(`Form error: ${error.message}`);
    }
  }

  // Monitor for changes
  async monitorChanges() {
    console.log('👁️  Monitoring for changes...');
    
    try {
      // Take screenshot for comparison
      if (config.monitoring.saveScreenshots) {
        const screenshotDir = config.monitoring.screenshotDirectory;
        if (!fs.existsSync(screenshotDir)) {
          fs.mkdirSync(screenshotDir, { recursive: true });
        }
        
        const screenshotPath = path.join(
          screenshotDir,
          `screenshot-${Date.now()}.png`
        );
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        this.results.data.screenshot = screenshotPath;
        console.log(`📸 Screenshot saved: ${screenshotPath}`);
      }
      
      // Example: Check for specific elements or text
      // const hasAlert = await this.page.$('.alert-message');
      // if (hasAlert) {
      //   const alertText = await hasAlert.textContent();
      //   this.results.data.alerts = alertText;
      // }
      
      console.log('✅ Monitoring complete');
    } catch (error) {
      console.error('❌ Monitoring failed:', error.message);
      this.results.errors.push(`Monitoring error: ${error.message}`);
    }
  }

  // Save results to log file
  async saveResults() {
    const logDir = config.monitoring.logDirectory;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, `log-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify(this.results, null, 2));
    console.log(`📄 Results saved: ${logFile}`);
  }

  // Cleanup
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser closed');
    }
  }

  // Main execution flow
  async run() {
    try {
      await this.initialize();
      await this.navigate();
      
      // Uncomment the methods you need:
      // await this.login();
      await this.performClicks();
      await this.extractData();
      // await this.fillForms();
      await this.monitorChanges();
      
      this.results.success = true;
      console.log('✅ Agent completed successfully');
      
    } catch (error) {
      console.error('❌ Agent failed:', error.message);
      this.results.errors.push(`Fatal error: ${error.message}`);
      this.results.success = false;
    } finally {
      await this.saveResults();
      await this.cleanup();
    }
    
    return this.results;
  }
}

// Run immediately if executed directly
if (require.main === module) {
  const agent = new WebAgent();
  agent.run()
    .then(results => {
      console.log('\n📋 Final Results:', results);
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = WebAgent;
