const DeviceToken = require('../models/DeviceToken');

/**
 * Register or update device token for current user
 * POST /api/notifications/token
 */
exports.registerToken = async (req, res) => {
  try {
    const { token, platform = 'unknown' } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    const update = {
      userId: req.user._id,
      platform,
      isActive: true,
      lastUsedAt: new Date()
    };

    const deviceToken = await DeviceToken.findOneAndUpdate(
      { token },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Device token registered',
      data: { deviceToken }
    });
  } catch (error) {
    console.error('Register device token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering device token',
      error: error.message
    });
  }
};

/**
 * Remove device token for current user
 * DELETE /api/notifications/token
 */
exports.removeToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    await DeviceToken.deleteOne({ token, userId: req.user._id });

    res.status(200).json({
      success: true,
      message: 'Device token removed'
    });
  } catch (error) {
    console.error('Remove device token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing device token',
      error: error.message
    });
  }
};
