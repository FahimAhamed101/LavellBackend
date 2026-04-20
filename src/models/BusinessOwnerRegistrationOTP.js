const mongoose = require('mongoose');

const businessOwnerRegistrationOTPSchema = new mongoose.Schema({
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
  businessName: {
    type: String,
    trim: true,
    required: true
  },
  businessCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  businessAddress: {
    type: String,
    trim: true,
    required: true
  },
  businessPhotoUrl: {
    type: String,
    default: null
  },
  businessPhotoPublicId: {
    type: String,
    default: null
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
  occupation: {
    type: String,
    default: null
  },
  referenceId: {
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

businessOwnerRegistrationOTPSchema.index({ email: 1 }, { unique: true, sparse: true });
businessOwnerRegistrationOTPSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

businessOwnerRegistrationOTPSchema.pre('validate', function(next) {
  if (!this.email && !this.phoneNumber) {
    this.invalidate('email', 'Email or phone number is required');
    this.invalidate('phoneNumber', 'Email or phone number is required');
  }
  next();
});

module.exports = mongoose.model('BusinessOwnerRegistrationOTP', businessOwnerRegistrationOTPSchema);
