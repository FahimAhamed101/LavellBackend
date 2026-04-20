const twilio = require('twilio');

// Initialize Twilio client
const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured in environment variables');
  }

  return twilio(accountSid, authToken);
};

// Send OTP via SMS
const sendOTPSMS = async (phoneNumber, otp, userName) => {
  try {
    const client = getTwilioClient();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!fromNumber) {
      throw new Error('Twilio phone number not configured');
    }

    const message = await client.messages.create({
      body: `Hello ${userName},\n\nYour ${process.env.APP_NAME || 'Lavellh'} password reset OTP is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this, please ignore this message.`,
      from: fromNumber,
      to: phoneNumber
    });

    console.log('SMS sent successfully:', message.sid);
    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
};

// Send registration OTP via SMS
const sendRegistrationOTPSMS = async (phoneNumber, otp, userName) => {
  try {
    const client = getTwilioClient();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!fromNumber) {
      throw new Error('Twilio phone number not configured');
    }

    const message = await client.messages.create({
      body: `Hello ${userName},\n\nYour ${process.env.APP_NAME || 'Lavellh'} registration OTP is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this, please ignore this message.`,
      from: fromNumber,
      to: phoneNumber
    });

    console.log('Registration SMS sent successfully:', message.sid);
    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('Error sending registration SMS:', error);
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
};

// Send verification SMS (optional, for future use)
const sendVerificationSMS = async (phoneNumber, verificationCode) => {
  try {
    const client = getTwilioClient();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    const message = await client.messages.create({
      body: `Your ${process.env.APP_NAME || 'Lavellh'} verification code is: ${verificationCode}`,
      from: fromNumber,
      to: phoneNumber
    });

    console.log('Verification SMS sent:', message.sid);
    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('Error sending verification SMS:', error);
    return { success: false, error: error.message };
  }
};

// Send welcome SMS (optional, for future use)
const sendWelcomeSMS = async (phoneNumber, userName) => {
  try {
    const client = getTwilioClient();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    const message = await client.messages.create({
      body: `Welcome to ${process.env.APP_NAME || 'Lavellh'}, ${userName}! Thank you for joining us.`,
      from: fromNumber,
      to: phoneNumber
    });

    console.log('Welcome SMS sent:', message.sid);
    return { success: true, messageSid: message.sid };
  } catch (error) {
    console.error('Error sending welcome SMS:', error);
    // Don't throw error for welcome SMS, just log it
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOTPSMS,
  sendRegistrationOTPSMS,
  sendVerificationSMS,
  sendWelcomeSMS
};
