const mongoose = require('mongoose');

const adminRefreshTokenSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  isRevoked: {
    type: Boolean,
    default: false,
    index: true
  },
  deviceInfo: {
    userAgent: String,
    ip: String
  },
  lastUsedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

adminRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

adminRefreshTokenSchema.methods.isValid = function() {
  return !this.isRevoked && this.expiresAt > new Date();
};

adminRefreshTokenSchema.statics.revokeAllForAdmin = async function(adminId) {
  return this.updateMany(
    { adminId, isRevoked: false },
    { isRevoked: true }
  );
};

adminRefreshTokenSchema.statics.cleanupExpired = async function() {
  return this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { isRevoked: true }
    ]
  });
};

module.exports = mongoose.model('AdminRefreshToken', adminRefreshTokenSchema);
