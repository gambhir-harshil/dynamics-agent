# Daily Web Agent 🤖

Automated agent that visits websites daily and performs tasks like clicking buttons, extracting data, filling forms, and monitoring changes.

## Features

✅ **Navigation & Clicks** - Navigate through pages and click elements  
✅ **Data Extraction** - Extract and save data from web pages  
✅ **Form Filling** - Automatically fill and submit forms  
✅ **Change Monitoring** - Take screenshots and detect changes  
✅ **Scheduled Execution** - Runs daily (or custom schedule)  
✅ **Logging** - Saves results and screenshots for review  

## Quick Start

### 1. Install Dependencies

```bash
# Install Node.js packages
npm install

# Install Playwright browser
npm run setup
```

### 2. Configure Your Agent

Edit `config.js` to customize:

```javascript
targetUrl: 'https://your-website.com',  // Your target website
schedule: '0 9 * * *',                   // Daily at 9 AM
```

**Cron Schedule Examples:**
- `0 9 * * *` - Every day at 9:00 AM
- `0 9 * * 1-5` - Weekdays at 9:00 AM  
- `0 */2 * * *` - Every 2 hours
- `*/30 * * * *` - Every 30 minutes

### 3. Add Your Selectors

In `config.js`, add CSS selectors for the elements you want to interact with:

```javascript
selectors: {
  loginButton: '#login-btn',
  submitButton: 'button[type="submit"]',
  dataTable: '.data-table'
},

dataToExtract: {
  pageTitle: 'h1',
  status: '.status-badge',
  tableRows: '.data-table tr'
}
```

### 4. (Optional) Add Credentials

If your site requires login:

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your credentials
# USERNAME=your_username
# PASSWORD=your_password
```

### 5. Customize Agent Actions

Edit `agent.js` and uncomment/modify the methods you need:

```javascript
async run() {
  await this.initialize();
  await this.navigate();
  
  await this.login();           // Uncomment if you need login
  await this.performClicks();   // Click buttons
  await this.extractData();     // Extract data
  await this.fillForms();       // Fill forms
  await this.monitorChanges();  // Take screenshots
}
```

## Usage

### Run Once (Test)

```bash
npm start
```

This runs the agent immediately - perfect for testing your configuration.

### Run on Schedule (Daily)

```bash
npm run schedule
```

This keeps the process running and executes the agent based on your cron schedule.

### Update Dynamics Next Steps

```bash
npm run update-next-steps
```

This opens the configured Dynamics CRM case view, selects each visible case row, clicks the
`Next Steps` ribbon command, and updates a leading date like `Apr 27:` to today's date while
leaving the rest of the text unchanged. Blank Next Steps entries are not modified and are listed
in the JSON report under `logs/`.

For a no-write validation pass:

```bash
npm run update-next-steps:dry-run
```

The first run may show a Microsoft sign-in screen. Complete sign-in in the Playwright browser
window; the session is reused from `./.playwright/dynamics-profile` on later runs.

### Run in Background (Production)

**Option 1: Using PM2 (Recommended)**

```bash
# Install PM2 globally
npm install -g pm2

# Start scheduler
pm2 start scheduler.js --name web-agent

# View logs
pm2 logs web-agent

# Stop
pm2 stop web-agent

# Auto-start on system boot
pm2 startup
pm2 save
```

**Option 2: System Service (Linux)**

Create `/etc/systemd/system/web-agent.service`:

```ini
[Unit]
Description=Daily Web Agent
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/daily-web-agent
ExecStart=/usr/bin/node scheduler.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable web-agent
sudo systemctl start web-agent
```

**Option 3: Windows Task Scheduler**

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger to "Daily" at your preferred time
4. Action: Start a program
   - Program: `node`
   - Arguments: `agent.js`
   - Start in: Path to your project folder

## Customization Guide

### Example 1: Click Through Multiple Pages

```javascript
async performClicks() {
  // Click first button
  await this.page.click('#next-button');
  await this.page.waitForNavigation();
  
  // Click second button
  await this.page.click('#continue-button');
  await this.page.waitForTimeout(2000);
}
```

### Example 2: Extract Table Data

```javascript
async extractData() {
  const tableData = await this.page.$$eval('table tr', rows => 
    rows.map(row => {
      const cells = row.querySelectorAll('td');
      return Array.from(cells).map(cell => cell.textContent.trim());
    })
  );
  this.results.data.table = tableData;
}
```

### Example 3: Fill Search Form

```javascript
async fillForms() {
  await this.page.fill('#search-input', 'my search query');
  await this.page.selectOption('#category', 'option-value');
  await this.page.click('#search-button');
  await this.page.waitForNavigation();
}
```

### Example 4: Wait for Dynamic Content

```javascript
// Wait for element to appear
await this.page.waitForSelector('.dynamic-content', { timeout: 10000 });

// Wait for network to be idle
await this.page.waitForLoadState('networkidle');
```

## File Structure

```
daily-web-agent/
├── agent.js           # Main automation logic
├── scheduler.js       # Cron scheduler
├── config.js          # Configuration file
├── package.json       # Dependencies
├── .env              # Credentials (create from .env.example)
├── .env.example      # Template for credentials
├── .gitignore        # Git ignore rules
├── logs/             # Execution logs (auto-created)
└── screenshots/      # Saved screenshots (auto-created)
```

## Output & Logs

All results are saved to `logs/` directory:

```json
{
  "timestamp": "2024-01-15T09:00:00.000Z",
  "success": true,
  "data": {
    "title": "Page Title",
    "extractedField": "value",
    "screenshot": "./screenshots/screenshot-1234567890.png"
  },
  "errors": []
}
```

## Troubleshooting

### "Browser not found"
```bash
npm run setup
```

### "Selector not found"
- Set `headless: false` in config.js to see what's happening
- Use browser DevTools to find correct CSS selectors
- Add `slowMo: 100` to slow down actions

### "Timeout errors"
- Increase `timeout` in config.js
- Add explicit waits: `await this.page.waitForTimeout(5000)`

### Test Selectors
```javascript
// In agent.js, add this to test a selector:
const element = await this.page.$(config.selectors.myButton);
console.log('Element found:', !!element);
```

## Security Notes

🔒 **Never commit .env file** - It contains your credentials  
🔒 **Use environment variables** - Don't hardcode passwords  
🔒 **Restrict file permissions** - `chmod 600 .env`  

## Advanced: Headless vs Headful

**Headless (default):** Runs invisibly in background - faster, uses less resources  
**Headful:** Shows browser window - useful for debugging

```javascript
// In config.js
browser: {
  headless: false  // Set to false to see the browser
}
```

## Common Use Cases

✅ Daily report downloads  
✅ Form submissions (timesheets, status updates)  
✅ Price monitoring  
✅ Stock availability checks  
✅ Social media posting  
✅ Data scraping  
✅ Website health checks  

## Support

For Playwright documentation: https://playwright.dev/  
For cron syntax help: https://crontab.guru/

---

**Happy Automating! 🚀**
