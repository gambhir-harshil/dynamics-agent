// examples.js - Common use case templates
// Copy these into agent.js and customize for your needs

// ============================================
// EXAMPLE 1: Login and Download Report
// ============================================
async downloadDailyReport() {
  // Navigate and login
  await this.page.goto('https://example.com/login');
  await this.page.fill('#email', config.credentials.username);
  await this.page.fill('#password', config.credentials.password);
  await this.page.click('button[type="submit"]');
  await this.page.waitForNavigation();
  
  // Navigate to reports page
  await this.page.click('a[href="/reports"]');
  await this.page.waitForLoadState('networkidle');
  
  // Download report
  const [download] = await Promise.all([
    this.page.waitForEvent('download'),
    this.page.click('#download-button')
  ]);
  
  const filePath = await download.path();
  console.log('Downloaded report to:', filePath);
}

// ============================================
// EXAMPLE 2: Monitor Price Changes
// ============================================
async checkPriceChanges() {
  await this.page.goto('https://example.com/product/12345');
  
  // Extract current price
  const price = await this.page.$eval('.price', el => el.textContent);
  const priceValue = parseFloat(price.replace(/[^0-9.]/g, ''));
  
  this.results.data.currentPrice = priceValue;
  
  // Compare with previous price (load from file)
  const fs = require('fs');
  const historyFile = './logs/price-history.json';
  
  let history = {};
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile));
  }
  
  if (history.lastPrice && priceValue < history.lastPrice) {
    this.results.data.priceDropped = true;
    this.results.data.priceDifference = history.lastPrice - priceValue;
    console.log('🎉 PRICE DROPPED! Was:', history.lastPrice, 'Now:', priceValue);
    
    // You could send notification here (email, SMS, etc.)
  }
  
  // Save current price
  history.lastPrice = priceValue;
  history.lastChecked = new Date().toISOString();
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
}

// ============================================
// EXAMPLE 3: Fill Timesheet Form
// ============================================
async fillTimesheet() {
  await this.page.goto('https://timesheet.example.com');
  
  // Login
  await this.page.fill('#username', config.credentials.username);
  await this.page.fill('#password', config.credentials.password);
  await this.page.click('#login');
  await this.page.waitForNavigation();
  
  // Navigate to today's timesheet
  await this.page.click('a[href="/timesheet/today"]');
  
  // Fill hours for each project
  await this.page.fill('#project1-hours', '4');
  await this.page.fill('#project2-hours', '4');
  
  // Add notes
  await this.page.fill('#notes', 'Regular development work');
  
  // Submit
  await this.page.click('#submit-timesheet');
  
  // Wait for confirmation
  const confirmation = await this.page.waitForSelector('.success-message');
  const message = await confirmation.textContent();
  
  this.results.data.timesheetSubmitted = true;
  this.results.data.confirmationMessage = message;
}

// ============================================
// EXAMPLE 4: Check for New Messages/Notifications
// ============================================
async checkNotifications() {
  await this.page.goto('https://example.com/dashboard');
  
  // Wait for notifications badge
  await this.page.waitForSelector('.notification-badge', { timeout: 5000 })
    .catch(() => {
      console.log('No notifications badge found');
      return null;
    });
  
  // Check notification count
  const badge = await this.page.$('.notification-badge');
  if (badge) {
    const count = await badge.textContent();
    const notificationCount = parseInt(count);
    
    this.results.data.hasNotifications = notificationCount > 0;
    this.results.data.notificationCount = notificationCount;
    
    if (notificationCount > 0) {
      // Click to view notifications
      await badge.click();
      await this.page.waitForTimeout(1000);
      
      // Extract notification details
      const notifications = await this.page.$$eval('.notification-item', items =>
        items.map(item => ({
          title: item.querySelector('.title')?.textContent,
          message: item.querySelector('.message')?.textContent,
          time: item.querySelector('.time')?.textContent
        }))
      );
      
      this.results.data.notifications = notifications;
      console.log(`Found ${notificationCount} new notifications`);
    }
  }
}

// ============================================
// EXAMPLE 5: Scrape Data from Table
// ============================================
async scrapeDataTable() {
  await this.page.goto('https://example.com/data');
  
  // Wait for table to load
  await this.page.waitForSelector('table.data-table');
  
  // Extract all rows
  const tableData = await this.page.$$eval('table.data-table tbody tr', rows =>
    rows.map(row => {
      const cells = row.querySelectorAll('td');
      return {
        id: cells[0]?.textContent?.trim(),
        name: cells[1]?.textContent?.trim(),
        status: cells[2]?.textContent?.trim(),
        date: cells[3]?.textContent?.trim(),
        amount: cells[4]?.textContent?.trim()
      };
    })
  );
  
  this.results.data.tableData = tableData;
  this.results.data.rowCount = tableData.length;
  
  console.log(`Extracted ${tableData.length} rows from table`);
  
  // Optional: Save to CSV
  const fs = require('fs');
  const csv = [
    'ID,Name,Status,Date,Amount',
    ...tableData.map(row => 
      `${row.id},${row.name},${row.status},${row.date},${row.amount}`
    )
  ].join('\n');
  
  fs.writeFileSync('./logs/scraped-data.csv', csv);
}

