const mongoose = require('mongoose');

const eventManagerRegistrationOTPSchema = new mongoose.Schema({
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
    trim: true,
    required: true
  },
  passwordHash: {
    type: String,
    required: true,
    select: false
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  idType: {
    type: String,
    required: true,
    enum: ['passport', 'national_id', 'driver_license'],
    trim: true
  },
  identificationNumber: {
    type: String,
    required: true,
    trim: true
  },
  idCardFrontUrl: {
    type: String,
    default: null
  },
  idCardFrontPublicId: {
    type: String,
    default: null
  },
  idCardBackUrl: {
    type: String,
    default: null
  },
  idCardBackPublicId: {
    type: String,
    default: null
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

eventManagerRegistrationOTPSchema.index({ email: 1 }, { unique: true, sparse: true });
eventManagerRegistrationOTPSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

eventManagerRegistrationOTPSchema.pre('validate', function(next) {
  if (!this.email && !this.phoneNumber) {
    this.invalidate('email', 'Email or phone number is required');
    this.invalidate('phoneNumber', 'Email or phone number is required');
  }
  next();
});

module.exports = mongoose.model('EventManagerRegistrationOTP', eventManagerRegistrationOTPSchema);
