const express = require('express');  
const router = express.Router();  
const { 
requestRegistrationOTP,  
verifyRegistrationOTP,  
completeRegistration 
} = require('..\/controllers\/registrationOTPController');  
  
\/\/ Request registration OTP 
router.post('\/register\/request-otp', requestRegistrationOTP);  
  
\/\/ Verify registration OTP 
router.post('\/register\/verify-otp', verifyRegistrationOTP);  
  
\/\/ Complete registration after OTP verification 
router.post('\/register\/complete', completeRegistration);  
  
module.exports = router; 