// ============================================
// EXAMPLE 6: Check Stock Availability
// ============================================
async checkStockAvailability() {
  const products = [
    { name: 'Product A', url: 'https://store.com/product-a' },
    { name: 'Product B', url: 'https://store.com/product-b' }
  ];
  
  const stockResults = [];
  
  for (const product of products) {
    await this.page.goto(product.url);
    
    // Check if "Add to Cart" button is available
    const addToCartBtn = await this.page.$('button#add-to-cart:not([disabled])');
    const inStock = !!addToCartBtn;
    
    // Get price
    const priceElement = await this.page.$('.price');
    const price = priceElement ? await priceElement.textContent() : 'N/A';
    
    stockResults.push({
      name: product.name,
      inStock: inStock,
      price: price,
      url: product.url
    });
    
    console.log(`${product.name}: ${inStock ? '✅ IN STOCK' : '❌ OUT OF STOCK'}`);
  }
  
  this.results.data.stockCheck = stockResults;
  
  // Alert if any product is in stock
  const anyInStock = stockResults.some(p => p.inStock);
  if (anyInStock) {
    console.log('🎉 Some products are now in stock!');
    // Send notification here
  }
}

// ============================================
// EXAMPLE 7: Social Media Post
// ============================================
async postToSocialMedia() {
  await this.page.goto('https://social-network.com');
  
  // Login
  await this.page.fill('input[name="email"]', config.credentials.username);
  await this.page.fill('input[name="password"]', config.credentials.password);
  await this.page.click('button[type="submit"]');
  await this.page.waitForNavigation();
  
  // Navigate to create post
  await this.page.click('[aria-label="Create post"]');
  await this.page.waitForSelector('textarea[placeholder*="What\'s on your mind"]');
  
  // Write post content
  const postContent = `Daily update: ${new Date().toLocaleDateString()} - All systems operational! 🚀`;
  await this.page.fill('textarea', postContent);
  
  // Optionally attach image
  // const fileInput = await this.page.$('input[type="file"]');
  // await fileInput.setInputFiles('./images/daily-update.png');
  
  // Post
  await this.page.click('button:has-text("Post")');
  await this.page.waitForTimeout(2000);
  
  this.results.data.posted = true;
  this.results.data.postContent = postContent;
}

// ============================================
// EXAMPLE 8: Handle Popups/Modals
// ============================================
async handlePopups() {
  await this.page.goto('https://example.com');
  
  // Wait for and close cookie consent
  try {
    const cookieBtn = await this.page.waitForSelector('#accept-cookies', { timeout: 5000 });
    await cookieBtn.click();
    console.log('Closed cookie popup');
  } catch (e) {
    console.log('No cookie popup found');
  }
  
  // Close newsletter signup modal
  try {
    const closeBtn = await this.page.waitForSelector('.modal-close', { timeout: 3000 });
    await closeBtn.click();
    console.log('Closed newsletter modal');
  } catch (e) {
    console.log('No modal found');
  }
  
  // Now proceed with main tasks
}

// ============================================
// EXAMPLE 9: Multi-page Navigation
// ============================================
async navigateMultiplePages() {
  // Start on page 1
  await this.page.goto('https://example.com/items?page=1');
  
  const allItems = [];
  let currentPage = 1;
  const maxPages = 5;
  
  while (currentPage <= maxPages) {
    console.log(`Processing page ${currentPage}...`);
    
    // Extract items from current page
    const pageItems = await this.page.$$eval('.item', items =>
      items.map(item => ({
        title: item.querySelector('.title')?.textContent,
        price: item.querySelector('.price')?.textContent
      }))
    );
    
    allItems.push(...pageItems);
    
    // Check if next page button exists
    const nextButton = await this.page.$('a.next-page:not(.disabled)');
    if (!nextButton) break;
    
    // Click next page
    await nextButton.click();
    await this.page.waitForNavigation();
    currentPage++;
  }
  
  this.results.data.items = allItems;
  this.results.data.totalItems = allItems.length;
  this.results.data.pagesScraped = currentPage;
}

// ============================================
// EXAMPLE 10: Conditional Logic Based on Page Content
// ============================================
async conditionalActions() {
  await this.page.goto('https://example.com/dashboard');
  
  // Check for error message
  const errorMsg = await this.page.$('.error-banner');
  if (errorMsg) {
    const errorText = await errorMsg.textContent();
    console.log('⚠️ Error detected:', errorText);
    this.results.data.hasError = true;
    this.results.data.errorMessage = errorText;
    
    // Take screenshot of error
    await this.page.screenshot({ path: './screenshots/error.png' });
    
    // Try to dismiss error
    const dismissBtn = await this.page.$('.error-dismiss');
    if (dismissBtn) await dismissBtn.click();
  }
  
  // Check for pending tasks
  const taskCount = await this.page.$('.pending-tasks-count');
  if (taskCount) {
    const count = parseInt(await taskCount.textContent());
    
    if (count > 0) {
      console.log(`Found ${count} pending tasks`);
      
      // Navigate to tasks page
      await this.page.click('a[href="/tasks"]');
      await this.page.waitForLoadState('networkidle');
      
      // Process first task
      await this.page.click('.task-item:first-child .process-button');
      await this.page.waitForTimeout(2000);
      
      this.results.data.processedTask = true;
    }
  }
}

module.exports = {
  downloadDailyReport,
  checkPriceChanges,
  fillTimesheet,
  checkNotifications,
  scrapeDataTable,
  checkStockAvailability,
  postToSocialMedia,
  handlePopups,
  navigateMultiplePages,
  conditionalActions
};
