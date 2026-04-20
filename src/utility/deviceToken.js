const DeviceToken = require('../models/DeviceToken');

const upsertDeviceToken = async ({ userId, token, platform = 'unknown' }) => {
  if (!userId || !token) return null;

  const update = {
    userId,
    platform,
    isActive: true,
    lastUsedAt: new Date()
  };

  return DeviceToken.findOneAndUpdate(
    { token },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = { upsertDeviceToken };
