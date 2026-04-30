// scheduler.js - Schedule the agent to run daily

const cron = require('node-cron');
const WebAgent = require('./agent');
const config = require('./config');

console.log('🕐 Scheduler starting...');
console.log(`📅 Schedule: ${config.schedule}`);
console.log(`🎯 Target: ${config.targetUrl}`);

// Validate cron expression
if (!cron.validate(config.schedule)) {
  console.error('❌ Invalid cron schedule format!');
  console.log('Examples:');
  console.log('  "0 9 * * *"    - Every day at 9 AM');
  console.log('  "0 9 * * 1-5"  - Weekdays at 9 AM');
  console.log('  "*/30 * * * *" - Every 30 minutes');
  process.exit(1);
}

// Schedule the task
const task = cron.schedule(config.schedule, async () => {
  console.log('\n⏰ Scheduled task triggered at', new Date().toLocaleString());
  
  const agent = new WebAgent();
  try {
    await agent.run();
  } catch (error) {
    console.error('❌ Scheduled task failed:', error);
  }
}, {
  scheduled: true,
  timezone: "America/New_York" // Change to your timezone
});

console.log('✅ Scheduler is running. Press Ctrl+C to stop.');
console.log(`⏰ Next run: ${getNextRunTime(config.schedule)}`);

// Optional: Run immediately on start
// const runOnStart = true;
// if (runOnStart) {
//   console.log('\n🚀 Running agent immediately...');
//   const agent = new WebAgent();
//   agent.run().catch(console.error);
// }

// Helper function to estimate next run time
function getNextRunTime(cronExpression) {
  const parts = cronExpression.split(' ');
  const [minute, hour] = parts;
  
  const now = new Date();
  const next = new Date();
  
  if (hour !== '*') {
    next.setHours(parseInt(hour));
  }
  if (minute !== '*') {
    next.setMinutes(parseInt(minute));
  }
  next.setSeconds(0);
  
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  return next.toLocaleString();
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping scheduler...');
  task.stop();
  process.exit(0);
});
