const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters'],
    maxlength: [100, 'Full name cannot exceed 100 characters']
  },

  email: {
    type: String,
    required: function() {
      return !this.phoneNumber; // Email required if no phone number
    },
    unique: true,
    sparse: true, // Allow null values but ensure uniqueness when present
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  phoneNumber: {
    type: String,
    required: function() {
      return !this.email; // Phone required if no email
    },
    unique: true,
    sparse: true, // Allow null values but ensure uniqueness when present
    trim: true,
    validate: {
      validator: function(v) {
        // Basic phone validation - adjust regex based on your requirements
        return /^[\d\s\-\+\(\)]+$/.test(v);
      },
      message: 'Please enter a valid phone number'
    }
  },
  password: {
    type: String,
    required: function() {
      return this.authProvider === 'local'; // Password only required for local auth
    },
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'facebook', 'apple'],
    default: 'local'
  },
  providerId: {
    type: String,
    sparse: true // Allow multiple null values but unique when present
  },
  profilePicture: {
    type: String,
    default: null
  },
  termsAccepted: {
    type: Boolean,
    required: function() {
      return this.authProvider === 'local'; // Terms required for local registration
    },
    default: true, // Auto-accept for OAuth users
    validate: {
      validator: function(v) {
        if (this.authProvider === 'local') {
          return v === true;
        }
        return true;
      },
      message: 'You must accept the terms and conditions to continue'
    }
  },
  userType: {
    type: String,
    default: 'user',
    enum: ['user', 'provider', 'businessOwner', 'eventManager'],
    immutable: true // Cannot be changed after creation
  },
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    default: null,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPendingVerification: {
    type: Boolean,
    default: false
  },
  resetPasswordOTP: {
    type: String,
    select: false // Don't include in queries by default
  },
  resetPasswordOTPExpires: {
    type: Date,
    select: false // Don't include in queries by default
  },
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordTokenExpires: {
    type: Date,
    select: false
  },
  bankInformation: {
    accountHolderName: {
      type: String,
      trim: true
    },
    bankName: {
      type: String,
      trim: true
    },
    accountNumber: {
      type: String,
      trim: true
    },
    routingNumber: {
      type: String,
      trim: true
    },
    accountHolderType: {
      type: String,
      trim: true
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    },
    address: {
      type: String,
      trim: true
    }
  }
}, {
  timestamps: true
});

// Index for geospatial queries
userSchema.index({ 'location.coordinates': '2dsphere' });

// Ensure at least email or phone is provided (except for OAuth users who may only have providerId)
userSchema.pre('validate', function(next) {
  if (this.authProvider === 'local' && !this.email && !this.phoneNumber) {
    this.invalidate('email', 'Either email or phone number is required');
    this.invalidate('phoneNumber', 'Either email or phone number is required');
  }
  next();
});

// Hash password before saving (only for local auth)
userSchema.pre('save', async function(next) {
  // Skip password hashing for OAuth users
  if (this.authProvider !== 'local' || !this.isModified('password')) return next();

  try {
    const bcryptPattern = /^\$2[aby]\$\d{2}\$/;
    if (bcryptPattern.test(this.password) && this.password.length >= 55) {
      return next();
    }

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get public profile (without sensitive data)
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.resetPasswordOTP;
  delete user.resetPasswordOTPExpires;
  delete user.resetPasswordToken;
  delete user.resetPasswordTokenExpires;
  return user;
};

// Generate 6-digit OTP for password reset
userSchema.methods.generatePasswordResetOTP = function() {
  // Generate random 6-digit number
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Store hashed OTP
  this.resetPasswordOTP = require('crypto')
    .createHash('sha256')
    .update(otp)
    .digest('hex');

  // OTP expires in 10 minutes
  this.resetPasswordOTPExpires = Date.now() + 10 * 60 * 1000;

  return otp; // Return plain OTP to send to user
};

// Verify OTP
userSchema.methods.verifyPasswordResetOTP = function(otp) {
  if (!this.resetPasswordOTP || !this.resetPasswordOTPExpires) {
    return false;
  }

  // Check if OTP has expired
  if (Date.now() > this.resetPasswordOTPExpires) {
    return false;
  }

  // Hash the provided OTP and compare
  const hashedOTP = require('crypto')
    .createHash('sha256')
    .update(otp)
    .digest('hex');

  return hashedOTP === this.resetPasswordOTP;
};

// Generate access token
userSchema.methods.generateAccessToken = function() {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    {
      id: this._id,
      userType: this.userType
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  );
};

// Generate refresh token
userSchema.methods.generateRefreshToken = function() {
  const jwt = require('jsonwebtoken');
  const crypto = require('crypto');

  // Create a unique token using user ID and random bytes
  const payload = {
    id: this._id,
    userType: this.userType,
    tokenId: crypto.randomBytes(32).toString('hex')
  };

  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

module.exports = mongoose.model('User', userSchema);
