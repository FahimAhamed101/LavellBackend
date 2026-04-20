const RefreshToken = require('../models/RefreshToken');

/**
 * Cleanup expired and revoked refresh tokens from database
 * This should be run periodically (e.g., via cron job)
 */
const cleanupExpiredTokens = async () => {
  try {
    const result = await RefreshToken.cleanupExpired();
    console.log(`Token cleanup: Removed ${result.deletedCount} expired/revoked tokens`);
    return result;
  } catch (error) {
    console.error('Error during token cleanup:', error);
    throw error;
  }
};

/**
 * Schedule automatic token cleanup
 * Runs every 24 hours by default
 * @param {number} intervalHours - Hours between cleanup runs (default: 24)
 */
const scheduleTokenCleanup = (intervalHours = 24) => {
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Run immediately on startup
  cleanupExpiredTokens().catch(console.error);

  // Schedule periodic cleanup
  setInterval(() => {
    cleanupExpiredTokens().catch(console.error);
  }, intervalMs);

  console.log(`Token cleanup scheduled: Running every ${intervalHours} hours`);
};

module.exports = {
  cleanupExpiredTokens,
  scheduleTokenCleanup
};
