/**
 * Test script to verify provider registration system setup
 * Run with: node test-provider-setup.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Testing Provider Registration System Setup...\n');

let allTestsPassed = true;

// Test 1: Check if required files exist
console.log('📁 Test 1: Checking if required files exist...');
const requiredFiles = [
  'src/models/Provider.js',
  'src/utility/ocrService.js',
  'src/middleware/upload.js',
  'src/controllers/providerController.js',
  'src/routes/provider.routes.js',
  'public/provider-register.html',
  'public/provider-login.html',
];

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - NOT FOUND`);
    allTestsPassed = false;
  }
});

// Test 2: Check if package.json has required dependencies
console.log('\n📦 Test 2: Checking if required dependencies are installed...');
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const requiredDeps = ['multer', 'sharp', 'tesseract.js'];

requiredDeps.forEach(dep => {
  if (packageJson.dependencies && packageJson.dependencies[dep]) {
    console.log(`  ✅ ${dep} (v${packageJson.dependencies[dep]})`);
  } else {
    console.log(`  ❌ ${dep} - NOT INSTALLED`);
    allTestsPassed = false;
  }
});

// Test 3: Check if uploads directory exists or can be created
console.log('\n📂 Test 3: Checking uploads directory...');
const uploadsDir = path.join(__dirname, 'uploads');
const idCardsDir = path.join(uploadsDir, 'id-cards');

if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('  ✅ Created uploads directory');
  } catch (error) {
    console.log('  ❌ Failed to create uploads directory:', error.message);
    allTestsPassed = false;
  }
} else {
  console.log('  ✅ uploads directory exists');
}

if (!fs.existsSync(idCardsDir)) {
  try {
    fs.mkdirSync(idCardsDir, { recursive: true });
    console.log('  ✅ Created uploads/id-cards directory');
  } catch (error) {
    console.log('  ❌ Failed to create uploads/id-cards directory:', error.message);
    allTestsPassed = false;
  }
} else {
  console.log('  ✅ uploads/id-cards directory exists');
}

// Test 4: Check if .gitignore includes uploads
console.log('\n🔒 Test 4: Checking .gitignore...');
const gitignorePath = path.join(__dirname, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  if (gitignoreContent.includes('uploads/')) {
    console.log('  ✅ uploads/ is in .gitignore');
  } else {
    console.log('  ⚠️  uploads/ is NOT in .gitignore (ID cards will be committed to git!)');
  }
} else {
  console.log('  ⚠️  .gitignore not found');
}

// Test 5: Check if routes are properly integrated
console.log('\n🛣️  Test 5: Checking routes integration...');
const indexRoutesPath = path.join(__dirname, 'src/routes/index.js');
if (fs.existsSync(indexRoutesPath)) {
  const indexRoutesContent = fs.readFileSync(indexRoutesPath, 'utf8');
  if (indexRoutesContent.includes('provider.routes')) {
    console.log('  ✅ Provider routes are integrated in index.js');
  } else {
    console.log('  ❌ Provider routes are NOT integrated in index.js');
    allTestsPassed = false;
  }
} else {
  console.log('  ❌ src/routes/index.js not found');
  allTestsPassed = false;
}

// Test 6: Check if .env.example exists
console.log('\n⚙️  Test 6: Checking environment configuration...');
const envExamplePath = path.join(__dirname, '.env.example');
if (fs.existsSync(envExamplePath)) {
  console.log('  ✅ .env.example exists');
} else {
  console.log('  ⚠️  .env.example not found');
}

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('  ✅ .env exists');
} else {
  console.log('  ⚠️  .env not found (copy from .env.example and configure)');
}

// Test 7: Verify file permissions (write access)
console.log('\n✍️  Test 7: Checking write permissions...');
try {
  const testFile = path.join(uploadsDir, 'test-write-permission.txt');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('  ✅ Write permissions OK for uploads directory');
} catch (error) {
  console.log('  ❌ No write permissions for uploads directory:', error.message);
  allTestsPassed = false;
}

// Final summary
console.log('\n' + '='.repeat(60));
if (allTestsPassed) {
  console.log('✅ All tests passed! Provider registration system is ready.');
  console.log('\nNext steps:');
  console.log('1. Start the server: npm run dev');
  console.log('2. Open: http://localhost:5100/provider-register.html');
  console.log('3. Test registration with ID card images');
} else {
  console.log('❌ Some tests failed. Please fix the issues above.');
  console.log('\nTo fix issues:');
  console.log('1. Install missing dependencies: npm install');
  console.log('2. Check file paths and permissions');
  console.log('3. Review the implementation guide: PROVIDER_REGISTRATION_GUIDE.md');
}
console.log('='.repeat(60));

process.exit(allTestsPassed ? 0 : 1);
