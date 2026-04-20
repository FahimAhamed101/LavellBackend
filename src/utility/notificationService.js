const admin = require('../config/firebase');
const Notification = require('../models/Notification');
const DeviceToken = require('../models/DeviceToken');

const canSendPush = () => admin && admin.apps && admin.apps.length > 0;

const createNotification = async ({
  userId,
  userType = 'user',
  title,
  body,
  type = 'general',
  entityType,
  entityId,
  metadata
}) => {
  const notification = new Notification({
    userId,
    userType,
    title,
    body,
    type,
    entityType,
    entityId,
    metadata
  });

  await notification.save();
  return notification;
};

const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  if (!canSendPush()) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const tokens = await DeviceToken.find({
    userId,
    isActive: true
  }).select('token');

  if (tokens.length === 0) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const tokenList = tokens.map(t => t.token);
  const message = {
    tokens: tokenList,
    notification: {
      title,
      body
    },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    )
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  const invalidTokens = [];
  response.responses.forEach((res, idx) => {
    if (!res.success && res.error) {
      const code = res.error.code || '';
      if (code.includes('messaging/registration-token-not-registered') ||
          code.includes('messaging/invalid-registration-token')) {
        invalidTokens.push(tokenList[idx]);
      }
    }
  });

  if (invalidTokens.length > 0) {
    await DeviceToken.deleteMany({ token: { $in: invalidTokens } });
  }

  return {
    sent: response.successCount,
    failed: response.failureCount,
    skipped: false
  };
};

const createAndSend = async ({
  userId,
  userType,
  title,
  body,
  type,
  entityType,
  entityId,
  metadata,
  data
}) => {
  const notification = await createNotification({
    userId,
    userType,
    title,
    body,
    type,
    entityType,
    entityId,
    metadata
  });

  await sendPushToUser({
    userId,
    title,
    body,
    data: data || {
      notificationId: notification._id.toString(),
      type: type || 'general'
    }
  });

  return notification;
};

module.exports = {
  createNotification,
  sendPushToUser,
  createAndSend
};
