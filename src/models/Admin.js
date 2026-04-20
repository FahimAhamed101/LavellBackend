const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters'],
    maxlength: [100, 'Full name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't include password in queries by default
  },
  role: {
    type: String,
    enum: ['super-admin', 'admin', 'moderator'],
    default: 'admin'
  },
  permissions: {
    // Granular permissions for different admin roles
    canManageAdmins: {
      type: Boolean,
      default: false // Only super-admin can manage other admins
    },
    canManageUsers: {
      type: Boolean,
      default: true
    },
    canManageProviders: {
      type: Boolean,
      default: true
    },
    canViewReports: {
      type: Boolean,
      default: true
    },
    canManageSettings: {
      type: Boolean,
      default: false // Only super-admin
    }
  },
  profilePicture: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  resetPasswordOTP: {
    type: String,
    select: false
  },
  resetPasswordOTPExpires: {
    type: Date,
    select: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null // Null for the first super-admin
  }
}, {
  timestamps: true
});

// Index for faster queries
// Note: email already has unique: true which creates an index automatically
adminSchema.index({ isActive: 1 });
adminSchema.index({ role: 1 });

// Auto-set permissions based on role
adminSchema.pre('save', function(next) {
  if (this.isModified('role')) {
    if (this.role === 'super-admin') {
      this.permissions = {
        canManageAdmins: true,
        canManageUsers: true,
        canManageProviders: true,
        canViewReports: true,
        canManageSettings: true
      };
    } else if (this.role === 'admin') {
      this.permissions = {
        canManageAdmins: false,
        canManageUsers: true,
        canManageProviders: true,
        canViewReports: true,
        canManageSettings: false
      };
    } else if (this.role === 'moderator') {
      this.permissions = {
        canManageAdmins: false,
        canManageUsers: false,
        canManageProviders: true,
        canViewReports: false,
        canManageSettings: false
      };
    }
  }
  next();
});

// Hash password before saving
adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update last login
adminSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

// Method to get public profile (without sensitive data)
adminSchema.methods.toJSON = function() {
  const admin = this.toObject();
  delete admin.password;
  delete admin.resetPasswordOTP;
  delete admin.resetPasswordOTPExpires;
  return admin;
};

// Generate 6-digit OTP for password reset
adminSchema.methods.generatePasswordResetOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  this.resetPasswordOTP = require('crypto')
    .createHash('sha256')
    .update(otp)
    .digest('hex');

  this.resetPasswordOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return otp;
};

// Verify OTP
adminSchema.methods.verifyPasswordResetOTP = function(otp) {
  if (!this.resetPasswordOTP || !this.resetPasswordOTPExpires) {
    return false;
  }

  if (Date.now() > this.resetPasswordOTPExpires) {
    return false;
  }

  const hashedOTP = require('crypto')
    .createHash('sha256')
    .update(otp)
    .digest('hex');

  return hashedOTP === this.resetPasswordOTP;
};

module.exports = mongoose.model('Admin', adminSchema);
