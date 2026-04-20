const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

/**
 * OCR Service for ID Card Validation
 * Extracts text from ID card images and validates the data
 */
class OCRService {
  /**
   * Process ID card front image
   * @param {string} imagePath - Path to the ID card front image
   * @returns {Object} Extracted data from front of ID card
   */
  async processIdCardFront(imagePath) {
    try {
      // Preprocess image for better OCR accuracy
      const preprocessedPath = await this.preprocessImage(imagePath);

      // Perform OCR
      const { data: { text } } = await Tesseract.recognize(
        preprocessedPath,
        'eng', // Language: English
        {
          logger: info => console.log(info) // Optional: Log OCR progress
        }
      );

      // Extract relevant information from front of ID
      const extractedData = this.extractFrontData(text);

      // Clean up preprocessed image
      await fs.unlink(preprocessedPath).catch(() => {});

      return {
        success: true,
        rawText: text,
        extractedData,
        validationErrors: this.validateFrontData(extractedData)
      };
    } catch (error) {
      console.error('Error processing ID card front:', error);
      return {
        success: false,
        error: error.message,
        rawText: null,
        extractedData: null,
        validationErrors: ['Failed to process ID card image']
      };
    }
  }

  /**
   * Process ID card back image
   * @param {string} imagePath - Path to the ID card back image
   * @returns {Object} Extracted data from back of ID card
   */
  async processIdCardBack(imagePath) {
    try {
      // Preprocess image for better OCR accuracy
      const preprocessedPath = await this.preprocessImage(imagePath);

      // Perform OCR
      const { data: { text } } = await Tesseract.recognize(
        preprocessedPath,
        'eng',
        {
          logger: info => console.log(info)
        }
      );

      // Extract relevant information from back of ID
      const extractedData = this.extractBackData(text);

      // Clean up preprocessed image
      await fs.unlink(preprocessedPath).catch(() => {});

      return {
        success: true,
        rawText: text,
        extractedData,
        validationErrors: this.validateBackData(extractedData)
      };
    } catch (error) {
      console.error('Error processing ID card back:', error);
      return {
        success: false,
        error: error.message,
        rawText: null,
        extractedData: null,
        validationErrors: ['Failed to process ID card image']
      };
    }
  }

  /**
   * Preprocess image for better OCR accuracy
   * @param {string} imagePath - Original image path
   * @returns {string} Path to preprocessed image
   */
  async preprocessImage(imagePath) {
    const preprocessedPath = path.join(
      path.dirname(imagePath),
      `preprocessed_${path.basename(imagePath)}`
    );

    await sharp(imagePath)
      .grayscale() // Convert to grayscale
      .normalize() // Normalize contrast
      .sharpen() // Sharpen image
      .resize({ width: 1200, withoutEnlargement: true }) // Resize for consistency
      .toFile(preprocessedPath);

    return preprocessedPath;
  }

  /**
   * Extract data from front of ID card
   * @param {string} text - Raw OCR text
   * @returns {Object} Extracted structured data
   */
  extractFrontData(text) {
    const data = {
      fullName: null,
      idNumber: null,
      dateOfBirth: null,
      nationality: null,
      gender: null,
      issuedDate: null,
      expiryDate: null
    };

    // Clean and normalize text
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = text.replace(/\n/g, ' ').toUpperCase();

    // Extract ID Number (common patterns)
    // Pattern 1: ID NO: 1234567890
    // Pattern 2: ID NUMBER: 1234567890
    // Pattern 3: ID: 1234567890
    const idPatterns = [
      /(?:ID\s*(?:NO|NUMBER|#)?[\s:]*)?(\d{8,20})/i,
      /(?:IDENTITY\s*(?:NO|NUMBER)?[\s:]*)?(\d{8,20})/i,
      /(?:NATIONAL\s*ID[\s:]*)?(\d{8,20})/i
    ];

    for (const pattern of idPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        data.idNumber = match[1];
        break;
      }
    }

    // Extract Full Name (usually one of the first lines, in caps)
    // Look for lines with 2-4 words in uppercase
    const namePattern = /^[A-Z][A-Z\s]{3,50}$/;
    for (const line of lines) {
      if (namePattern.test(line) && line.split(' ').length >= 2 && line.split(' ').length <= 4) {
        data.fullName = line;
        break;
      }
    }

    // Extract Date of Birth (common formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD)
    const dobPatterns = [
      /(?:DOB|DATE\s*OF\s*BIRTH|BORN)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
      /(?:DOB|DATE\s*OF\s*BIRTH|BORN)[\s:]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i,
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/
    ];

    for (const pattern of dobPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        data.dateOfBirth = this.parseDate(match[1]);
        break;
      }
    }

    // Extract Nationality
    const nationalityPattern = /(?:NATIONALITY|NAT)[\s:]*([A-Z\s]{3,30})/i;
    const nationalityMatch = fullText.match(nationalityPattern);
    if (nationalityMatch && nationalityMatch[1]) {
      data.nationality = nationalityMatch[1].trim();
    }

    // Extract Gender
    const genderPattern = /(?:SEX|GENDER)[\s:]*([MF]|MALE|FEMALE)/i;
    const genderMatch = fullText.match(genderPattern);
    if (genderMatch && genderMatch[1]) {
      data.gender = genderMatch[1].toUpperCase().startsWith('M') ? 'MALE' : 'FEMALE';
    }

    // Extract Expiry Date
    const expiryPatterns = [
      /(?:EXPIRY|EXPIRES|VALID\s*UNTIL)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
      /(?:EXPIRY|EXPIRES|VALID\s*UNTIL)[\s:]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i
    ];

    for (const pattern of expiryPatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        data.expiryDate = this.parseDate(match[1]);
        break;
      }
    }

