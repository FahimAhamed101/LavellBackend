const mongoose = require('mongoose');

const registrationOTPSchema = new mongoose.Schema({
  email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  phoneNumber: {
    type: String,
    trim: true,
    sparse: true,
    validate: {
      validator: function(v) {
        return /^[\d\s\-\+\(\)]+$/.test(v);
      },
      message: 'Please enter a valid phone number'
    }
  },
  fullName: {
    type: String,
    trim: true
  },
  passwordHash: {
    type: String,
    select: false
  },
  termsAccepted: {
    type: Boolean
  },
  otpHash: {
    type: String,
    required: true,
    select: false
  },
  otpExpiresAt: {
    type: Date,
    required: true,
    select: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationTokenHash: {
    type: String,
    select: false
  },
  verificationTokenExpiresAt: {
    type: Date,
    select: false
  }
}, {
  timestamps: true
});

registrationOTPSchema.index({ email: 1 }, { unique: true, sparse: true });
registrationOTPSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

registrationOTPSchema.pre('validate', function(next) {
  if (!this.email && !this.phoneNumber) {
    this.invalidate('email', 'Email or phone number is required');
    this.invalidate('phoneNumber', 'Email or phone number is required');
  }
  next();
});

module.exports = mongoose.model('RegistrationOTP', registrationOTPSchema);
