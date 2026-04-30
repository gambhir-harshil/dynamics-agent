// config.js - Configure your automation here

require('dotenv').config();

module.exports = {
  // Target website URL
  targetUrl: 'https://example.com',
  
  // Schedule (cron format: minute hour day month weekday)
  // Default: Every day at 9:00 AM
  // Examples:
  //   '0 9 * * *'    - Daily at 9 AM
  //   '0 9 * * 1-5'  - Weekdays at 9 AM
  //   '*/30 * * * *' - Every 30 minutes
  schedule: '0 9 * * *',
  
  // Browser options
  browser: {
    headless: true,  // Set to false to see the browser
    slowMo: 0,       // Slow down by N milliseconds (useful for debugging)
    timeout: 30000   // Default timeout in milliseconds
  },
  
  // Login credentials (if needed)
  credentials: {
    username: process.env.USERNAME || '',
    password: process.env.PASSWORD || ''
  },
  
  // Selectors for your specific tasks
  selectors: {
    // Example: loginButton: '#login-btn',
    // Add your CSS selectors here
  },
  
  // Data to extract (customize based on your needs)
  dataToExtract: {
    // Example: pageTitle: 'h1',
    // Example: itemList: '.item-class'
  },
  
  // Form data to submit (if applicable)
  formData: {
    // Example: searchQuery: 'your search term'
  },
  
  // Monitoring settings
  monitoring: {
    enabled: true,
    saveScreenshots: true,
    logDirectory: './logs',
    screenshotDirectory: './screenshots'
  },

  // Dynamics CRM "Next Steps" updater
  dynamics: {
    nextSteps: {
      targetUrl: 'https://adobe-ent.crm.dynamics.com/main.aspx?appid=f2e74f34-7119-ea11-a811-000d3a5936c5&pagetype=entitylist&etn=incident&viewid=a753a9e7-16a2-e811-a969-000d3a10877d&viewType=1039',
      timeZone: process.env.UPDATE_TIME_ZONE || 'Asia/Calcutta',
      userDataDir: process.env.DYNAMICS_PROFILE_DIR || './.playwright/dynamics-profile',
      headless: process.env.DYNAMICS_HEADLESS === 'true',
      slowMo: Number(process.env.DYNAMICS_SLOW_MO || 0),
      timeout: Number(process.env.DYNAMICS_TIMEOUT || 60000),
      loginTimeout: Number(process.env.DYNAMICS_LOGIN_TIMEOUT || 300000),
      editorTimeout: Number(process.env.DYNAMICS_EDITOR_TIMEOUT || 30000),
      processAllPages: process.env.DYNAMICS_PROCESS_ALL_PAGES !== 'false',
      maxPages: Number(process.env.DYNAMICS_MAX_PAGES || 20),
      reportDirectory: './logs'
    }
  }
};