    // Extract Issue Date
    const issuePatterns = [
      /(?:ISSUED|ISSUE\s*DATE|DATE\s*OF\s*ISSUE)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
      /(?:ISSUED|ISSUE\s*DATE|DATE\s*OF\s*ISSUE)[\s:]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i
    ];

    for (const pattern of issuePatterns) {
      const match = fullText.match(pattern);
      if (match && match[1]) {
        data.issuedDate = this.parseDate(match[1]);
        break;
      }
    }

    return data;
  }

  /**
   * Extract data from back of ID card
   * @param {string} text - Raw OCR text
   * @returns {Object} Extracted structured data
   */
  extractBackData(text) {
    const data = {
      address: null,
      emergencyContact: null,
      bloodGroup: null,
      additionalInfo: null
    };

    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = text.replace(/\n/g, ' ').toUpperCase();

    // Extract Address (usually multiple lines)
    const addressPattern = /(?:ADDRESS|ADDR)[\s:]*(.{10,200})/i;
    const addressMatch = fullText.match(addressPattern);
    if (addressMatch && addressMatch[1]) {
      data.address = addressMatch[1].trim();
    } else {
      // If no explicit address label, try to extract multi-line text
      const potentialAddress = lines.filter(line =>
        line.length > 15 &&
        /[A-Za-z0-9\s,\-]+/.test(line)
      ).slice(0, 3).join(', ');

      if (potentialAddress) {
        data.address = potentialAddress;
      }
    }

    // Extract Blood Group
    const bloodPattern = /(?:BLOOD\s*GROUP|BLOOD\s*TYPE)[\s:]*([ABO][+-]?|AB[+-]?)/i;
    const bloodMatch = fullText.match(bloodPattern);
    if (bloodMatch && bloodMatch[1]) {
      data.bloodGroup = bloodMatch[1].toUpperCase();
    }

    // Extract Emergency Contact
    const emergencyPattern = /(?:EMERGENCY|CONTACT)[\s:]*(.{5,100})/i;
    const emergencyMatch = fullText.match(emergencyPattern);
    if (emergencyMatch && emergencyMatch[1]) {
      data.emergencyContact = emergencyMatch[1].trim();
    }

    // Store any additional information
    data.additionalInfo = text;

    return data;
  }

  /**
   * Parse date string to Date object
   * @param {string} dateStr - Date string in various formats
   * @returns {Date|null} Parsed date or null
   */
  parseDate(dateStr) {
    if (!dateStr) return null;

    // Try DD/MM/YYYY or DD-MM-YYYY
    const dmy = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
      const [, day, month, year] = dmy;
      return new Date(year, month - 1, day);
    }

    // Try YYYY/MM/DD or YYYY-MM-DD
    const ymd = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymd) {
      const [, year, month, day] = ymd;
      return new Date(year, month - 1, day);
    }

    return null;
  }

  /**
   * Validate extracted data from front of ID
   * @param {Object} data - Extracted data
   * @returns {Array} Array of validation error messages
   */
  validateFrontData(data) {
    const errors = [];

    if (!data.fullName) {
      errors.push('Could not extract full name from ID card');
    }

    if (!data.idNumber) {
      errors.push('Could not extract ID number from ID card');
    } else if (data.idNumber.length < 8) {
      errors.push('ID number appears to be too short');
    }

    if (!data.dateOfBirth) {
      errors.push('Could not extract date of birth from ID card');
    } else {
      // Validate age (must be at least 18 years old)
      const age = this.calculateAge(data.dateOfBirth);
      if (age < 18) {
        errors.push('Provider must be at least 18 years old');
      } else if (age > 100) {
        errors.push('Date of birth appears to be invalid');
      }
    }

    if (data.expiryDate) {
      // Check if ID is expired
      if (new Date(data.expiryDate) < new Date()) {
        errors.push('ID card has expired');
      }
    }

    return errors;
  }

  /**
   * Validate extracted data from back of ID
   * @param {Object} data - Extracted data
   * @returns {Array} Array of validation error messages
   */
  validateBackData(data) {
    const errors = [];

    if (!data.address && !data.additionalInfo) {
      errors.push('Could not extract any information from back of ID card');
    }

    // Back of ID card validation is less strict
    // as different countries have different formats

    return errors;
  }

  /**
   * Calculate age from date of birth
   * @param {Date} dob - Date of birth
   * @returns {number} Age in years
   */
  calculateAge(dob) {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  /**
   * Verify that front and back belong to same ID card
   * @param {Object} frontData - Data extracted from front
   * @param {Object} backData - Data extracted from back
   * @returns {boolean} True if data matches
   */
  verifyIdCardMatch(frontData, backData) {
    // Basic verification - can be enhanced based on specific ID card format
    // For now, we just check that both have valid data
    return frontData.idNumber && (backData.address || backData.additionalInfo);
  }
}

module.exports = new OCRService();
