const User = require('../models/User');
const { sendOTPEmail } = require('../utility/emailService');
const { sendOTPSMS } = require('../utility/smsService');
const crypto = require('crypto');

// Request password reset - Send OTP
const requestPasswordReset = async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    // Validate that at least email or phoneNumber is provided
    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    // Find user by email or phone
    const query = email ? { email } : { phoneNumber };
    const user = await User.findOne(query);

    if (!user) {
      // For security, don't reveal if user exists or not
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this information, you will receive an OTP shortly.'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // Generate OTP
    const otp = user.generatePasswordResetOTP();
    await user.save({ validateBeforeSave: false });

    // Send OTP via email or SMS
    try {
      if (email && user.email) {
        await sendOTPEmail(user.email, otp, user.fullName);
        console.log(`OTP sent to email: ${user.email}`);
      } else if (phoneNumber && user.phoneNumber) {
        await sendOTPSMS(user.phoneNumber, otp, user.fullName);
        console.log(`OTP sent to phone: ${user.phoneNumber}`);
      }

      res.status(200).json({
        success: true,
        message: `OTP has been sent to your ${email ? 'email' : 'phone number'}. Please check and enter the code.`,
        data: {
          sentTo: email ? 'email' : 'phone',
          expiresIn: '10 minutes'
        }
      });
    } catch (sendError) {
      // Clear the OTP if sending failed
      user.resetPasswordOTP = undefined;
      user.resetPasswordOTPExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error('Error sending OTP:', sendError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? sendError.message : undefined
      });
    }
  } catch (error) {
    console.error('Error in requestPasswordReset:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing password reset request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify OTP
const verifyOTP = async (req, res) => {
  try {
    const { email, phoneNumber, otp } = req.body;

    // Validate inputs
    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone number is required'
      });
    }

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP is required'
      });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'OTP must be a 6-digit number'
      });
    }

    // Find user with OTP fields
    const query = email ? { email } : { phoneNumber };
    const user = await User.findOne(query)
      .select('+resetPasswordOTP +resetPasswordOTPExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    // Verify OTP
    const isValid = user.verifyPasswordResetOTP(otp);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.'
      });
    }

    // OTP is valid, return success
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.resetPasswordTokenExpires = Date.now() + 10 * 60 * 1000;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      data: {
        resetToken,
        expiresIn: '10 minutes'
      }
    });
  } catch (error) {
    console.error('Error in verifyOTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reset password with OTP
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken) {
      return res.status(400).json({
        success: false,
        message: 'Reset token is required'
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password is required'
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordTokenExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordTokenExpires +password');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token. Please verify OTP again.'
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpires = undefined;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Error in resetPassword:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  requestPasswordReset,
  verifyOTP,
  resetPassword
};
